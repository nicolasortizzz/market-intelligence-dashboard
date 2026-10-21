"""One-command refresh of every data snapshot behind the dashboard.
Steps (in order):
  1. fetch_data.py            market.json, prices.json, activity.json, macro.json (screener, risk, Treasury curve, BCRA FX)
  2. fetch_valuation.py       valuation.json (prices + fundamentals for every valuation ticker, so the KPI price box matches)
  3. fetch_reverse_dcf.py     reverse_dcf.json (latest closes for the reverse DCF)
  4. fetch_revenue_history.py revenue_history.json (5y revenue CAGR, SEC XBRL)
  5. fetch_wacc_history.py    wacc_history.json (FY2021-FY2025 + current WACC)
  6. fetch_embi.py            embi.json (Argentina EMBI; model CRP is only changed with --apply-embi)
Then validates every JSON (parses, no NaN/Infinity, generatedAt refreshed, prices > 0 and dated within 7 days,
WACC/CAGR within sanity bounds), computes fair values with the real JS engine in headless Chromium (if Playwright is
installed) and prints a before/after diff of prices and fair values. Exit code 1 if validation fails.
Usage:
  python scripts/update_all.py                 # refresh + validate + diff
  python scripts/update_all.py --skip market   # skip steps by name (market, valuation, reverse, revenue, wacc, embi)
  python scripts/update_all.py --apply-embi    # also set the YPF/GGAL CRP to the latest EMBI (changes valuations)
  python scripts/update_all.py --deploy        # if validation passes: git commit data + push main and gh-pages
"""
import json, os, sys, subprocess, shutil, datetime as dt, math, time, socket, tempfile, threading, http.server, functools

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA = os.path.join(ROOT, "data"); PY = sys.executable
STEPS = [("market", ["fetch_data.py"]), ("valuation", ["fetch_valuation.py"]), ("reverse", ["fetch_reverse_dcf.py"]),
         ("revenue", ["fetch_revenue_history.py"]), ("wacc", ["fetch_wacc_history.py"]), ("embi", ["fetch_embi.py"])]
FILES = ["market.json", "prices.json", "activity.json", "macro.json", "valuation.json", "reverse_dcf.json",
         "revenue_history.json", "wacc_history.json", "embi.json"]

def arg(name): return name in sys.argv
def skipped():
    out = set()
    for i, a in enumerate(sys.argv):
        if a == "--skip" and i + 1 < len(sys.argv): out |= set(sys.argv[i + 1].split(","))
    return out

def load(p):
    with open(p) as f: txt = f.read()
    if "NaN" in txt or "Infinity" in txt: raise ValueError("contains NaN/Infinity")
    return json.loads(txt)

def fair_values(root):
    """Run the dashboard's own JS engine (valuation.js) in headless Chromium on `root` and return per-ticker values."""
    try: from playwright.sync_api import sync_playwright
    except ImportError: return None
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
    H.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    js = """async()=>{await loadVal();if(typeof loadRev==='function')await loadRev();const o={};for(const tk of VT){const pw=probWeighted(tk,{}),cm=comps(tk),cMid=compMidOf(cm),
      R=reverse(tk);o[tk]={price:V.D.companies[tk].price,priceDate:V.D.companies[tk].priceDate,base:dcf(tk,'base',{}).ps,pw:pw.pw,tri:cMid!=null?0.6*pw.pw+0.4*cMid:pw.pw,
      wacc:dcf(tk,'base',{}).wacc,gImp:R.gImp,rvPx:R.px.p}}return o}"""
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(f"http://127.0.0.1:{port}/#valuation", wait_until="networkidle"); pg.wait_for_timeout(1500)
            pg.click("button[data-tab=valuation]"); pg.wait_for_timeout(1500)
            out = pg.evaluate(js); b.close()
            if errs: out["_jsErrors"] = errs
            return out
    finally: srv.shutdown()

def validate(t0):
    probs, today = [], dt.date.today()
    for fn in FILES:
        p = os.path.join(DATA, fn)
        if not os.path.exists(p): probs.append(f"{fn}: missing"); continue
        try: d = load(p)
        except Exception as e: probs.append(f"{fn}: {e}"); continue
        if os.path.getmtime(p) < t0 and fn not in SKIPPED_FILES: probs.append(f"{fn}: not rewritten by this run")
    V = load(os.path.join(DATA, "valuation.json"))
    for tk, c in V["companies"].items():
        if not (c.get("price") or 0) > 0: probs.append(f"{tk}: price missing")
        elif (today - dt.date.fromisoformat(c["priceDate"])).days > 7: probs.append(f"{tk}: priceDate {c['priceDate']} older than 7 days")
    R = load(os.path.join(DATA, "reverse_dcf.json"))["quotes"]
    for tk in V["companies"]:
        if tk not in R: probs.append(f"reverse_dcf: {tk} missing")
    W = load(os.path.join(DATA, "wacc_history.json"))["companies"]
    for tk, w in W.items():
        for r in w["rows"]:
            v = r.get("wacc") if not w["bank"] else r["ke"]
            if v is None or not (0.02 <= v <= 0.45): probs.append(f"wacc {tk} {r['year']}: {v}")
    H = load(os.path.join(DATA, "revenue_history.json"))["companies"]
    for tk, h in H.items():
        if not (-0.5 <= h["cagr5"] <= 1.0): probs.append(f"revenue CAGR {tk}: {h['cagr5']}")
    return probs

SKIPPED_FILES = set()
def main():
    global SKIPPED_FILES
    skip = skipped(); fmap = {"market": FILES[:4], "valuation": ["valuation.json"], "reverse": ["reverse_dcf.json"],
                              "revenue": ["revenue_history.json"], "wacc": ["wacc_history.json"], "embi": ["embi.json"]}
    SKIPPED_FILES = {f for s in skip for f in fmap.get(s, [])}
    prev = tempfile.mkdtemp(prefix="mid_prev_"); shutil.copytree(ROOT, os.path.join(prev, "site"), ignore=shutil.ignore_patterns(".git", "docs", "node_modules"))
    print("== computing fair values on the previous snapshot"); before = fair_values(os.path.join(prev, "site"))
    t0 = time.time() - 1
    for name, cmd in STEPS:
        if name in skip: print(f"== skip {name}"); continue
        extra = ["--apply"] if (name == "embi" and arg("--apply-embi")) else []
        print(f"== {name}: {' '.join(cmd + extra)}"); s = time.time()
        r = subprocess.run([PY, os.path.join(ROOT, "scripts", cmd[0])] + cmd[1:] + extra, cwd=ROOT)
        print(f"   {name} exit {r.returncode} in {time.time() - s:.0f}s")
        if r.returncode != 0: print(f"!! {name} failed; stopping (previous files are untouched for later steps)"); sys.exit(1)
    print("== validating"); probs = validate(t0)
    after = fair_values(ROOT)
    if after and after.get("_jsErrors"): probs.append(f"JS errors: {after['_jsErrors']}")
    print("\n== summary (USD per share/ADR)")
    print(f"{'ticker':6} {'price before':>13} {'price after':>12} {'date':>11} {'tri before':>11} {'tri after':>10} {'Δ tri':>7} {'WACC':>6}")
    if before and after:
        for tk in after:
            if tk.startswith("_"): continue
            a, b = after[tk], before.get(tk, {})
            dtri = (a["tri"] / b["tri"] - 1) * 100 if b.get("tri") else float("nan")
            print(f"{tk:6} {b.get('price', float('nan')):13.2f} {a['price']:12.2f} {a['priceDate']:>11} {b.get('tri', float('nan')):11.2f} {a['tri']:10.2f} {dtri:6.1f}% {a['wacc'] * 100:5.2f}%")
        json.dump({"generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "before": before, "after": after},
                  open(os.path.join(DATA, "last_update_summary.json"), "w"), indent=1)
    else: print("(Playwright not installed: fair-value diff skipped; pip install playwright && playwright install chromium)")
    shutil.rmtree(prev, ignore_errors=True)
    if probs:
        print("\n!! validation problems:"); [print("   -", p) for p in probs]; sys.exit(1)
    print("== dashboard checks (scripts/validate_dashboard.py, every ticker)")
    if subprocess.run([PY, os.path.join(ROOT, "scripts", "validate_dashboard.py"), "--export", os.path.join(ROOT, "data", "valuation_summary.json")], cwd=ROOT).returncode:
        print("\n!! dashboard validation failed; nothing deployed"); sys.exit(1)
    print("\n== validation passed")
    if arg("--deploy"):
        msg = f"Data refresh {dt.date.today().isoformat()} (scripts/update_all.py)"
        subprocess.run(["git", "add", "data"] + (["valuation.js", "reverse_dcf.js", "README.md"] if arg("--apply-embi") else []), cwd=ROOT, check=True)
        if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode:
            subprocess.run(["git", "commit", "-m", msg], cwd=ROOT, check=True)
        subprocess.run(["git", "push", "origin", "main"], cwd=ROOT, check=True)
        subprocess.run(["git", "push", "origin", "main:gh-pages"], cwd=ROOT, check=True)
        print("== deployed: main + gh-pages pushed (GitHub Pages rebuilds in ~1 minute)")

if __name__ == "__main__":
    main()

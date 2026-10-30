"""Headless validation of the Valuation tab for EVERY ticker (fails loudly, exit 1).
Checks per ticker (reverse DCF + model consistency):
  * reverse-DCF sliders default to the model values (WACC/Ke, g, Base EBIT margin/ROE) and their bounds contain the default
  * after moving a slider and switching ticker, the custom value does not carry over (defaults restored)
  * heatmap grid contains the Base-case star and the implied (price) point; the price lies inside the grid's value range
  * all grid values / base value finite; implied values finite or explicitly warned about; label counts sane (<= 8 x, <= 11 y)
  * 5-year revenue CAGR and WACC history (5 years + today) present; no JS errors on any tab switch
Usage: python scripts/validate_dashboard.py [--url http://...] [--export data/valuation_summary.json] [TICKER ...]
  (default: serves this checkout on a free port). --export writes the per-ticker summary from the same engine
  (valSummary() in valuation.js) after all checks pass; external pages (ModelosArgentina) read that file.
"""
import sys, os, json, socket, threading, functools, http.server
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

def serve():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{port}/"

def check(d):
    p, eps = [], 1e-6
    for k, dflt in (("wacc", None), ("g", None), ("m", d["modelM"])):
        s = d["sliders"].get(k)
        if not s: p.append(f"slider {k} missing"); continue
        if abs(s["v"] - s["d"]) > 0.0026: p.append(f"slider {k} = {s['v']:.4f} but model default {s['d']:.4f}")
        if not (s["min"] - eps <= s["d"] <= s["max"] + eps): p.append(f"slider {k} default {s['d']:.4f} outside [{s['min']}, {s['max']}]")
        if dflt is not None and abs(s["d"] - dflt) > eps: p.append(f"slider {k} default {s['d']:.4f} != model Base {dflt:.4f}")
    if abs(d["mT"] - d["baseM"]) > eps: p.append(f"growth-solve margin {d['mT']:.4f} != Base {d['baseM']:.4f}")
    if not d["starIn"]: p.append(f"Base star ({d['baseCagr5']:.3f}, {d['baseM']:.3f}) outside grid x[{d['gs'][0]}, {d['gs'][-1]}] y[{d['ms'][0]}, {d['ms'][-1]}]")
    if d["implIn"] is False: p.append(f"implied point ({d['gImp']:.3f}, {d['mT']:.3f}) outside grid")
    if not (d["zMin"] <= d["price"] <= d["zMax"]): p.append(f"price {d['price']:.2f} outside grid values [{d['zMin']:.2f}, {d['zMax']:.2f}]")
    if not d["finite"]: p.append("non-finite grid/base values")
    if d["gImp"] is None and not d["warn"]: p.append("implied growth n/a without a warning")
    if d["gImp"] is not None and (d["gImp"] < 0 or d["gImp"] > 0.5) and not d["warn"]: p.append(f"implied growth {d['gImp']:.3f} implausible without a warning")
    if not d["xTicks"] or d["xTicks"] > 8: p.append(f"x labels {d['xTicks']}")
    if not d["yTicks"] or d["yTicks"] > 11: p.append(f"y labels {d['yTicks']}")
    if not (5 <= d["nG"] <= 14 and 5 <= d["nM"] <= 14): p.append(f"grid size {d['nG']}x{d['nM']}")
    if not d["h5"] and not d["bank"] and not d.get("preRevenue"): p.append("historical revenue CAGR missing")
    if not d["wh"] or d["whRows"] < 6: p.append(f"WACC history rows {d['whRows']} (need 5 years + today)")
    return p

def pick(pg, tk):
    """Select a company through the searchable valuation picker (type ticker, Enter)."""
    pg.click("#vPickIn"); pg.fill("#vPickIn", tk); pg.keyboard.press("Enter")


def main():
    args = sys.argv[1:]; url = None
    if "--url" in args: i = args.index("--url"); url = args[i + 1]; del args[i:i + 2]
    exp = None
    if "--export" in args: i = args.index("--export"); exp = args[i + 1]; del args[i:i + 2]
    srv = None; summ = {}
    if not url: srv, url = serve()
    fails, errs = {}, []
    with sync_playwright() as pw:
        b = pw.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 1000}); pg.set_default_timeout(120000)
        pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
        pg.goto(url + "#valuation", wait_until="networkidle"); pg.wait_for_timeout(1500)
        pg.click("button[data-tab=valuation]"); pg.wait_for_timeout(2000)
        tks = args or pg.evaluate("()=>VT")
        for n, tk in enumerate(tks):
            pick(pg, tk); pg.wait_for_function("tk=>document.querySelector('#rvTitle')?.textContent.includes(tk)", arg=tk, timeout=30000)
            pg.wait_for_timeout(1200)
            d = pg.evaluate("tk=>rvDiag(tk)", tk); p = check(d)
            # stale-state check: move the margin slider, leave, come back -> defaults restored
            if n == 0 and len(tks) > 1:
                pg.evaluate("()=>{const i=document.querySelector('#rvSliders input[data-k=m]');i.value=+i.max;i.dispatchEvent(new Event('input'))}"); pg.wait_for_timeout(600)
                if not pg.evaluate("tk=>rvDiag(tk).warn.some(w=>w.includes('custom'))", tk): p.append("custom slider value not flagged")
                other = tks[1]; pick(pg, other); pg.wait_for_timeout(1500)
                pick(pg, tk); pg.wait_for_timeout(1500)
                if check(pg.evaluate("tk=>rvDiag(tk)", tk)): p.append("custom slider value carried over after switching ticker")
            print(f"{'FAIL' if p else 'ok  '} {tk:10} price {d['price']:.2f} implied g {('n/a' if d['gImp'] is None else f'{d['gImp']*100:.1f}%'):>7} "
                  f"base m {d['baseM']*100:.1f}% grid g[{d['gs'][0]*100:.1f},{d['gs'][-1]*100:.1f}] m[{d['ms'][0]*100:.1f},{d['ms'][-1]*100:.1f}] labels {d['xTicks']}/{d['yTicks']}"
                  + (f" warn: {len(d['warn'])}" if d["warn"] else ""))
            for x in p: print("      -", x)
            if p: fails[tk] = p
            if exp:
                pg.evaluate("tk=>{V.mc={}}", tk); summ[tk] = pg.evaluate("tk=>valSummary(tk)", tk)
        for t in ["overview", "company", "risk", "portfolio", "activity", "macro", "valuation"]:
            pg.click(f'button[data-tab="{t}"]'); pg.wait_for_timeout(500)
        b.close()
    if srv: srv.shutdown()
    if errs: print("JS errors:", *errs, sep="\n  ")
    if fails or errs: print(f"\n!! dashboard validation FAILED ({len(fails)} tickers, {len(errs)} JS errors)"); sys.exit(1)
    print(f"\n== dashboard validation passed ({len(tks)} tickers)")
    if exp:
        import datetime as dt
        V = json.load(open(os.path.join(ROOT, "data", "valuation.json")))
        out = {"generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "market-intelligence-dashboard valuation engine (valuation.js valSummary, model defaults)",
               "dashboard": "https://nicolasortizzz.github.io/market-intelligence-dashboard/#valuation", "fx": V.get("fx", {}), "tickers": list(summ), "companies": summ}
        json.dump(out, open(exp, "w"), indent=1); print("== wrote", exp)
        # data/multiples.json: the multiples table for every ticker plus group (sector) median / mean, same engine
        mx = {"generatedAt": out["generatedAt"], "source": "valuation.js multiplesOf / mxGroup (model inputs, USD at official rates)",
              "definitions": {"evEbitda": "EV / TTM EBITDA (EV = market cap + net debt + minority interest)", "pe": "Market cap / TTM net income",
                              "fpe": "Price / next-fiscal-year consensus EPS", "pfcf": "Market cap / last-FY free cash flow", "fcfY": "Last-FY free cash flow / market cap",
                              "divY": "Last-FY cash dividends / market cap", "ndE": "Net debt / TTM EBITDA", "pb": "Price / book (latest quarter)"},
              "companies": {t: {**v["multiples"], "price": v["price"], "priceDate": v["priceDate"], "name": v["name"]} for t, v in summ.items()},
              "groups": {}}
        for t, v in summ.items(): mx["groups"].setdefault(v["group"], v["groupMultiples"])
        mp = os.path.join(os.path.dirname(os.path.abspath(exp)), "multiples.json"); json.dump(mx, open(mp, "w"), indent=1); print("== wrote", mp)

if __name__ == "__main__":
    main()

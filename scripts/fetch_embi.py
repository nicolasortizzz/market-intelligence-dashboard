"""Argentina country risk (J.P. Morgan EMBI spread) -> data/embi.json
Source: api.argentinadatos.com/v1/finanzas/indices/riesgo-pais (free, no key).
The CRP used by the YPF/GGAL models lives in data/valuation_assumptions.json ("crp") and is NOT changed unless
--apply is passed; then crp, betaNote/crpNote texts and the "648 bp"-style labels are updated to the latest close.
Usage: python scripts/fetch_embi.py [--apply]
"""
import json, os, re, sys, datetime as dt, requests
D = os.path.join(os.path.dirname(__file__), "..", "data")

def main():
    d = requests.get("https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais", timeout=40).json()
    last = d[-1]; bp, day = int(last["valor"]), last["fecha"]
    A = json.load(open(os.path.join(D, "valuation_assumptions.json")))
    used = {t: c.get("crp") for t, c in A["companies"].items() if t in ("YPF", "GGAL", "VIST")}
    out = {"generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "bp": bp, "date": day,
           "source": "J.P. Morgan EMBI Argentina via api.argentinadatos.com", "modelCrp": used}
    json.dump(out, open(os.path.join(D, "embi.json"), "w"), indent=1)
    print(f"EMBI Argentina {bp} bp on {day}; model CRP {used}")
    if "--apply" in sys.argv:
        p = os.path.join(D, "valuation_assumptions.json"); s = open(p).read()
        old = {round(v * 1e4) for v in used.values() if v}
        for o in old:
            s = s.replace(f'"crp": {o / 1e4}', f'"crp": {bp / 1e4}')
            s = s.replace(f"{o} bp", f"{bp} bp").replace(f"{o / 100:.2f}%", f"{bp / 100:.2f}%")
        s = re.sub(r"at the close of \d{4}-\d{2}-\d{2}", f"at the close of {day}", s)
        open(p, "w").write(s)
        for f in ("valuation.js", "reverse_dcf.js", "README.md"):
            q = os.path.join(D, "..", f); t = open(q).read()
            for o in old: t = t.replace(f"{o} bp", f"{bp} bp").replace(f"{o / 100:.2f}%", f"{bp / 100:.2f}%")
            t = re.sub(r"(EMBI[^\n]{0,40}?)\d{4}-\d{2}-\d{2}", lambda m: m.group(1) + day, t)
            open(q, "w").write(t)
        print("applied: CRP and labels set to", bp, "bp")

if __name__ == "__main__":
    main()

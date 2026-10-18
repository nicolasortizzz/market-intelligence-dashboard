"""Historical 5-year revenue CAGR (last 5 fiscal years = 5 compounding periods) -> data/revenue_history.json
Sources:
  META, UNH, DIS, NIO, YPF: SEC EDGAR XBRL companyfacts (annual 10-K / 20-F facts, CY frames).
    - NIO: RMB (constant currency, reporting currency); SEC also carries USD convenience translations, shown for reference.
    - YPF: USD facts from its 20-F (ifrs-full:Revenue, USD; YPF's functional currency is USD) - not Yahoo's ARS fields.
  GGAL (bank): "net operating revenue before loan-loss provisions" = Net operating income + loan-loss provisions, from the
    FY2020 Form 20-F (Dec-2020 pesos) and the 4Q2025 earnings release (Dec-2025 pesos), both IAS 29 homogeneous currency.
    USD CAGR converts each year at the BCRA Com. A3500 rate of its year end; real ARS CAGR restates FY2020 to Dec-2025 pesos
    with INDEC CPI (national, base Dec-2016 = 100).
Usage: python scripts/fetch_revenue_history.py
"""
import json, os, time, datetime as dt
import requests

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "revenue_history.json")
UA = {"User-Agent": "Nicolas Ortiz market-intelligence-dashboard niconoa123@gmail.com"}
SEC = {"META": ("us-gaap", ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"], "USD"),
       "UNH": ("us-gaap", ["Revenues"], "USD"),
       "DIS": ("us-gaap", ["Revenues"], "USD"),
       "NIO": ("us-gaap", ["RevenueFromContractWithCustomerExcludingAssessedTax"], "CNY"),
       "YPF": ("ifrs-full", ["Revenue"], "USD")}
END = 2025  # last completed fiscal year for all six names
GGAL = {"FY2020": {"netOperatingIncome": 182711e6, "loanLossProvisions": 34680e6, "fyEnd": "2020-12-31",
                   "source": "Grupo Galicia Form 20-F FY2020 (selected financial data, IFRS, Dec-2020 pesos)",
                   "url": "https://www.sec.gov/Archives/edgar/data/1114700/000119312521129010/d58474d20f.htm"},
        "FY2025": {"netOperatingIncome": 6361832e6, "loanLossProvisions": 2951274e6, "fyEnd": "2025-12-31",
                   "source": "Grupo Galicia 4Q2025 earnings release (12M income statement, Dec-2025 pesos)",
                   "url": "https://b.gfgsa.com/app/uploads/2026/03/PressRelease_GrupoGalicia_4Q2025_EN.pdf"}}

def sec_series(cik, ns, tags, unit):
    j = requests.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json", headers=UA, timeout=60).json()
    out, used = {}, None
    for tag in tags:
        node = j.get("facts", {}).get(ns, {}).get(tag, {}).get("units", {}).get(unit)
        if not node: continue
        for e in node:
            fr = e.get("frame", "")
            if e.get("form") in ("10-K", "20-F") and e.get("fp") == "FY" and fr.startswith("CY") and len(fr) == 6:
                y = int(fr[2:])
                if y not in out: out[y] = {"val": e["val"], "end": e["end"], "accn": e["accn"], "tag": f"{ns}:{tag}"}
        used = used or tag
    return out

def bcra(day):
    d = dt.date.fromisoformat(day)
    for _ in range(5):
        try:
            r = requests.get(f"https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechadesde={(d - dt.timedelta(days=10)).isoformat()}&fechahasta={day}",
                             timeout=30, verify=False).json()["results"]
            x = sorted(r, key=lambda z: z["fecha"])[-1]; return x["fecha"], float(x["detalle"][0]["tipoCotizacion"])
        except Exception as ex: print("bcra retry", ex); time.sleep(3)

def cpi():
    r = requests.get("https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&format=json&limit=1000", timeout=60).json()
    return {row[0][:7]: row[1] for row in r["data"]}

def cagr(a, b, n): return (b / a) ** (1 / n) - 1

def main():
    import warnings; warnings.filterwarnings("ignore")
    m = requests.get("https://www.sec.gov/files/company_tickers.json", headers=UA, timeout=30).json()
    cik = {v["ticker"]: str(v["cik_str"]).zfill(10) for v in m.values()}
    res = {"generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "periods": 5, "companies": {}}
    for t, (ns, tags, unit) in SEC.items():
        s = sec_series(cik[t], ns, tags, unit); y0 = END - 5
        a, b = s[y0], s[END]
        d = {"start": f"FY{y0}", "end": f"FY{END}", "startEnd": a["end"], "endEnd": b["end"], "currency": unit,
             "values": {f"FY{y}": s[y]["val"] for y in range(y0, END + 1) if y in s}, "cagr5": cagr(a["val"], b["val"], 5),
             "definition": "Total revenue as reported", "source": f"SEC EDGAR XBRL companyfacts ({a['tag']}, {unit}; 10-K/20-F)",
             "accn": [a["accn"], b["accn"]]}
        if t == "NIO":
            u = sec_series(cik[t], ns, tags, "USD")
            d["usd"] = {"values": {f"FY{y}": u[y]["val"] for y in range(y0, END + 1) if y in u}, "cagr5": cagr(u[y0]["val"], u[END]["val"], 5),
                        "note": "USD convenience translations from each 20-F (year-end RMB/USD rate), so they mix FX moves"}
            d["note"] = "Constant currency (RMB, reporting currency)."
        if t == "YPF": d["note"] = "USD facts from YPF's 20-F (functional currency USD); Yahoo's ARS-labelled fields are not used."
        if t == "DIS": d["note"] = "Disney fiscal years end on the Saturday nearest 30 September (FY2020 ended 2020-10-03)."
        res["companies"][t] = d; print(t, d["start"], d["end"], unit, round(d["cagr5"] * 100, 2)); time.sleep(0.3)
    # GGAL
    ix = cpi(); g0, g1 = GGAL["FY2020"], GGAL["FY2025"]
    r0 = g0["netOperatingIncome"] + g0["loanLossProvisions"]; r1 = g1["netOperatingIncome"] + g1["loanLossProvisions"]
    f0d, f0 = bcra(g0["fyEnd"]); f1d, f1 = bcra(g1["fyEnd"]); c0, c1 = ix["2020-12"], ix["2025-12"]
    res["companies"]["GGAL"] = {
        "start": "FY2020", "end": "FY2025", "startEnd": g0["fyEnd"], "endEnd": g1["fyEnd"], "currency": "USD",
        "definition": "Net operating revenue before loan-loss provisions (net operating income + loan-loss provisions: NII, net fees, financial-instrument, FX, insurance and other operating income)",
        "values": {"FY2020": r0 / f0, "FY2025": r1 / f1}, "cagr5": cagr(r0 / f0, r1 / f1, 5),
        "fx": {"FY2020": [f0d, f0], "FY2025": [f1d, f1], "source": "BCRA Com. A3500"},
        "ars": {"FY2020_nominal_Dec2020": r0, "FY2025_Dec2025": r1, "cpi": {"2020-12": c0, "2025-12": c1, "source": "INDEC IPC nacional (datos.gob.ar 148.3_INIVELNAL_DICI_M_26)"},
                "FY2020_in_Dec2025_pesos": r0 * c1 / c0, "realCagr5": cagr(r0 * c1 / c0, r1, 5)},
        "afterProvisions": {"realCagr5": cagr(g0["netOperatingIncome"] * c1 / c0, g1["netOperatingIncome"], 5),
                            "usdCagr5": cagr(g0["netOperatingIncome"] / f0, g1["netOperatingIncome"] / f1, 5)},
        "source": g0["source"] + "; " + g1["source"], "urls": [g0["url"], g1["url"]],
        "note": "IAS 29: each year is in pesos of its own year end, converted at that year-end official rate. The Dec-2020 official rate was set under strict capital controls (parallel rate ~2x), which flatters the USD CAGR; FY2025 includes the acquired HSBC Argentina (Galicia Más) from Dec-2024, so growth is partly inorganic."}
    print("GGAL usd", res["companies"]["GGAL"]["cagr5"], "real", res["companies"]["GGAL"]["ars"]["realCagr5"])
    json.dump(res, open(OUT, "w"), indent=1)

if __name__ == "__main__":
    main()

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
       "YPF": ("ifrs-full", ["Revenue"], "USD"),
       "MU": ("us-gaap", ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"], "USD"),
       "ASML": ("us-gaap", ["RevenueFromContractWithCustomerExcludingAssessedTax"], "EUR"),
       "VST": ("us-gaap", ["Revenues"], "USD"),
       "ABEV": ("ifrs-full", ["Revenue"], "BRL"),
       "UBER": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"], "USD"),
       "BE": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"], "USD"),
       "AVGO": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"], "USD"),
       "VIST": ("ifrs-full", ["Revenue"], "USD"),
       "TSM": ("ifrs-full", ["Revenue"], "TWD")}
END = 2025  # common FY2020-FY2025 window for all names (MU has also completed FY2026; shown as "latest")
GGAL = {"FY2020": {"netOperatingIncome": 182711e6, "loanLossProvisions": 34680e6, "fyEnd": "2020-12-31",
                   "source": "Grupo Galicia Form 20-F FY2020 (selected financial data, IFRS, Dec-2020 pesos)",
                   "url": "https://www.sec.gov/Archives/edgar/data/1114700/000119312521129010/d58474d20f.htm"},
        "FY2025": {"netOperatingIncome": 6361832e6, "loanLossProvisions": 2951274e6, "fyEnd": "2025-12-31",
                   "source": "Grupo Galicia 4Q2025 earnings release (12M income statement, Dec-2025 pesos)",
                   "url": "https://b.gfgsa.com/app/uploads/2026/03/PressRelease_GrupoGalicia_4Q2025_EN.pdf"}}

# Filed annual figures not (yet) in XBRL companyfacts; each value checked against the filed document.
SEC_FALLBACK = {"TSM": {2025: {"val": 3809054000000, "end": "2025-12-31", "accn": "0001628280-26-025362", "usd": 121423000000,
                               "tag": "ifrs-full:Revenue (FY2025 20-F filed 2026-04-16, net revenue NT$3,809,054M / US$121,423M convenience translation; not in companyfacts frames)"}},
                "VIST": {2025: {"val": 2474197000, "end": "2025-12-31", "accn": "0001193125-26-187099",
                                "tag": "ifrs-full:Revenue (FY2025 20-F filed 2026-04-28, 'Revenue from contracts with customers' US$2,474,197k; not in companyfacts)"}}}

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

def ecb(day):
    """ECB euro reference rate (USD per EUR) on the last fixing on or before `day`."""
    d = dt.date.fromisoformat(day)
    for i in range(5):   # the ECB API intermittently returns an error page; retry
        try:
            r = requests.get(f"https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod={(d - dt.timedelta(days=10)).isoformat()}&endPeriod={day}&format=csvdata", timeout=30)
            rows = r.text.strip().splitlines(); h = rows[0].split(","); v = rows[-1].split(",")
            return v[h.index("TIME_PERIOD")], float(v[h.index("OBS_VALUE")])
        except Exception as ex:
            if i == 4: raise
            print("ecb retry", ex); time.sleep(5)

def ptax(day):
    """BCB PTAX selling rate (BRL per USD), last fixing on or before `day`."""
    d = dt.date.fromisoformat(day)
    u = ("https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@i,dataFinalCotacao=@f)"
         f"?@i='{(d - dt.timedelta(days=10)).strftime('%m-%d-%Y')}'&@f='{d.strftime('%m-%d-%Y')}'&$format=json")
    v = requests.get(u, timeout=40).json()["value"][-1]; return v["dataHoraCotacao"][:10], float(v["cotacaoVenda"])

def cagr(a, b, n): return (b / a) ** (1 / n) - 1

def main():
    import warnings; warnings.filterwarnings("ignore")
    m = requests.get("https://www.sec.gov/files/company_tickers.json", headers=UA, timeout=30).json()
    cik = {v["ticker"]: str(v["cik_str"]).zfill(10) for v in m.values()}
    res = {"generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "periods": 5, "companies": {}}
    for t, (ns, tags, unit) in SEC.items():
        s = sec_series(cik[t], ns, tags, unit); y0 = END - 5
        for y, v in SEC_FALLBACK.get(t, {}).items(): s.setdefault(y, v)
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
        if t == "MU":
            if END + 1 in s:
                d["latest"] = {"start": f"FY{y0 + 1}", "end": f"FY{END + 1}", "endEnd": s[END + 1]["end"], "cagr5": cagr(s[y0 + 1]["val"], s[END + 1]["val"], 5),
                               "values": {f"FY{y0 + 1}": s[y0 + 1]["val"], f"FY{END + 1}": s[END + 1]["val"]}}
            d["note"] = ("Micron's fiscal year ends on the Thursday closest to 31 August (FY2020 ended 2020-09-03, FY2025 ended 2025-08-28). "
                         "FY2020-FY2025 runs from a mid-cycle year to an early AI-upcycle year; memory revenue is highly cyclical (FY2023 fell 49%)."
                         + (f" On the latest five fiscal years (FY{y0 + 1}-FY{END + 1}, FY{END + 1} ended {s[END + 1]['end']}) the CAGR is {d['latest']['cagr5'] * 100:.1f}%, driven by the 2026 HBM/DRAM price spike." if "latest" in d else ""))
        if t == "ASML":
            (e0d, e0), (e1d, e1) = ecb(a["end"]), ecb(b["end"])
            d["usd"] = {"values": {f"FY{y0}": a["val"] * e0, f"FY{END}": b["val"] * e1}, "cagr5": cagr(a["val"] * e0, b["val"] * e1, 5),
                        "fx": {f"FY{y0}": [e0d, e0], f"FY{END}": [e1d, e1], "source": "ECB euro reference rate"},
                        "note": f"translated at the ECB year-end rates ({e0} USD/EUR on {e0d}, {e1} on {e1d}), so it mixes FX moves"}
            d["note"] = "Constant currency (EUR, reporting currency; US GAAP 20-F net sales)."
        if t == "VST":
            d["note"] = ("Total revenues including hedging/derivative results. Growth is partly inorganic: Energy Harbor (nuclear + retail, closed 2024-03-01) "
                         "added ~4 GW of nuclear; FY2021 includes Winter Storm Uri.")
        if t == "UBER":
            d["note"] = ("FY2020 revenue was COVID-depressed (Mobility gross bookings fell ~46% in 2020 while Delivery surged), so the 5y CAGR overstates the "
                         "run-rate; it also reflects accounting changes (UK/business-model shifts to principal reporting from 2022 raised revenue vs gross bookings) "
                         "and the Postmates (2020) and Transplace (2021, Freight) acquisitions.")
        if t == "TSM":
            u = sec_series(cik[t], ns, tags, "USD")
            for y, v in SEC_FALLBACK["TSM"].items(): u.setdefault(y, {"val": v["usd"]})
            d["usd"] = {"values": {f"FY{y}": u[y]["val"] for y in range(y0, END + 1) if y in u}, "cagr5": cagr(u[y0]["val"], u[END]["val"], 5),
                        "note": "USD convenience translations from each 20-F (year-end NT$/US$ rate), so they mix FX moves"}
            d["note"] = ("Constant currency (TWD, reporting currency; IFRS net revenue). FY2020-FY2025 is almost entirely organic, "
                         "driven by HPC/AI accelerators (N5/N3, CoWoS); FY2023 dipped on the smartphone/PC inventory correction.")
        if t == "VIST":
            d["note"] = ("Reported in USD (IFRS, USD functional currency). FY2020 was COVID-depressed (Brent ~$42, Vaca Muerta activity halted in Q2-2020); "
                         "growth is mostly organic shale ramp-up, but FY2025 is partly inorganic: Vista acquired Petronas' 50% of La Amarga Chica (LLL) in Apr-2025, "
                         "adding ~40k boe/d gross. Revenue also moves with Brent.")
        if t == "AVGO":
            d["note"] = ("Broadcom fiscal years end on the Sunday closest to 31 October (FY2020 ended 2020-11-01, FY2025 on 2025-11-02). "
                         "Growth is partly inorganic: VMware (closed 2023-11-22, ~$69B) added ~$13-14B of annual infrastructure-software revenue from FY2024; "
                         "FY2025 also reflects the AI ASIC/networking ramp. Organic semiconductor growth is lower than the headline CAGR.")
        if t == "BE":
            d["note"] = ("Total revenue (product, installation, service, electricity). FY2025 includes the first large AI data-center deployments "
                         "(AEP, Oracle, Equinix) and Korea (SK ecoplant) volumes; Korea shipments are lumpy year to year.")
        if t == "ABEV":
            (p0d, p0), (p1d, p1) = ptax(a["end"]), ptax(b["end"])
            d["usd"] = {"values": {f"FY{y0}": a["val"] / p0, f"FY{END}": b["val"] / p1}, "cagr5": cagr(a["val"] / p0, b["val"] / p1, 5),
                        "fx": {f"FY{y0}": [p0d, p0], f"FY{END}": [p1d, p1], "source": "BCB PTAX"},
                        "note": f"translated at the BCB PTAX year-end rates ({p0} BRL/USD on {p0d}, {p1} on {p1d}), so it mixes FX moves"}
            d["note"] = ("Constant currency (BRL, reporting currency; IFRS 20-F net revenue). Includes Argentina (Quilmes) under IAS 29 hyperinflation "
                         "accounting, which inflates nominal growth in some years.")
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

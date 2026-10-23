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
       "TSM": ("ifrs-full", ["Revenue"], "TWD"),
       "GOOGL": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "XOM": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "CVX": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "COP": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "EOG": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "OXY": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "DVN": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "SLB": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "CEG": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "NRG": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "NEE": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "DUK": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "SO": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "AEP": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "GEV": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "FSLR": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesAndOtherIncome"], "USD"),
       "MRK": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"], "USD"),
       "BMY": ("us-gaap", ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"], "USD"),
       "BEP": ("ifrs-full", ["Revenue"], "USD"),
       "PBR": ("ifrs-full", ["Revenue"], "USD")}
END = 2025  # common FY2020-FY2025 window for all names (MU has also completed FY2026; shown as "latest")
GGAL = {"FY2020": {"netOperatingIncome": 182711e6, "loanLossProvisions": 34680e6, "fyEnd": "2020-12-31",
                   "source": "Grupo Galicia Form 20-F FY2020 (selected financial data, IFRS, Dec-2020 pesos)",
                   "url": "https://www.sec.gov/Archives/edgar/data/1114700/000119312521129010/d58474d20f.htm"},
        "FY2025": {"netOperatingIncome": 6361832e6, "loanLossProvisions": 2951274e6, "fyEnd": "2025-12-31",
                   "source": "Grupo Galicia 4Q2025 earnings release (12M income statement, Dec-2025 pesos)",
                   "url": "https://b.gfgsa.com/app/uploads/2026/03/PressRelease_GrupoGalicia_4Q2025_EN.pdf"}}

# SPCX (IPO 2026-06-12, no 10-K yet; XBRL companyfacts only has the 2025-26 10-Q). Annual revenue from the IPO prospectus
# (424B4, accession 0001628280-26-042639, consolidated statements recast for the xAI/X common-control mergers): only FY2023-FY2025
# exist, i.e. 2 compounding periods. Segment split from the revenue-disaggregation note; latest TTM from the Q3 2026 8-K (Ex-99.1).
SPCX = {"values": {"FY2023": 10387e6, "FY2024": 14015e6, "FY2025": 18674e6}, "ends": ("2023-12-31", "2025-12-31"),
        "segments": {"Space": {"FY2023": 3557e6, "FY2024": 3796e6, "FY2025": 4086e6},
                     "Connectivity": {"FY2023": 3869e6, "FY2024": 7599e6, "FY2025": 11387e6},
                     "AI (now SI)": {"FY2023": 2961e6, "FY2024": 2620e6, "FY2025": 3201e6}},
        "ttm": {"end": "2026-09-30", "val": 32043e6, "accn": "0001628280-26-066482"},  # 9M-2026 27,083 + Q4-2025 4,960
        "accn": ["0001628280-26-042639"]}

# Samsung Electronics (005930.KS): not an SEC filer. K-IFRS consolidated revenue (KRW million) from the annual business reports /
# Q4 earnings releases (FY2020 236,806,988; FY2021 279,604,799); FY2022-FY2025 also match Yahoo's statements.
# SK hynix (000660.KS): not an SEC filer. K-IFRS consolidated revenue (KRW million) from the annual business reports / Q4 earnings
# releases (FY2020 31,900,418; FY2021 42,997,792); FY2022-FY2025 also match Yahoo's statements.
SKHYNIX = {"FY2020": 31900418e6, "FY2021": 42997792e6, "FY2022": 44621568e6, "FY2023": 32765719e6, "FY2024": 66192960e6, "FY2025": 97146675e6}
SAMSUNG = {"FY2020": 236806988e6, "FY2021": 279604799e6, "FY2022": 302231360e6, "FY2023": 258935494e6, "FY2024": 300870903e6, "FY2025": 333605938e6}

# Year-end FX fixings never change: cache them (data/fx_yearend_cache.json) so an ECB/BCB outage does not break the update.
FXCACHE_P = os.path.join(os.path.dirname(OUT), "fx_yearend_cache.json")
FXCACHE = json.load(open(FXCACHE_P)) if os.path.exists(FXCACHE_P) else {}
def cached(key, fn):
    if key in FXCACHE: return tuple(FXCACHE[key])
    v = fn(); FXCACHE[key] = list(v); json.dump(FXCACHE, open(FXCACHE_P, "w"), indent=1); return v

def ptax_ye(day):
    """BCB PTAX selling rate (BRL per USD), last fixing on or before `day` (official Brazilian rate)."""
    def go():
        d = dt.date.fromisoformat(day)
        u = ("https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@i,dataFinalCotacao=@f)"
             f"?@i='{(d - dt.timedelta(days=10)).strftime('%m-%d-%Y')}'&@f='{d.strftime('%m-%d-%Y')}'&$format=json")
        v = requests.get(u, timeout=40).json()["value"][-1]; return v["dataHoraCotacao"][:10], float(v["cotacaoVenda"])
    return cached(f"PTAX|{day}", go)

def boc_ye(day):
    """Bank of Canada daily rate (CAD per USD), last observation on or before `day`."""
    def go():
        d = dt.date.fromisoformat(day)
        o = requests.get(f"https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date={(d - dt.timedelta(days=10)).isoformat()}&end_date={day}", timeout=40).json()["observations"][-1]
        return o["d"], float(o["FXUSDCAD"]["v"])
    return cached(f"BOC|{day}", go)

def ecb_ccy(ccy, day): return cached(f"{ccy}|{day}", lambda: _ecb_ccy(ccy, day))
def _ecb_ccy(ccy, day):
    """ECB reference rate for `ccy` per EUR on the last fixing on or before `day`."""
    d = dt.date.fromisoformat(day)
    for i in range(5):
        try:
            r = requests.get(f"https://data-api.ecb.europa.eu/service/data/EXR/D.{ccy}.EUR.SP00.A?startPeriod={(d - dt.timedelta(days=10)).isoformat()}&endPeriod={day}&format=csvdata", timeout=30)
            rows = r.text.strip().splitlines(); h = rows[0].split(","); v = rows[-1].split(",")
            return v[h.index("TIME_PERIOD")], float(v[h.index("OBS_VALUE")])
        except Exception as ex:
            if i == 4: raise
            print("ecb retry", ex); time.sleep(5)

# Non-SEC local filers: consolidated revenue in the reporting currency, hand-entered from the regulator's open data
# (Brazil: CVM DFP "DRE consolidado" line 3.01 Receita de Venda, dados.cvm.gov.br, BRL thousand -> BRL). Add one dict per ticker.
LOCAL_REV = {
    "PRIO3.SA": {"ccy": "BRL", "values": {"FY2020": 1904185e3, "FY2021": 4396003e3, "FY2022": 6363475e3, "FY2023": 11905041e3, "FY2024": 14360653e3, "FY2025": 15583960e3},
                 "source": "CVM DFP consolidated statements (dados.cvm.gov.br, line 3.01), PRIO S.A. CNPJ 10.629.105/0001-68",
                 "note": "Constant currency (BRL). Growth is largely inorganic: Frade (2021-22), Albacora Leste (2023), Peregrino (2025) acquisitions; also tracks Brent."},
    "CCJ": {"ccy": "CAD", "values": {"FY2020": 1800071e3, "FY2025": 3481933e3}, "source": "Cameco annual reports (FY2020 MD&A revenue C$1,800M; FY2025 C$3,482M, Yahoo statements)", "note": "Constant currency (CAD, reporting currency). Uranium contract repricing; Westinghouse (49%, from Nov-2023) is equity-accounted, not in revenue."},
    "AXIA3.SA": {"ccy": "BRL", "values": {"FY2020": 29080513e3, "FY2025": 41281596e3}, "source": "CVM DFP consolidated statements (dados.cvm.gov.br, line 3.01), Axia Energia S.A. (ex-Centrais Elétricas Brasileiras - Eletrobras) CNPJ 00.001.180/0001-26", "note": "Constant currency (BRL). Privatised in 2022 (capitalisation); generation + transmission; renamed Axia Energia in 2025."},
    "EQTL3.SA": {"ccy": "BRL", "values": {"FY2020": 17890069e3, "FY2025": 52073804e3}, "source": "CVM DFP consolidated statements (dados.cvm.gov.br, line 3.01), Equatorial S.A. CNPJ 03.220.438/0001-73", "note": "Constant currency (BRL). Largely inorganic: CEEE-D, CEA, Celg-D (2021-23), Echoenergia and Sabesp stake; includes IFRS construction revenue."},
    "CMIG4.SA": {"ccy": "BRL", "values": {"FY2020": 25227625e3, "FY2025": 42751283e3}, "source": "CVM DFP consolidated statements (dados.cvm.gov.br, line 3.01), Cia Energética de Minas Gerais - CEMIG CNPJ 17.155.730/0001-64", "note": "Constant currency (BRL). Includes IFRS (ICPC 01) construction revenue and pass-through energy costs."},
    "TAEE11.SA": {"ccy": "BRL", "values": {"FY2020": 3561286e3, "FY2025": 4624113e3}, "source": "CVM DFP consolidated statements (dados.cvm.gov.br, line 3.01), Transmissora Aliança de Energia Elétrica S.A. (Taesa) CNPJ 07.859.971/0001-30", "note": "Constant currency (BRL). IFRS 15 contract-asset revenue (includes construction and IGP-M/IPCA inflation remeasurement), not the regulated RAP."},
    "CPFE3.SA": {"ccy": "BRL", "values": {"FY2020": 30898458e3, "FY2025": 44367780e3}, "source": "CVM DFP consolidated statements (dados.cvm.gov.br, line 3.01), CPFL Energia S.A. CNPJ 02.429.144/0001-93", "note": "Constant currency (BRL). Includes construction revenue and sector pass-through charges."},
    "EGIE3.SA": {"ccy": "BRL", "values": {"FY2020": 12259159e3, "FY2025": 12860075e3}, "source": "CVM DFP consolidated statements (dados.cvm.gov.br, line 3.01), Engie Brasil Energia S.A. CNPJ 02.474.103/0001-19", "note": "Constant currency (BRL). Generation + transmission build-out (TAG gas pipeline stake is equity-accounted)."},
    "CPLE3.SA": {"ccy": "BRL", "values": {"FY2020": 18633249e3, "FY2025": 26116856e3}, "source": "CVM DFP consolidated statements (dados.cvm.gov.br, line 3.01), Cia Paranaense de Energia - Copel CNPJ 76.483.817/0001-20", "note": "Constant currency (BRL). Privatised (corporation) in 2023; sold Copel Telecom (2021); includes construction revenue."},
}
# Filed annual figures not (yet) in XBRL companyfacts; each value checked against the filed document.
SEC_FALLBACK = {"XOM": {2020: {"val": 178574e6, "end": "2020-12-31", "accn": "", "tag": "10-K FY2020 'Sales and other operating revenue' (XOM tags revenue with a company extension, not in us-gaap frames)"},
                        2025: {"val": 323905e6, "end": "2025-12-31", "accn": "", "tag": "10-K FY2025 'Sales and other operating revenue' (Yahoo statements, same line)"}},
                "OXY": {2020: {"val": 17809e6, "end": "2020-12-31", "accn": "", "tag": "10-K FY2020 net sales (CY2020 frame missing in companyfacts)"}},
                "PBR": {2025: {"val": 89186e6, "end": "2025-12-31", "accn": "", "tag": "20-F FY2025 sales revenues, USD (not yet in companyfacts; Yahoo statements)"}},
                "TSM": {2025: {"val": 3809054000000, "end": "2025-12-31", "accn": "0001628280-26-025362", "usd": 121423000000,
                               "tag": "ifrs-full:Revenue (FY2025 20-F filed 2026-04-16, net revenue NT$3,809,054M / US$121,423M convenience translation; not in companyfacts frames)"}},
                "VIST": {2025: {"val": 2474197000, "end": "2025-12-31", "accn": "0001193125-26-187099",
                                "tag": "ifrs-full:Revenue (FY2025 20-F filed 2026-04-28, 'Revenue from contracts with customers' US$2,474,197k; not in companyfacts)"}}}

# Shorter histories (spin-offs): the longest available window is used and flagged (periods < 5)
SHORT = {"GEV": "GE Vernova was spun off from GE on 2024-04-02; its SEC filings carry audited revenue from FY2022 only, so a 3-year window is used"}
SEC_FALLBACK["AEP"] = {2020: {"val": 14918.5e6, "end": "2020-12-31", "accn": "", "tag": "10-K FY2020 total revenues (CY2020 frame missing in companyfacts)"}}

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

def ecb(day): return cached(f"USD|{day}", lambda: _ecb(day))
def _ecb(day):
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
        if y0 not in s and SHORT.get(t):   # spin-offs: longest available window (fewer than 5 compounding periods, flagged)
            y0 = min(y for y in s if y > END - 5)
        n = END - y0; a, b = s[y0], s[END]
        d = {"start": f"FY{y0}", "end": f"FY{END}", "startEnd": a["end"], "endEnd": b["end"], "currency": unit,
             "values": {f"FY{y}": s[y]["val"] for y in range(y0, END + 1) if y in s}, "cagr5": cagr(a["val"], b["val"], n),
             **({"periods": n, "shortNote": SHORT[t]} if n < 5 else {}),
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
    v = SAMSUNG; fxs = {}
    for y, day in (("FY2020", "2020-12-31"), ("FY2025", "2025-12-31")):
        (kd_, krw), (_, usd) = ecb_ccy("KRW", day), ecb_ccy("USD", day); fxs[y] = [kd_, krw / usd]
    res["companies"]["005930.KS"] = {
        "start": "FY2020", "end": "FY2025", "startEnd": "2020-12-31", "endEnd": "2025-12-31", "currency": "KRW", "values": v,
        "cagr5": cagr(v["FY2020"], v["FY2025"], 5),
        "usd": {"values": {y: v[y] / fxs[y][1] for y in fxs}, "cagr5": cagr(v["FY2020"] / fxs["FY2020"][1], v["FY2025"] / fxs["FY2025"][1], 5),
                "fx": {**fxs, "source": "ECB reference-rate cross (KRW/EUR / USD/EUR)"},
                "note": f"translated at the ECB year-end cross rates ({fxs['FY2020'][1]:.1f} KRW/USD on {fxs['FY2020'][0]}, {fxs['FY2025'][1]:.1f} on {fxs['FY2025'][0]}), so it mixes FX moves"},
        "definition": "Consolidated revenue (K-IFRS)", "source": "Samsung Electronics annual business reports and Q4 earnings releases (FY2020-FY2021); Yahoo Finance statements (FY2022-FY2025)",
        "accn": [],
        "note": ("Constant currency (KRW, reporting currency). FY2020-FY2025 includes a full memory cycle: the 2021-22 boom, the 2023 bust (-14%) and the AI-driven "
                 "recovery; FY2026 (consensus ~KRW 710T, +113%) is outside the window.")}
    print("005930.KS", round(res["companies"]["005930.KS"]["cagr5"] * 100, 2))
    v = SKHYNIX; fxs = {}
    for y, day in (("FY2020", "2020-12-31"), ("FY2025", "2025-12-31")):
        (kd_, krw), (_, usd) = ecb_ccy("KRW", day), ecb_ccy("USD", day); fxs[y] = [kd_, krw / usd]
    res["companies"]["000660.KS"] = {
        "start": "FY2020", "end": "FY2025", "startEnd": "2020-12-31", "endEnd": "2025-12-31", "currency": "KRW", "values": v,
        "cagr5": cagr(v["FY2020"], v["FY2025"], 5),
        "usd": {"values": {y: v[y] / fxs[y][1] for y in fxs}, "cagr5": cagr(v["FY2020"] / fxs["FY2020"][1], v["FY2025"] / fxs["FY2025"][1], 5),
                "fx": {**fxs, "source": "ECB reference-rate cross (KRW/EUR / USD/EUR)"},
                "note": f"translated at the ECB year-end cross rates ({fxs['FY2020'][1]:.1f} KRW/USD on {fxs['FY2020'][0]}, {fxs['FY2025'][1]:.1f} on {fxs['FY2025'][0]}), so it mixes FX moves"},
        "definition": "Consolidated revenue (K-IFRS)", "source": "SK hynix annual business reports and Q4 earnings releases (FY2020-FY2021); Yahoo Finance statements (FY2022-FY2025)",
        "accn": [],
        "note": ("Constant currency (KRW, reporting currency). FY2020-FY2025 includes a full memory cycle: the 2021-22 boom, the 2023 bust (-27%) and the HBM-led "
                 "recovery (FY2024 +102%, FY2025 +47%); FY2026 (consensus ~KRW 344T, +254%) is outside the window.")}
    print("000660.KS", round(res["companies"]["000660.KS"]["cagr5"] * 100, 2))
    for t, L in LOCAL_REV.items():
        v = L["values"]; fxs = {}
        for y, day in (("FY2020", "2020-12-31"), ("FY2025", "2025-12-31")):
            if L["ccy"] == "BRL": fxs[y] = list(ptax_ye(day))
            elif L["ccy"] == "CAD": fxs[y] = list(boc_ye(day))
            else: (kd_, lc), (_, usd) = ecb_ccy(L["ccy"], day), ecb_ccy("USD", day); fxs[y] = [kd_, lc / usd]
        res["companies"][t] = {"start": "FY2020", "end": "FY2025", "startEnd": "2020-12-31", "endEnd": "2025-12-31", "currency": L["ccy"], "values": v,
            "cagr5": cagr(v["FY2020"], v["FY2025"], 5),
            "usd": {"values": {y: v[y] / fxs[y][1] for y in fxs}, "cagr5": cagr(v["FY2020"] / fxs["FY2020"][1], v["FY2025"] / fxs["FY2025"][1], 5),
                    "fx": {**fxs, "source": "BCB PTAX selling rate" if L["ccy"] == "BRL" else "Bank of Canada daily rate (FXUSDCAD)" if L["ccy"] == "CAD" else f"ECB reference-rate cross ({L['ccy']}/EUR / USD/EUR)"},
                    "note": f"translated at the {'BCB PTAX' if L['ccy'] == 'BRL' else 'Bank of Canada' if L['ccy'] == 'CAD' else 'ECB'} year-end rates ({fxs['FY2020'][1]:.3f} {L['ccy']}/USD on {fxs['FY2020'][0]}, {fxs['FY2025'][1]:.3f} on {fxs['FY2025'][0]}), so it mixes FX moves"},
            "definition": L.get("definition", "Consolidated net revenue"), "source": L["source"], "accn": [], "note": L["note"]}
        print(t, round(res["companies"][t]["cagr5"] * 100, 2))
    v = SPCX["values"]; n = 2
    res["companies"]["SPCX"] = {
        "start": "FY2023", "end": "FY2025", "startEnd": SPCX["ends"][0], "endEnd": SPCX["ends"][1], "currency": "USD", "periods": n,
        "values": v, "cagr5": cagr(v["FY2023"], v["FY2025"], n),
        "segments": {k: {**x, "cagr": cagr(x["FY2023"], x["FY2025"], n)} for k, x in SPCX["segments"].items()},
        "definition": "Total revenue as reported (recast to include xAI and X Holdings under common control)",
        "source": "SpaceX IPO prospectus (Form 424B4 filed 2026-06-12, accession 0001628280-26-042639), consolidated statements of operations",
        "accn": SPCX["accn"],
        "shortNote": "SpaceX IPO'd on 2026-06-12 and the prospectus only contains audited FY2023-FY2025; FY2021-FY2022 are not disclosed, so the longest available window (2 years) is used",
        "note": ("Only FY2023-FY2025 are available (2 compounding periods, not 5). Figures are recast for the common-control mergers with xAI (Feb-2026) and X Holdings "
                 "(Mar-2025), so X/Twitter advertising is included in every year; Cursor (Aug-2026) is not. Segment CAGRs FY2023-25: Space "
                 f"{cagr(3557, 4086, 2) * 100:.1f}%, Connectivity (Starlink) {cagr(3869, 11387, 2) * 100:.1f}%, AI {cagr(2961, 3201, 2) * 100:.1f}% (X advertising fell). "
                 f"Latest TTM (to 2026-09-30): $32.0B (Q3 2026 8-K); Q3 2026 revenue alone was $14.6B, +161% y/y.")}
    print("SPCX", round(res["companies"]["SPCX"]["cagr5"] * 100, 2), "(2 periods)")
    json.dump(res, open(OUT, "w"), indent=1)

if __name__ == "__main__":
    main()

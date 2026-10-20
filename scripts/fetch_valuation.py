"""Fetch real financials for the Valuation & M&A tab -> data/valuation.json
Sources: Yahoo Finance (yfinance) statements/estimates/info, SEC EDGAR XBRL companyfacts.
Usage: python scripts/fetch_valuation.py [TICKER ...]   (run after fetch_data.py so macro.json exists)
       With tickers, only those are re-fetched and merged into the existing valuation.json.
Argentine names: YPF keeps its books in USD (functional currency) although Yahoo labels it ARS, so
its balance sheet / TTM figures are taken from the USD statements. GGAL is valued as a bank (residual income):
book value per ADR = IAS 29-restated equity (ARS) / ADR-equivalent shares / BCRA A3500 rate on the balance-sheet date.
"""
import json, os, re, time, datetime as dt, math
import numpy as np, pandas as pd, requests, yfinance as yf

OUT = os.path.join(os.path.dirname(__file__), "..", "data")
UA = {"User-Agent": "Nicolas Ortiz market-intelligence-dashboard niconoa123@gmail.com"}
TARGETS = {"META": ["GOOGL", "SNAP", "PINS", "AMZN", "MSFT"],
           "UNH": ["CVS", "ELV", "CI", "HUM", "CNC"],
           "DIS": ["NFLX", "CMCSA", "WBD", "SONY", "PSKY"],
           "NIO": ["TSLA", "LI", "XPEV", "RIVN", "BYDDY"],
           "YPF": ["VIST", "PAM", "PBR", "EC"],
           "GGAL": ["BMA", "BBAR", "SUPV", "ITUB", "CIB"],
           "MU": ["000660.KS", "005930.KS", "WDC", "SNDK", "NVDA", "AMD"],   # NVDA/AMD: reference only (excluded from comps stats)
           "ASML": ["AMAT", "LRCX", "KLAC", "8035.T"],
           "VST": ["CEG", "NRG", "TLN", "PEG", "ETR"],
           "ABEV": ["BUD", "HEINY", "FMX", "CABGY", "STZ"],
           "UBER": ["LYFT", "DASH", "GRAB", "CART", "ABNB", "BKNG"],
           "BE": ["PLUG", "FCEL", "BLDP", "GEV", "ETN", "VRT", "FLNC"],
           "AVGO": ["NVDA", "AMD", "MRVL", "QCOM", "TXN", "ADI", "ANET", "ORCL", "MSFT"],
           "VIST": ["YPF", "PAM", "PBR", "EC", "EOG", "DVN", "FANG"],
           "TSM": ["005930.KS", "INTC", "UMC", "GFS", "0981.HK", "ASML", "AMAT"],
           "005930.KS": ["000660.KS", "MU", "TSM", "AAPL", "1810.HK", "SNDK", "WDC"],
           "SPCX": ["RKLB", "ASTS", "IRDM", "SATS", "VSAT", "LMT", "NOC", "TMUS"]}
# Local-currency listings (Samsung: KRX common in KRW). Price, market cap, 52w range and targets are converted to USD at the
# official rate (fx.KRWUSD: ECB reference rates, KRW/EUR divided by USD/EUR, same fixing date); KRW originals are kept as *Local.
LOCAL_LISTING = {"005930.KS": {"ccy": "KRW", "related": {"005935.KS": "Preferred shares (KRX)", "SMSN.IL": "GDR, London (1 GDR = 25 common shares)"}}}
SEC_APPEND = {"MU"}          # Yahoo annual statements lag the latest 10-K (MU FY2026 ended 2026-09-03): append that year from SEC XBRL
USD_STMT = {"YPF"}           # statements reported in USD even though Yahoo's financialCurrency says ARS
BANKS = {"GGAL": 10}
# Latest filed quarter newer than Yahoo's snapshot (applied only while Yahoo's last quarter is older than "period").
# SPCX: Q3 2026 earnings release (8-K Ex-99.1, accession 0001628280-26-066482, filed 2026-10-20), USD millions.
FILING_OVERRIDE = {"SPCX": {"period": "2026-09-30", "accn": "0001628280-26-066482",
    "source": "SpaceX Q3 2026 earnings release (8-K Ex-99.1, filed 2026-10-20)",
    "shares": 13579e6,            # Class A 8,240M + Class B 5,339M outstanding at 2026-09-30
    "totalCash": 89855e6,         # cash 51,294 + marketable securities 38,561
    "totalDebt": 38844e6,         # debt and finance leases, current 2,698 + non-current 36,146
    "revenueTTM": 32043e6,        # 9M-2026 27,083 + Q4-2025 4,960 (FY2025 18,674 - 9M-2025 13,714)
    "ebitdaTTM": 10183e6,         # GAAP EBIT TTM -668 (705 + Q4-2025 -1,373) + D&A TTM 10,851 (8,934 + 6,701 - 4,784)
    "netIncomeTTM": -2760e6,      # 9M-2026 -413 + Q4-2025 -2,347 (FY2025 -4,937 - 9M-2025 -2,590)
    "equity": 176768e6}}          # ticker -> local shares per ADR (GGAL: 1 ADS = 10 Class B shares)
ROWS = {"income": ["Total Revenue", "Gross Profit", "Operating Income", "EBIT", "EBITDA", "Normalized EBITDA",
                   "Reconciled Depreciation", "Net Income", "Diluted EPS", "Diluted Average Shares", "Tax Rate For Calcs",
                   "Research And Development", "Interest Expense"],
        "cashflow": ["Operating Cash Flow", "Capital Expenditure", "Free Cash Flow", "Stock Based Compensation",
                     "Repurchase Of Capital Stock", "Cash Dividends Paid", "Change In Working Capital", "Issuance Of Capital Stock"],
        "balance": ["Total Debt", "Net Debt", "Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments",
                    "Minority Interest", "Stockholders Equity", "Total Assets", "Ordinary Shares Number", "Capital Lease Obligations",
                    "Investments And Advances"]}
SEC_TAGS = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "OperatingIncomeLoss", "NetIncomeLoss",
            "PaymentsToAcquirePropertyPlantAndEquipment", "NetCashProvidedByUsedInOperatingActivities",
            "Revenue", "ProfitLossAttributableToOwnersOfParent", "EquityAttributableToOwnersOfParent"]  # last three: IFRS (20-F filers)

def f(x):
    try:
        x = float(x); return None if math.isnan(x) or math.isinf(x) else x
    except Exception: return None

def stmt(df, rows):
    out = {}
    if df is None or df.empty: return out
    cols = sorted(df.columns)[-6:]
    out["years"] = [c.strftime("%Y-%m-%d") for c in cols]
    for r in rows:
        if r in df.index: out[r] = [f(df.loc[r, c]) for c in cols]
    return out

def est(df):
    if df is None or len(df) == 0: return {}
    return {i: {k: f(v) if k != "currency" else v for k, v in row.items()} for i, row in df.iterrows()}

FXC = {}
def fx_to_usd(cur):
    """Units of `cur` per 1 USD (Yahoo FX)."""
    if not cur or cur == "USD": return 1.0
    if cur not in FXC: FXC[cur] = f(yf.Ticker(f"{cur}=X").history(period="5d")["Close"].iloc[-1])
    return FXC[cur]

def multiples(t):
    """Peer multiples recomputed consistently in USD (Yahoo's own ratios mix ADR/reporting currencies)."""
    i = yf.Ticker(t).info or {}
    fin = i.get("financialCurrency") or "USD"; k = fx_to_usd(fin)
    mc = i.get("marketCap"); qc = i.get("currency") or "USD"
    if mc and qc != "USD": mc = mc / fx_to_usd(qc)   # local listings (KRW, JPY): market cap to USD
    debt = (i.get("totalDebt") or 0) / k; cash = (i.get("totalCash") or 0) / k
    rev = (i.get("totalRevenue") or 0) / k or None; ebitda = (i.get("ebitda") or 0) / k or None
    ni = (i.get("netIncomeToCommon") or 0) / k or None
    book = None
    try:
        qb = yf.Ticker(t).quarterly_balance_sheet
        if qb is not None and "Stockholders Equity" in qb.index:
            book = f(qb.loc["Stockholders Equity"].dropna().iloc[0]) / k
    except Exception: pass
    ev = mc + debt - cash if mc else None
    fpe = i.get("forwardPE") if fin == (i.get("currency") or "USD") else None
    return {"ticker": t, "name": i.get("shortName"), "marketCap": mc, "ev": ev, "revenue": rev, "ebitda": ebitda, "netIncome": ni,
            "evSales": ev / rev if ev and rev else None, "evEbitda": ev / ebitda if ev and ebitda and ebitda > 0 else None,
            "pe": mc / ni if mc and ni and ni > 0 else None, "forwardPE": fpe if fpe and fpe > 0 else None,
            "revenueGrowth": i.get("revenueGrowth"), "ebitdaMargin": ebitda / rev if ebitda and rev else None,
            "opMargin": i.get("operatingMargins"), "beta": i.get("beta"), "financialCurrency": fin,
            "book": book, "pb": mc / book if mc and book and book > 0 else None, "roe": i.get("returnOnEquity")}

def sec_facts(cik_map, t):
    c = cik_map.get(t)
    if not c: return {}
    try:
        j = requests.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{c}.json", headers=UA, timeout=40).json()
    except Exception: return {}
    out = {"cik": int(c), "entity": j.get("entityName")}
    for ns in ("us-gaap", "ifrs-full"):
        for tag in SEC_TAGS:
            node = j.get("facts", {}).get(ns, {}).get(tag)
            if not node: continue
            unit = next(iter(node["units"]))
            fy = {}
            for e in node["units"][unit]:
                if e.get("form") in ("10-K", "20-F") and e.get("fp") == "FY" and e.get("frame", "").startswith("CY") and len(e.get("frame", "")) == 6:
                    fy[e["frame"][2:]] = e["val"]
            if fy and tag not in out:
                out[tag] = {"unit": unit, "ns": ns, "fy": dict(sorted(fy.items())[-10:])}
    return out

def ecb_eurusd():
    """ECB euro foreign exchange reference rate (USD per EUR), latest observation."""
    r = requests.get("https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=1&format=csvdata", timeout=30)
    row = r.text.strip().splitlines(); hdr = row[0].split(","); v = row[-1].split(",")
    return v[hdr.index("TIME_PERIOD")], float(v[hdr.index("OBS_VALUE")])

def cbc_twd():
    """Central Bank of the R.O.C. (Taiwan) NT$/US$ interbank closing rate: latest date on the CBC key-indicator page."""
    for _ in range(3):
        try:
            t = requests.get("https://www.cbc.gov.tw/en/lp-700-2.html", headers={"User-Agent": "Mozilla/5.0"}, timeout=40, verify=False).text  # cbc.gov.tw cert lacks a Subject Key Identifier (rejected by Python 3.13); public read-only page, as for api.bcra.gob.ar
            m = re.search(r'data-th="Date"><span>(\d{4})/(\d{2})/(\d{2})</span></td>\s*<td data-th="NTD/USD"><span>([\d.]+)</span>', t)
            if m: return f"{m.group(1)}-{m.group(2)}-{m.group(3)}", float(m.group(4))
        except Exception as ex: print("cbc retry", ex)
        time.sleep(3)
    return None, None

def ecb_cross(ccy):
    """ECB reference rate cross: units of `ccy` per USD = (ccy per EUR) / (USD per EUR), both on the same latest fixing date."""
    for _ in range(4):
        try:
            out = {}
            for c in (ccy, "USD"):
                r = requests.get(f"https://data-api.ecb.europa.eu/service/data/EXR/D.{c}.EUR.SP00.A?lastNObservations=1&format=csvdata", timeout=30)
                row = r.text.strip().splitlines(); hdr = row[0].split(","); v = row[-1].split(",")
                out[c] = (v[hdr.index("TIME_PERIOD")], float(v[hdr.index("OBS_VALUE")]))
            if out[ccy][0] == out["USD"][0]: return out[ccy][0], out[ccy][1] / out["USD"][1]
        except Exception as ex: print("ecb cross retry", ex)
        time.sleep(3)
    return None, None

def local_listing(d, cfg, k):
    """Convert a local listing's market fields to USD; keep the originals and quote related lines (preferred, GDR)."""
    fx = FXC[cfg["ccy"]]
    for f_ in ("price", "low52", "high52", "targetLow", "targetMean", "targetMedian", "targetHigh", "marketCap", "enterpriseValue"):
        if d.get(f_) is not None: d[f_ + "Local"] = d[f_]; d[f_] = d[f_] / fx
    d["currencyLocal"] = cfg["ccy"]; d["currency"] = "USD"; d["related"] = {}
    for t, lbl in cfg["related"].items():
        try:
            i = yf.Ticker(t).info or {}; h = yf.Ticker(t).history(period="10d")["Close"].dropna()
            d["related"][t] = {"label": lbl, "price": f(h.iloc[-1]), "priceDate": h.index[-1].strftime("%Y-%m-%d"), "currency": i.get("currency"),
                               "shares": i.get("sharesOutstanding")}
        except Exception as ex: print("related fail", t, ex)

def ptax(day=None):
    """Banco Central do Brasil PTAX (selling rate, BRL per USD): last fixing on or before `day` (default today)."""
    d = dt.date.fromisoformat(day) if day else dt.date.today()
    a = (d - dt.timedelta(days=10)).strftime("%m-%d-%Y"); b = d.strftime("%m-%d-%Y")
    u = ("https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@i,dataFinalCotacao=@f)"
         f"?@i='{a}'&@f='{b}'&$format=json")
    for _ in range(3):
        try:
            v = requests.get(u, timeout=40).json()["value"][-1]
            return v["dataHoraCotacao"][:10], float(v["cotacaoVenda"])
        except Exception as ex: print("ptax retry", ex); time.sleep(3)
    return None, None

def sec_append(d, cik):
    """Append the latest 10-K fiscal year (missing in Yahoo's annual statements) from SEC XBRL companyfacts."""
    j = requests.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json", headers=UA, timeout=60).json()["facts"]["us-gaap"]
    def fy(tags):
        for t in tags:
            out = {}
            for e in j.get(t, {}).get("units", {}).get("USD", []):
                if e.get("form") == "10-K" and e.get("fp") == "FY" and len(e.get("frame", "")) == 6: out[e["end"]] = e["val"]
            if out: return out
        return {}
    rev = fy(["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"]); end = max(rev)
    if end[:7] <= d["income"]["years"][-1][:7]: return
    m = {("income", "Total Revenue"): rev, ("income", "Operating Income"): fy(["OperatingIncomeLoss"]),
         ("income", "Net Income"): fy(["NetIncomeLoss"]), ("income", "Reconciled Depreciation"): fy(["DepreciationDepletionAndAmortization", "Depreciation"]),
         ("cashflow", "Capital Expenditure"): {k: -v for k, v in fy(["PaymentsToAcquirePropertyPlantAndEquipment"]).items()},
         ("cashflow", "Operating Cash Flow"): fy(["NetCashProvidedByUsedInOperatingActivities"])}
    for sec in ("income", "cashflow"):
        st = d[sec]; st["years"].append(end)
        for r in [r for r in st if r != "years"]: st[r].append(m.get((sec, r), {}).get(end))
    cf = d["cashflow"]
    if cf.get("Free Cash Flow") is not None and cf.get("Operating Cash Flow") and cf.get("Capital Expenditure"):
        cf["Free Cash Flow"][-1] = (cf["Operating Cash Flow"][-1] or 0) + (cf["Capital Expenditure"][-1] or 0)
    d["secAppended"] = {"fyEnd": end, "source": "SEC EDGAR XBRL companyfacts (10-K)"}

def bcra(date_from, date_to):
    """BCRA Com. A3500 wholesale USD rate: (date, ARS per USD) for the last quote in the window."""
    for attempt in range(5):
        try:
            r = requests.get(f"https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechadesde={date_from}&fechahasta={date_to}",
                             timeout=30, verify=False).json()["results"]
            x = sorted(r, key=lambda z: z["fecha"])[-1]
            return x["fecha"], f(x["detalle"][0]["tipoCotizacion"])
        except Exception as ex:
            print("bcra retry", attempt, ex); time.sleep(3)
    return None, None

def fx_at(day):
    d = dt.date.fromisoformat(day[:10])
    return bcra((d - dt.timedelta(days=10)).isoformat(), d.isoformat())

def usd_stmt_fix(d, k):
    """YPF: Yahoo 'info' totals are ARS but statements are USD; rebuild balance/TTM items from the USD statements."""
    qb, qi = k.quarterly_balance_sheet, k.quarterly_income_stmt
    col = qb.columns[0]
    g = lambda df, r, c: f(df.loc[r, c]) if r in df.index else None
    d["yahooFinancialCurrency"] = d["financialCurrency"]; d["financialCurrency"] = "USD"
    d["totalDebt"] = g(qb, "Total Debt", col)
    d["totalCash"] = g(qb, "Cash Cash Equivalents And Short Term Investments", col) or g(qb, "Cash And Cash Equivalents", col)
    d["balanceDate"] = col.strftime("%Y-%m-%d")
    q4 = sorted(qi.columns)[-4:]
    d["revenueTTM"] = sum(g(qi, "Total Revenue", c) or 0 for c in q4)
    d["ebitdaTTM"] = sum(g(qi, "EBITDA", c) or 0 for c in q4)
    d["ttmQuarters"] = [c.strftime("%Y-%m-%d") for c in q4]
    d["minorityQ"] = g(qb, "Minority Interest", col)
    eq = g(qb, "Stockholders Equity", col)
    if eq and d.get("self"):
        mc = d["self"].get("marketCap"); d["self"]["book"] = eq; d["self"]["pb"] = mc / eq if mc else None
        d["self"]["netIncome"] = sum(g(qi, "Net Income", c) or 0 for c in q4)
        if mc and d["self"]["netIncome"] > 0: d["self"]["pe"] = mc / d["self"]["netIncome"]
    d["note"] = "Statements in USD (functional currency). Yahoo revenue/EPS estimates for YPF are in ARS/USD mixed and are not used for growth."

def bank_block(d, k, ratio):
    """GGAL: book value and history in USD per ADR (IAS 29 homogeneous ARS converted at the BCRA rate on each statement date)."""
    qb, inc, bs = k.quarterly_balance_sheet, k.income_stmt, k.balance_sheet
    col = qb.columns[0]; eq = f(qb.loc["Stockholders Equity", col]); sh = f(qb.loc["Ordinary Shares Number", col])
    fdate, fxb = fx_at(col.strftime("%Y-%m-%d"))
    adr = sh / ratio
    hist = []
    for c in sorted(bs.columns):
        if c not in inc.columns: continue
        e = f(bs.loc["Stockholders Equity", c]) if "Stockholders Equity" in bs.index else None
        ni = f(inc.loc["Net Income Common Stockholders", c]) if "Net Income Common Stockholders" in inc.index else None
        if e is None: continue
        fd, fr = fx_at(c.strftime("%Y-%m-%d"))
        hist.append({"fy": c.strftime("%Y-%m-%d"), "equityARS": e, "netIncomeARS": ni, "fx": fr, "fxDate": fd,
                     "equityUSD": e / fr if fr else None, "netIncomeUSD": ni / fr if (fr and ni is not None) else None})
    qi = k.quarterly_income_stmt; q4 = sorted(qi.columns)[-4:]
    ni_ttm = sum(f(qi.loc["Net Income", c]) or 0 for c in q4)
    divs = k.dividends; cut = divs.index.max() - pd.Timedelta(days=365) if len(divs) else None
    ee = d.get("earningsEstimate") or {}
    d["bank"] = {"adrRatio": ratio, "localShares": sh, "adrShares": adr, "equityARS": eq, "bvDate": col.strftime("%Y-%m-%d"),
                 "fxBv": fxb, "fxBvDate": fdate, "bvPerADR": eq / adr / fxb if fxb else None,
                 "niTTM_ARS": ni_ttm, "ttmQuarters": [c.strftime("%Y-%m-%d") for c in q4],
                 "niTTMperADR": ni_ttm / adr / fxb if fxb else None,
                 "eps0y": (ee.get("0y") or {}).get("avg"), "eps1y": (ee.get("+1y") or {}).get("avg"),
                 "divTTMperADR": f(divs[divs.index > cut].sum()) if cut is not None else None, "hist": hist,
                 "fxSource": "BCRA Com. A3500 (api.bcra.gob.ar estadisticascambiarias)"}

def filing_override(d, o):
    """Use the latest filed quarter (balance sheet, TTM, share count) while Yahoo's statements still stop at an older quarter."""
    yq = max(d.get("qIncome", {}).get("years") or ["0000"])
    if yq >= o["period"]: return
    p = d["price"]; mc = o["shares"] * p
    d.update({"yahooMarketCap": d.get("marketCap"), "marketCap": mc, "sharesOutstanding": o["shares"], "totalCash": o["totalCash"],
              "totalDebt": o["totalDebt"], "revenueTTM": o["revenueTTM"], "ebitdaTTM": o["ebitdaTTM"], "balanceDate": o["period"],
              "filingOverride": {k: v for k, v in o.items()} | {"yahooLastQuarter": yq}})
    s = d.get("self") or {}; ev = mc + o["totalDebt"] - o["totalCash"]
    s.update({"marketCap": mc, "ev": ev, "revenue": o["revenueTTM"], "ebitda": o["ebitdaTTM"], "netIncome": o["netIncomeTTM"],
              "evSales": ev / o["revenueTTM"], "evEbitda": ev / o["ebitdaTTM"] if o["ebitdaTTM"] > 0 else None,
              "pe": mc / o["netIncomeTTM"] if o["netIncomeTTM"] > 0 else None, "ebitdaMargin": o["ebitdaTTM"] / o["revenueTTM"],
              "book": o["equity"], "pb": mc / o["equity"]})
    d["self"] = s

def main():
    import sys, warnings; warnings.filterwarnings("ignore")
    only = [a.upper() for a in sys.argv[1:]]
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    m = requests.get("https://www.sec.gov/files/company_tickers.json", headers=UA, timeout=30).json()
    cik = {v["ticker"]: str(v["cik_str"]).zfill(10) for v in m.values()}
    cny = f(yf.Ticker("CNY=X").history(period="5d")["Close"].iloc[-1])  # CNY per USD
    path = os.path.join(OUT, "valuation.json")
    res = json.load(open(path)) if only and os.path.exists(path) else {"companies": {}}
    res["generatedAt"] = now
    if not only or "NIO" in only: res.setdefault("fx", {})["CNYUSD"] = cny
    if not only or "ASML" in only:
        ed, ev = ecb_eurusd()
        res.setdefault("fx", {}).update({"EURUSD": 1 / ev, "EURUSD_ecb": ev, "EUR_date": ed, "EUR_source": "ECB euro reference rate (data-api.ecb.europa.eu EXR D.USD.EUR.SP00.A)"})
        FXC["EUR"] = 1 / ev
    if not only or "ABEV" in only:
        bd, bv = ptax()
        if bv: res.setdefault("fx", {}).update({"BRLUSD": bv, "BRL_date": bd, "BRL_source": "Banco Central do Brasil PTAX selling rate (olinda.bcb.gov.br)"}); FXC["BRL"] = bv
    if not only or "TSM" in only:   # TWD only refreshed with TSM
        td, tv = cbc_twd()
        if tv: res.setdefault("fx", {}).update({"TWDUSD": tv, "TWD_date": td, "TWD_source": "Central Bank of the R.O.C. (Taiwan), NT$/US$ interbank closing rate (cbc.gov.tw)"}); FXC["TWD"] = tv
    elif res.get("fx", {}).get("TWDUSD"): FXC["TWD"] = res["fx"]["TWDUSD"]
    if not only or "005930.KS" in only:   # KRW only refreshed with Samsung
        kd_, kv = ecb_cross("KRW")
        if kv: res.setdefault("fx", {}).update({"KRWUSD": kv, "KRW_date": kd_, "KRW_source": "ECB euro reference rates, KRW/EUR divided by USD/EUR (data-api.ecb.europa.eu EXR)"}); FXC["KRW"] = kv
    elif res.get("fx", {}).get("KRWUSD"): FXC["KRW"] = res["fx"]["KRWUSD"]
    if not only or {"YPF", "GGAL"} & set(only):   # ARS rate only refreshed with the Argentine names
        fd, ars = bcra((dt.date.today() - dt.timedelta(days=10)).isoformat(), dt.date.today().isoformat())
        if ars: res["fx"].update({"ARSUSD_BCRA": ars, "ARS_date": fd}); FXC["ARS"] = ars
    FXC["CNY"] = cny
    for t, peers in TARGETS.items():
        if only and t not in only: continue
        k = yf.Ticker(t); i = k.info or {}
        h = k.history(period="1y")
        d = {"ticker": t, "name": i.get("shortName"), "price": f(h["Close"].iloc[-1]), "priceDate": h.index[-1].strftime("%Y-%m-%d"),
             "currency": i.get("currency"), "financialCurrency": i.get("financialCurrency"),
             "sharesOutstanding": i.get("sharesOutstanding"), "impliedShares": i.get("impliedSharesOutstanding"),
             "marketCap": i.get("marketCap"), "enterpriseValue": i.get("enterpriseValue"), "beta": i.get("beta"),
             "totalCash": i.get("totalCash"), "totalDebt": i.get("totalDebt"), "ebitdaTTM": i.get("ebitda"),
             "revenueTTM": i.get("totalRevenue"), "fcfTTM": i.get("freeCashflow"), "ocfTTM": i.get("operatingCashflow"),
             "low52": i.get("fiftyTwoWeekLow"), "high52": i.get("fiftyTwoWeekHigh"),
             "targetLow": i.get("targetLowPrice"), "targetMean": i.get("targetMeanPrice"), "targetMedian": i.get("targetMedianPrice"),
             "targetHigh": i.get("targetHighPrice"), "nAnalysts": i.get("numberOfAnalystOpinions"), "recKey": i.get("recommendationKey"),
             "trailingPE": i.get("trailingPE"), "forwardPE": i.get("forwardPE"), "evEbitda": i.get("enterpriseToEbitda"),
             "evSales": i.get("enterpriseToRevenue"), "grossMargin": i.get("grossMargins"), "opMargin": i.get("operatingMargins"),
             "roe": i.get("returnOnEquity"), "debtToEquity": i.get("debtToEquity"), "currentRatio": i.get("currentRatio"),
             "revenueGrowth": i.get("revenueGrowth"), "earningsGrowth": i.get("earningsGrowth"),
             "income": stmt(k.income_stmt, ROWS["income"]), "cashflow": stmt(k.cashflow, ROWS["cashflow"]),
             "balance": stmt(k.balance_sheet, ROWS["balance"]),
             "qIncome": stmt(k.quarterly_income_stmt, ["Total Revenue", "Operating Income", "Net Income"]),
             "revenueEstimate": est(k.revenue_estimate), "earningsEstimate": est(k.earnings_estimate),
             "growthEstimates": est(k.growth_estimates) if hasattr(k, "growth_estimates") else {},
             "sec": sec_facts(cik, t), "peers": [], "self": multiples(t)}
        for p in peers:
            try: d["peers"].append(multiples(p))
            except Exception as ex: print("peer fail", p, ex)
            time.sleep(0.2)
        if t in USD_STMT: usd_stmt_fix(d, k)
        if t in BANKS: bank_block(d, k, BANKS[t])
        if t in SEC_APPEND: sec_append(d, cik[t])
        if t in LOCAL_LISTING: local_listing(d, LOCAL_LISTING[t], k)
        if t in FILING_OVERRIDE: filing_override(d, FILING_OVERRIDE[t])
        d["fetchedAt"] = now
        res["companies"][t] = d
        print(t, d["price"], d["financialCurrency"])
    def clean(x):
        if isinstance(x, dict): return {str(k): clean(v) for k, v in x.items()}
        if isinstance(x, list): return [clean(v) for v in x]
        if isinstance(x, (np.floating, float)): return f(x)
        if isinstance(x, np.integer): return int(x)
        return x
    json.dump(clean(res), open(path, "w"), separators=(",", ":"))
    print("done", now)

if __name__ == "__main__":
    main()

"""Fetch real financials for the Valuation & M&A tab -> data/valuation.json
Sources: Yahoo Finance (yfinance) statements/estimates/info, SEC EDGAR XBRL companyfacts.
Usage: python scripts/fetch_valuation.py [TICKER ...]   (run after fetch_data.py so macro.json exists)
       With tickers, only those are re-fetched and merged into the existing valuation.json.
Argentine names: YPF keeps its books in USD (functional currency) although Yahoo labels it ARS, so
its balance sheet / TTM figures are taken from the USD statements. GGAL is valued as a bank (residual income):
book value per ADR = IAS 29-restated equity (ARS) / ADR-equivalent shares / BCRA A3500 rate on the balance-sheet date.
"""
import json, os, time, datetime as dt, math
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
           "UBER": ["LYFT", "DASH", "GRAB", "CART", "ABNB", "BKNG"]}
SEC_APPEND = {"MU"}          # Yahoo annual statements lag the latest 10-K (MU FY2026 ended 2026-09-03): append that year from SEC XBRL
USD_STMT = {"YPF"}           # statements reported in USD even though Yahoo's financialCurrency says ARS
BANKS = {"GGAL": 10}          # ticker -> local shares per ADR (GGAL: 1 ADS = 10 Class B shares)
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

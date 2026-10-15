"""Fetch real financials for the Valuation & M&A tab -> data/valuation.json
Sources: Yahoo Finance (yfinance) statements/estimates/info, SEC EDGAR XBRL companyfacts.
Usage: python scripts/fetch_valuation.py   (run after fetch_data.py so macro.json exists)
"""
import json, os, time, datetime as dt, math
import numpy as np, pandas as pd, requests, yfinance as yf

OUT = os.path.join(os.path.dirname(__file__), "..", "data")
UA = {"User-Agent": "Nicolas Ortiz market-intelligence-dashboard niconoa123@gmail.com"}
TARGETS = {"META": ["GOOGL", "SNAP", "PINS", "AMZN", "MSFT"],
           "UNH": ["CVS", "ELV", "CI", "HUM", "CNC"],
           "DIS": ["NFLX", "CMCSA", "WBD", "SONY", "PSKY"],
           "NIO": ["TSLA", "LI", "XPEV", "RIVN", "BYDDY"]}
ROWS = {"income": ["Total Revenue", "Gross Profit", "Operating Income", "EBIT", "EBITDA", "Normalized EBITDA",
                   "Reconciled Depreciation", "Net Income", "Diluted EPS", "Diluted Average Shares", "Tax Rate For Calcs",
                   "Research And Development", "Interest Expense"],
        "cashflow": ["Operating Cash Flow", "Capital Expenditure", "Free Cash Flow", "Stock Based Compensation",
                     "Repurchase Of Capital Stock", "Cash Dividends Paid", "Change In Working Capital", "Issuance Of Capital Stock"],
        "balance": ["Total Debt", "Net Debt", "Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments",
                    "Minority Interest", "Stockholders Equity", "Total Assets", "Ordinary Shares Number", "Capital Lease Obligations"]}
SEC_TAGS = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "OperatingIncomeLoss", "NetIncomeLoss",
            "PaymentsToAcquirePropertyPlantAndEquipment", "NetCashProvidedByUsedInOperatingActivities"]

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
    mc = i.get("marketCap"); debt = (i.get("totalDebt") or 0) / k; cash = (i.get("totalCash") or 0) / k
    rev = (i.get("totalRevenue") or 0) / k or None; ebitda = (i.get("ebitda") or 0) / k or None
    ni = (i.get("netIncomeToCommon") or 0) / k or None
    ev = mc + debt - cash if mc else None
    fpe = i.get("forwardPE") if fin == (i.get("currency") or "USD") else None
    return {"ticker": t, "name": i.get("shortName"), "marketCap": mc, "ev": ev, "revenue": rev, "ebitda": ebitda, "netIncome": ni,
            "evSales": ev / rev if ev and rev else None, "evEbitda": ev / ebitda if ev and ebitda and ebitda > 0 else None,
            "pe": mc / ni if mc and ni and ni > 0 else None, "forwardPE": fpe if fpe and fpe > 0 else None,
            "revenueGrowth": i.get("revenueGrowth"), "ebitdaMargin": ebitda / rev if ebitda and rev else None,
            "opMargin": i.get("operatingMargins"), "beta": i.get("beta"), "financialCurrency": fin}

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

def main():
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    m = requests.get("https://www.sec.gov/files/company_tickers.json", headers=UA, timeout=30).json()
    cik = {v["ticker"]: str(v["cik_str"]).zfill(10) for v in m.values()}
    cny = f(yf.Ticker("CNY=X").history(period="5d")["Close"].iloc[-1])  # CNY per USD
    res = {"generatedAt": now, "fx": {"CNYUSD": cny}, "companies": {}}
    FXC["CNY"] = cny
    for t, peers in TARGETS.items():
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
        res["companies"][t] = d
        print(t, d["price"], d["financialCurrency"])
    def clean(x):
        if isinstance(x, dict): return {str(k): clean(v) for k, v in x.items()}
        if isinstance(x, list): return [clean(v) for v in x]
        if isinstance(x, (np.floating, float)): return f(x)
        if isinstance(x, np.integer): return int(x)
        return x
    json.dump(clean(res), open(os.path.join(OUT, "valuation.json"), "w"), separators=(",", ":"))
    print("done", now)

if __name__ == "__main__":
    main()

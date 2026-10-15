"""Fetch real market data snapshot -> data/*.json
Sources: Yahoo Finance (yfinance), SEC EDGAR, US Treasury, BCRA.
Usage: pip install -r requirements.txt && python scripts/fetch_data.py
"""
import json, time, datetime as dt, math, os, xml.etree.ElementTree as ET
import numpy as np, pandas as pd, requests, yfinance as yf

OUT = os.path.join(os.path.dirname(__file__), "..", "data")
UA = {"User-Agent": "Nicolas Ortiz market-intelligence-dashboard niconoa123@gmail.com"}
UNIVERSE = {
 "AAPL":"Technology","MSFT":"Technology","NVDA":"Technology","GOOGL":"Communication","META":"Communication",
 "AMZN":"Consumer Disc.","TSLA":"Consumer Disc.","HD":"Consumer Disc.","JPM":"Financials","BAC":"Financials",
 "GS":"Financials","V":"Financials","JNJ":"Health Care","UNH":"Health Care","PFE":"Health Care","LLY":"Health Care",
 "XOM":"Energy","CVX":"Energy","PG":"Consumer Staples","KO":"Consumer Staples","WMT":"Consumer Staples",
 "CAT":"Industrials","BA":"Industrials","NEE":"Utilities","AMT":"Real Estate","LIN":"Materials",
 "YPF":"Argentina ADR","GGAL":"Argentina ADR","MELI":"Argentina ADR","PAM":"Argentina ADR"}
BENCH = "SPY"

def clean(x):
    if isinstance(x, dict): return {k: clean(v) for k, v in x.items()}
    if isinstance(x, list): return [clean(v) for v in x]
    if isinstance(x, (np.floating, float)): return None if (x is None or math.isnan(x) or math.isinf(x)) else round(float(x), 6)
    if isinstance(x, np.integer): return int(x)
    return x

def dump(name, obj):
    with open(os.path.join(OUT, name), "w") as f: json.dump(clean(obj), f, separators=(",", ":"))

def main():
    os.makedirs(OUT, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    tickers = list(UNIVERSE) + [BENCH]
    px = yf.download(tickers, period="2y", interval="1d", auto_adjust=False, group_by="ticker", progress=False, threads=True)
    close = pd.DataFrame({t: px[t]["Adj Close"] for t in tickers}).dropna(how="all")
    rets = close.pct_change().dropna(how="all")
    r1y = rets.iloc[-252:]
    prices, companies = {}, []
    for t in tickers:
        d = px[t].dropna()
        prices[t] = {"d": [i.strftime("%Y-%m-%d") for i in d.index], "o": d["Open"].round(4).tolist(),
                     "h": d["High"].round(4).tolist(), "l": d["Low"].round(4).tolist(),
                     "c": d["Close"].round(4).tolist(), "v": d["Volume"].astype("int64").tolist()}
    for t, sector in UNIVERSE.items():
        tk = yf.Ticker(t)
        try: info = tk.info or {}
        except Exception: info = {}
        s = close[t].dropna(); r = r1y[t].dropna()
        b = r1y[[t, BENCH]].dropna()
        beta = np.cov(b[t], b[BENCH])[0, 1] / np.var(b[BENCH], ddof=1)
        dd = (s / s.cummax() - 1)
        def ret(n): return float(s.iloc[-1] / s.iloc[-n - 1] - 1) if len(s) > n else None
        ytd = s[s.index.year == s.index[-1].year]
        try:
            divs = tk.dividends; divs = divs[divs.index > divs.index.max() - pd.Timedelta(days=730)] if len(divs) else divs
            div_list = [{"d": i.strftime("%Y-%m-%d"), "a": float(v)} for i, v in divs.items()]
        except Exception: div_list = []
        try:
            rec = tk.recommendations
            rec = rec.to_dict("records") if rec is not None and len(rec) else []
        except Exception: rec = []
        try:
            cal = tk.calendar or {}
            ed = cal.get("Earnings Date") if isinstance(cal, dict) else None
            earn = [str(x) for x in ed] if ed else []
        except Exception: earn = []
        companies.append({"ticker": t, "name": info.get("shortName") or t, "sector": sector,
            "industry": info.get("industry"), "price": float(s.iloc[-1]), "currency": info.get("currency", "USD"),
            "marketCap": info.get("marketCap"), "pe": info.get("trailingPE"), "fwdPe": info.get("forwardPE"),
            "grossMargin": info.get("grossMargins"), "opMargin": info.get("operatingMargins"),
            "netMargin": info.get("profitMargins"), "revGrowth": info.get("revenueGrowth"),
            "divYield": info.get("dividendYield"), "targetPrice": info.get("targetMeanPrice"),
            "recKey": info.get("recommendationKey"), "nAnalysts": info.get("numberOfAnalystOpinions"),
            "ret1d": ret(1), "ret1m": ret(21), "ret3m": ret(63), "ret1y": ret(252),
            "retYtd": float(ytd.iloc[-1] / ytd.iloc[0] - 1) if len(ytd) > 1 else None,
            "vol": float(r.std() * np.sqrt(252)), "annRet": float(r.mean() * 252), "beta": float(beta),
            "maxDD": float(dd.iloc[-252:].min()), "currDD": float(dd.iloc[-1]),
            "dividends": div_list, "recommendations": rec, "earningsDates": earn})
        time.sleep(0.3)
    names = list(UNIVERSE)
    corr = r1y[names].corr()
    cov = (r1y[names].cov() * 252)
    dump("market.json", {"generatedAt": now, "asOf": close.index[-1].strftime("%Y-%m-%d"), "benchmark": BENCH,
        "companies": companies, "corr": {"tickers": names, "m": corr.values.round(4).tolist()},
        "cov": cov.values.round(6).tolist(), "mu": (r1y[names].mean() * 252).round(6).tolist()})
    dump("prices.json", prices)

    # SEC EDGAR
    m = requests.get("https://www.sec.gov/files/company_tickers.json", headers=UA, timeout=30).json()
    cik = {v["ticker"]: str(v["cik_str"]).zfill(10) for v in m.values()}
    events = []
    for t in names:
        c = cik.get(t) or cik.get(t.replace(".", "-"))
        if not c: continue
        try:
            sub = requests.get(f"https://data.sec.gov/submissions/CIK{c}.json", headers=UA, timeout=30).json()
        except Exception: continue
        rf = sub["filings"]["recent"]
        for i in range(min(len(rf["form"]), 300)):
            f = rf["form"][i]
            if f not in ("8-K", "10-Q", "10-K", "4", "20-F", "6-K", "SC 13G", "SC 13D", "DEF 14A"): continue
            if rf["filingDate"][i] < (dt.date.today() - dt.timedelta(days=180)).isoformat(): break
            acc = rf["accessionNumber"][i].replace("-", "")
            url = f"https://www.sec.gov/Archives/edgar/data/{int(c)}/{acc}/{rf['primaryDocument'][i]}"
            events.append({"ticker": t, "form": f, "date": rf["filingDate"][i], "desc": rf["primaryDocDescription"][i] or f,
                           "items": rf.get("items", [""] * 9999)[i], "url": url, "acc": acc, "doc": rf["primaryDocument"][i], "cik": int(c)})
        time.sleep(0.15)
    # Insider details: parse latest Form 4 XMLs (cap per company)
    insiders = []
    for t in names:
        f4 = [e for e in events if e["ticker"] == t and e["form"] == "4"][:6]
        for e in f4:
            doc = e["doc"].split("/")[-1]
            url = f"https://www.sec.gov/Archives/edgar/data/{e['cik']}/{e['acc']}/{doc}"
            try:
                x = ET.fromstring(requests.get(url, headers=UA, timeout=30).content)
                owner = x.findtext(".//reportingOwner/reportingOwnerId/rptOwnerName")
                title = x.findtext(".//reportingOwnerRelationship/officerTitle") or ("Director" if x.findtext(".//reportingOwnerRelationship/isDirector") in ("1", "true") else "")
                for tr in x.findall(".//nonDerivativeTransaction"):
                    sh = tr.findtext(".//transactionShares/value"); p = tr.findtext(".//transactionPricePerShare/value")
                    insiders.append({"ticker": t, "date": tr.findtext(".//transactionDate/value"), "owner": owner, "title": title,
                        "code": tr.findtext(".//transactionCoding/transactionCode"),
                        "ad": tr.findtext(".//transactionAcquiredDisposedCode/value"),
                        "shares": float(sh) if sh else None, "price": float(p) if p else None, "url": e["url"]})
            except Exception: pass
            time.sleep(0.12)
    dump("activity.json", {"generatedAt": now, "filings": sorted(events, key=lambda e: e["date"], reverse=True), "insiders": insiders})

    # Macro: Treasury par yield curve (current + previous year month)
    macro = {"generatedAt": now, "treasury": [], "fx": {}}
    for y in (dt.date.today().year,):
        u = f"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{y}/all?type=daily_treasury_yield_curve&field_tdr_date_value={y}&page&_format=csv"
        try:
            df = pd.read_csv(u, storage_options=UA)
            macro["treasury"] = df.head(260).to_dict("records")
        except Exception as ex: print("treasury fail", ex)
    try:
        h = yf.Ticker("ARS=X").history(period="5d")
        macro["fx"]["ARS_market_yahoo"] = float(h["Close"].iloc[-1])
    except Exception: pass
    try:
        r = requests.get("https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones", timeout=30, verify=False).json()
        for d in r["results"]["detalle"]:
            if d["codigoMoneda"] == "USD":
                macro["fx"]["ARS_BCRA"] = d["tipoCotizacion"]; macro["fx"]["BCRA_date"] = r["results"]["fecha"]
    except Exception as ex: print("bcra fail", ex)
    dump("macro.json", macro)
    print("done", now, len(companies), len(events), len(insiders))

if __name__ == "__main__":
    main()

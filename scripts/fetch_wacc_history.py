"""Historical WACC (cost of equity for banks) at each year-end FY2021..FY2025 plus today -> data/wacc_history.json
Method (same for every ticker; new tickers are picked up automatically from data/valuation_assumptions.json):
  * Dates: market inputs at the calendar year-end (last trading day <= Dec 31), matching Damodaran's annual ERP;
    balance-sheet items from the fiscal year ending in that calendar year (DIS: late Sep, MU: late Aug/early Sep).
  * Risk-free: US 10-year Treasury yield (Yahoo ^TNX close) on that date.
  * Beta: 60 monthly total-return-free price returns of the ADR/stock vs the S&P 500 (^GSPC) ending that date
    (OLS slope; at least 24 months, else flagged), Blume-adjusted: 0.67 x raw + 0.33.
  * ERP: Damodaran implied ERP (FCFE, "histimpl.xls") at the start of the following year; current = model ERP.
  * CRP: YPF/GGAL = J.P. Morgan EMBI spread for Argentina at year-end (api.argentinadatos.com, riesgo-pais);
    NIO = Damodaran rating-based country risk premium for China (ctryprem archives, Jan 1 of the following year).
  * Cost of debt: interest expense / average total debt for the fiscal year when both are available (clamped to
    [rf, rf + 10%]); otherwise rating-style rf + the model credit spread. After tax at the effective tax rate
    (clamped 0-35%, fallback = model tax rate).
  * Weights: market value of equity (shares x close at year-end) vs book total debt at fiscal year-end, in USD
    (NIO debt converted at year-end CNY/USD, ASML at year-end ECB EUR/USD). Everything is in USD terms.
  * Banks (GGAL): cost of equity only (Ke = rf + beta x ERP + CRP); WACC is not meaningful for a bank.
Usage: python scripts/fetch_wacc_history.py
"""
import re
import json, os, io, math, datetime as dt, warnings
import numpy as np, pandas as pd, requests, yfinance as yf
warnings.filterwarnings("ignore")
D = os.path.join(os.path.dirname(__file__), "..", "data")
UA = {"User-Agent": "Mozilla/5.0 (market-intelligence-dashboard; niconoa123@gmail.com)"}
ARG = ("YPF", "GGAL", "VIST")   # Argentine names: CRP = EMBI Argentina
YEARS = [2021, 2022, 2023, 2024, 2025]
# Damodaran archives (verified 2026-10-19). Implied ERP (FCFE) for the start of year Y+1, China rating-based CRP.
ERP = {2021: 0.0424, 2022: 0.0594, 2023: 0.0460, 2024: 0.0433, 2025: 0.0423}
CHINA_CRP = {2021: 0.00695887, 2022: 0.01217149, 2023: 0.01031353, 2024: 0.00941126, 2025: 0.00912949}
BRAZIL_CRP = {2021: 0.02970905, 2022: 0.05193169, 2023: 0.04400441, 2024: 0.03341000, 2025: 0.03240970}
TAIWAN_CRP = {2021: 0.00597750, 2022: 0.01034577, 2023: 0.00876650, 2024: 0.00799958, 2025: 0.00776007}   # Aa3; ctryprem21-24 archives and Jan-2026 file
KOREA_CRP = {2021: 0.00490700, 2022: 0.00852000, 2023: 0.00721900, 2024: 0.00658800, 2025: 0.00639100}   # Aa2; ctryprem21-24 archives and Jan-2026 file
COUNTRY_CRP = {"NIO": ("China", CHINA_CRP), "ABEV": ("Brazil", BRAZIL_CRP), "TSM": ("Taiwan", TAIWAN_CRP), "005930.KS": ("Korea", KOREA_CRP), "000660.KS": ("Korea", KOREA_CRP),
               "PBR": ("Brazil", BRAZIL_CRP), "PRIO3.SA": ("Brazil", BRAZIL_CRP)}
LOCAL_PX = {"005930.KS": "KRW=X", "000660.KS": "KRW=X", "PRIO3.SA": "BRL=X"}   # local-currency listings: prices converted to USD (Yahoo FX) for beta and market cap; today uses the model's ECB rate   # Damodaran rating-based CRP; add new EM countries here
# Recently listed names: years before the IPO (and today, while < 24 monthly returns exist) use an ESTIMATED proxy beta =
# segment-revenue-weighted median of the Blume-adjusted 60-month peer betas at that date, and the equity weight uses
# private-market marks (secondary/tender offers, widely reported; estimates) instead of a listed market cap.
PROXY = {"SPCX": {"ipo": "2026-06-12",
    "segments": {"Space": ["LMT", "NOC", "RKLB"], "Connectivity": ["IRDM", "VSAT", "TMUS", "ASTS"], "AI": ["ORCL", "META", "NVDA", "MSFT"]},
    # segment revenue weights from the 424B4 / Q3 2026 8-K (FY2021-22 not disclosed: FY2023 mix used); current = 9M-2026
    "weights": {2021: (3557, 3869, 2961), 2022: (3557, 3869, 2961), 2023: (3557, 3869, 2961), 2024: (3796, 7599, 2620),
                2025: (4086, 11387, 3201), "current": (3348, 12796, 10939)},
    "marks": {2021: (100e9, "Oct-2021 secondary sale, ~$100B"), 2022: (137e9, "Dec-2022 tender offer, ~$137B"),
              2023: (180e9, "Dec-2023 tender offer, ~$180B"), 2024: (350e9, "Dec-2024 tender offer, ~$350B"),
              2025: (800e9, "Dec-2025 tender offer, ~$800B")}}}
ERP_SRC = "Damodaran, Historical Implied Equity Risk Premiums (histimpl.xls, implied premium FCFE, start of the following year)"
CRP_SRC = "Damodaran, Country Default Spreads and Risk Premiums (ctryprem21-24.xlsx archives and the Jan-2026 ctryprem.xlsx; rating-based CRP: China A1, Brazil Ba2/Ba1, Taiwan Aa3, Korea Aa2)"

def f(x):
    try: x = float(x); return None if math.isnan(x) or math.isinf(x) else x
    except Exception: return None

def try_damodaran():
    """Refresh the ERP table from histimpl.xls when reachable (keeps the hard-coded values otherwise)."""
    try:
        r = requests.get("https://pages.stern.nyu.edu/~adamodar/pc/datasets/histimpl.xls", headers=UA, timeout=40)
        df = pd.read_excel(io.BytesIO(r.content), header=None)
        hdr = df.index[df[0].astype(str).str.strip() == "Year"][0]; cols = [str(c).strip() for c in df.loc[hdr]]
        j = next(i for i, c in enumerate(cols) if "FCFE" in c)
        for _, row in df.iloc[hdr + 1:].iterrows():
            try: y = int(row[0])
            except Exception: continue
            if y in ERP and f(row[j]): ERP[y] = round(float(row[j]), 4)
    except Exception as e: print("damodaran ERP: using stored values", e)

def embi():
    d = requests.get("https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais", timeout=40).json()
    def at(day): r = [x for x in d if x["fecha"] <= day][-1]; return r["valor"] / 1e4, r["fecha"]
    return at

def close_at(h, day):
    s = h[h.index.tz_localize(None) <= pd.Timestamp(day)]["Close"].dropna()
    return (f(s.iloc[-1]), s.index[-1].strftime("%Y-%m-%d")) if len(s) else (None, None)

def beta(px, spx, day):
    na = lambda h: h["Close"].set_axis(h.index.tz_localize(None))   # drop the tz so KRX (Asia/Seoul) and NYSE month-ends align
    a = na(px)[lambda x: x.index <= pd.Timestamp(day)].resample("ME").last()
    b = na(spx)[lambda x: x.index <= pd.Timestamp(day)].resample("ME").last()
    r = pd.concat([a.pct_change(), b.pct_change()], axis=1).dropna().iloc[-60:]
    if len(r) < 24: return None, None, len(r)
    raw = np.cov(r.iloc[:, 0], r.iloc[:, 1])[0, 1] / np.var(r.iloc[:, 1], ddof=1)
    return 0.67 * raw + 0.33, raw, len(r)

def ptax(day):
    """BCB PTAX selling rate (BRL per USD) on the last fixing <= day; Yahoo BRL=X as a fallback."""
    d = dt.date.fromisoformat(day)
    u = ("https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@i,dataFinalCotacao=@f)"
         f"?@i='{(d - dt.timedelta(days=10)).strftime('%m-%d-%Y')}'&@f='{d.strftime('%m-%d-%Y')}'&$format=json")
    try: return float(requests.get(u, timeout=40).json()["value"][-1]["cotacaoVenda"])
    except Exception:
        h = yf.Ticker("BRL=X").history(start=(d - dt.timedelta(days=10)).isoformat(), end=(d + dt.timedelta(days=1)).isoformat())
        return float(h["Close"].iloc[-1])

ECBC = {}
def ecb(day):
    """ECB reference rate (USD per EUR) on the last fixing <= day; retries, then Yahoo EURUSD=X as a fallback."""
    if day in ECBC: return ECBC[day]
    d = dt.date.fromisoformat(day)
    for _ in range(3):
        try: ECBC[day] = _ecb(d, day); return ECBC[day]
        except Exception as e: print("ecb retry", e)
    h = yf.Ticker("EURUSD=X").history(start=(d - dt.timedelta(days=10)).isoformat(), end=(d + dt.timedelta(days=1)).isoformat())
    ECBC[day] = float(h["Close"].iloc[-1]); return ECBC[day]
def _ecb(d, day):
    r = requests.get(f"https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod={(d - dt.timedelta(days=10)).isoformat()}&endPeriod={day}&format=csvdata", timeout=60)
    rows = r.text.strip().splitlines(); h = rows[0].split(","); v = rows[-1].split(",")
    return float(v[h.index("OBS_VALUE")])

def main():
    try_damodaran()
    A = json.load(open(os.path.join(D, "valuation_assumptions.json")))
    V = json.load(open(os.path.join(D, "valuation.json")))
    emb = embi(); today = dt.date.today().isoformat()
    tnx = yf.Ticker("^TNX").history(start="2015-12-01"); spx = yf.Ticker("^GSPC").history(start="2015-12-01")
    cny = yf.Ticker("CNY=X").history(start="2020-12-01"); twd = yf.Ticker("TWD=X").history(start="2020-12-01"); krw = yf.Ticker("KRW=X").history(start="2020-12-01")
    out = {"generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "years": YEARS,
           "method": {"rf": "US 10-year Treasury yield (Yahoo ^TNX) at the calendar year-end",
                      "beta": "60 monthly returns vs the S&P 500 (^GSPC) ending at year-end (min 24), Blume-adjusted 0.67 x raw + 0.33",
                      "erp": ERP_SRC, "crp": "Argentina: J.P. Morgan EMBI spread at year-end (api.argentinadatos.com riesgo-pais); China: " + CRP_SRC,
                      "kd": "Interest expense / average total debt (Yahoo statements) clamped to [rf, rf+10%]; else rf + model credit spread (+ EMBI for YPF); after tax at the effective rate (0-35%)",
                      "weights": "Market cap (shares x close at year-end) vs book total debt at fiscal year-end, USD",
                      "currency": "USD terms for all tickers (ASML/ABEV: USD ADR beta and US rf; EUR debt at the ECB, BRL debt at the BCB PTAX and TWD debt at the Yahoo TWD=X year-end rate; Samsung: KRX price converted to USD at Yahoo KRW=X daily, KRW debt at year-end KRW=X)"},
           "erp": ERP, "companies": {}}
    PXC = {}
    for tk, a in A["companies"].items():
        c = V["companies"].get(tk)
        if not c: continue
        bank = a.get("model") == "bank"; k = yf.Ticker(tk)
        px = k.history(start="2015-12-01", auto_adjust=False)
        if tk in LOCAL_PX:   # convert the local close to USD at the daily Yahoo FX rate (beta and market cap in USD terms)
            fxh = yf.Ticker(LOCAL_PX[tk]).history(start="2015-12-01")["Close"]; fxh.index = fxh.index.tz_localize(None).normalize()
            idx = px.index.tz_localize(None).normalize(); px = px.copy(); px["Close"] = px["Close"].values / fxh.reindex(idx, method="ffill").values
        try: sh = k.get_shares_full(start="2020-06-01")
        except Exception: sh = None
        B, I = c["balance"], c["income"]; by = B.get("years", [])
        debt = {y[:4]: v for y, v in zip(by, B.get("Total Debt", [])) if v is not None}
        iy = I.get("years", []); intr = {y[:4]: v for y, v in zip(iy, I.get("Interest Expense", [])) if v}
        taxr = {y[:4]: v for y, v in zip(iy, I.get("Tax Rate For Calcs", [])) if v is not None}
        cur = c.get("financialCurrency") or "USD"
        rows = []
        for Y in YEARS + ["current"]:
            day = f"{Y}-12-31" if Y != "current" else today
            rf, rfd = close_at(tnx, day); rf = rf / 100 if rf else None
            bA, bRaw, n = beta(px, spx, day)
            erp = ERP.get(Y, A["erp"]) if Y != "current" else A["erp"]
            if tk in ARG and Y == "current" and a.get("crp"):
                # 'today' uses the model CRP (valuation_assumptions.json, changed only by fetch_embi.py --apply), not the live EMBI,
                # so a rerun matches the Valuation tab and does not move YPF/GGAL when another ticker is added
                crp = a["crp"]; m = re.search(r"(\d{4}-\d{2}-\d{2})", A.get("crpNote", "")); crpd = m.group(1) if m else "model"
                crpSrc = f"EMBI Argentina {round(crp * 1e4)} bp ({crpd})"
            elif tk in ARG: crp, crpd = emb(day); crpSrc = f"EMBI Argentina {round(crp * 1e4)} bp ({crpd})"
            elif tk in COUNTRY_CRP:
                cn, tbl = COUNTRY_CRP[tk]
                crp = tbl.get(Y, a.get("crp", 0)) if Y != "current" else a.get("crp", 0); crpSrc = f"Damodaran {cn} CRP" if Y != "current" else "model CRP"
            else: crp, crpSrc = 0.0, "none"
            px_note = None
            if tk in PROXY and bA is None:
                P = PROXY[tk]; wts = P["weights"][Y]; segb = []
                for (seg, peers), wgt in zip(P["segments"].items(), wts):
                    bs = [beta(PXC.setdefault(q, yf.Ticker(q).history(start="2015-12-01")), spx, day)[0] for q in peers]
                    bs = [x for x in bs if x is not None]; segb.append((seg, float(np.median(bs)), wgt))
                bA = sum(b_ * w_ for _, b_, w_ in segb) / sum(w_ for *_, w_ in segb); bRaw = (bA - 0.33) / 0.67
                px_note = "ESTIMATED proxy beta " + ", ".join(f"{sg} {b_:.2f} x {w_ / sum(x[2] for x in segb):.0%}" for sg, b_, w_ in segb) + \
                          (f" (pre-IPO; listed {P['ipo']})" if day < P["ipo"] else f" (only {n} monthly returns since the {P['ipo']} IPO)")
            betaUsed = bA if bA is not None else (a.get("betaOverride") or c.get("beta") or 1)
            ke = rf + betaUsed * erp + crp
            row = {"year": Y, "date": rfd, "rf": rf, "beta": bA, "betaRaw": bRaw, "months": n, "erp": erp, "crp": crp, "crpSrc": crpSrc, "ke": ke}
            if px_note: row.update({"flag": px_note, "estimated": True, "months": None})
            elif bA is None: row["flag"] = f"beta: only {n} months of data; fallback {betaUsed:.2f}"
            elif n < 60: row["flag"] = f"beta on {n} months (listing history shorter than 5 years)"
            if not bank:
                ys = str(Y) if Y != "current" else (by[-1][:4] if by else None)
                p, _ = close_at(px, day)
                s = None
                if sh is not None and len(sh):
                    ss = sh[sh.index.tz_localize(None) <= pd.Timestamp(day)]; s = f(ss.iloc[-1]) if len(ss) else None
                if Y == "current": s = c["marketCap"] / c["price"]; p = c["price"]   # already USD for local listings (fetch_valuation converts)
                if not s: s = c["marketCap"] / c["price"]; row["flag"] = (row.get("flag", "") + "; current share count used").strip("; ")
                E = p * s if p else None
                if tk in PROXY and day < PROXY[tk]["ipo"]:
                    E, mk = PROXY[tk]["marks"][Y]; row["flag"] = row.get("flag", "").replace("; current share count used", "") + f"; equity weight from private mark: {mk} (SpaceX standalone, estimate)"
                fx = 1.0
                if cur == "CNY": fx = close_at(cny, day)[0] if Y != "current" else V["fx"]["CNYUSD"]
                if cur == "EUR": fx = 1 / ecb(day if Y != "current" else V["fx"]["EUR_date"])
                if cur == "BRL": fx = ptax(day) if Y != "current" else V["fx"]["BRLUSD"]
                if cur == "KRW": fx = close_at(krw, day)[0] if Y != "current" else V["fx"]["KRWUSD"]
                if cur == "TWD": fx = close_at(twd, day)[0] if Y != "current" else V["fx"]["TWDUSD"]   # year-ends: Yahoo TWD=X; today: CBC closing rate
                dl = debt.get(ys) if ys else None
                if dl is None and ys:
                    later = sorted(x for x in debt if x > ys)
                    if later: dl = debt[later[0]]; row["flag"] = (row.get("flag", "") + f"; debt carried back from FY{later[0]} (FY{ys} not in Yahoo statements)").strip("; ")
                Dd = (dl or 0) / fx
                prev = debt.get(str(int(ys) - 1)) if ys else None
                ie = intr.get(ys) if ys else None
                kd_pre = None
                if ie and dl and prev: kd_pre = min(max(ie / ((dl + prev) / 2), rf), rf + 0.10); kdSrc = "interest / avg debt"
                elif ie and dl: kd_pre = min(max(ie / dl, rf), rf + 0.10); kdSrc = "interest / year-end debt"
                elif crp and tk in ("YPF", "VIST"): kd_pre = min(rf + a.get("kdSpread", 0.01) + crp, rf + 0.10); kdSrc = "rf + model spread + EMBI (capped rf+10%)"
                else: kd_pre = rf + a.get("kdSpread", 0.01); kdSrc = "rf + model spread"
                t = taxr.get(ys); t = min(max(t, 0), 0.35) if t is not None else a.get("tax", 0.21)
                kd = kd_pre * (1 - t); w = E / (E + Dd) if E else 1
                row.update({"marketCap": E, "debt": Dd, "kdPre": kd_pre, "kdSrc": kdSrc, "tax": t, "kd": kd, "wE": w, "wacc": w * ke + (1 - w) * kd})
            rows.append(row)
        out["companies"][tk] = {"bank": bank, "rows": rows, "currency": cur}
        print(tk, " ".join(f"{r['year']}:{(r.get('wacc') or r['ke']) * 100:.2f}%" for r in rows))
    def clean(x):
        if isinstance(x, dict): return {str(kk): clean(v) for kk, v in x.items()}
        if isinstance(x, list): return [clean(v) for v in x]
        if isinstance(x, (float, np.floating)): return f(x)
        if isinstance(x, np.integer): return int(x)
        return x
    json.dump(clean(out), open(os.path.join(D, "wacc_history.json"), "w"), indent=1)

if __name__ == "__main__":
    main()

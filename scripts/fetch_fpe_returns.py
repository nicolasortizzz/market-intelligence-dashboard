#!/usr/bin/env python3
"""Forward P/E vs subsequent ETF returns for EWZ, EWY and MCHI (China).

Real public sources only — no interpolated Forward P/E points.

Sources
-------
* Current Forward P/E marker: MSCI country-index factsheet P/E Fwd
  (EWZ → MSCI Brazil; EWY → MSCI Korea; MCHI → MSCI China). ETF-native forwardPE is not
  published historically on Yahoo for these funds.
* Annual historical Forward P/E: Damodaran Country Stats
  (average firm Forward PE through the 2020-01 update; median thereafter).
  Embedded snapshot extracted from the public XLS archives; refresh the
  DAMODARAN_ANNUAL block when Damodaran publishes a new January file.
* Sparse recent index-level Forward P/E: Siblis Research free API
  (IBOV for Brazil, KOSPI for Korea, SSE for China mainland).
* Subsequent returns: Yahoo Finance adjusted closes of EWZ / EWY
  (1-year simple; 5-year annualized), month-end to month-end. MCHI preferred over FXI because it tracks MSCI China.

Not investment advice.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
import sys
import urllib.request

import numpy as np
import pandas as pd
import yfinance as yf

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "fpe_returns.json")

# Verified extraction from Damodaran countrystats archives (Date updated field).
# Gap: no January-2014 workbook in the public archive set we retrieved.
# Method changes from firm-average to firm-median starting with the 2021-01-05 file.
DAMODARAN_ANNUAL = {
    "Brazil": [
        {"date": "2012-01-05", "fpe": 19.32, "method": "Damodaran average firm Forward PE", "file": "countrystats12.xls"},
        {"date": "2013-01-05", "fpe": 17.79, "method": "Damodaran average firm Forward PE", "file": "countrystats13.xls"},
        {"date": "2015-01-05", "fpe": 17.92, "method": "Damodaran average firm Forward PE", "file": "countrystats14.xls"},
        {"date": "2016-01-05", "fpe": 17.11, "method": "Damodaran average firm Forward PE", "file": "countrystats15.xls"},
        {"date": "2017-01-05", "fpe": 24.86, "method": "Damodaran average firm Forward PE", "file": "countrystats16.xls"},
        {"date": "2018-01-05", "fpe": 25.16, "method": "Damodaran average firm Forward PE", "file": "countrystats17.xls"},
        {"date": "2019-01-05", "fpe": 22.64, "method": "Damodaran average firm Forward PE", "file": "countrystats18.xls"},
        {"date": "2020-01-05", "fpe": 53.66, "method": "Damodaran average firm Forward PE", "file": "countrystats19.xls"},
        {"date": "2021-01-05", "fpe": 20.82, "method": "Damodaran median firm Forward PE", "file": "countrystats20.xls"},
        {"date": "2022-01-05", "fpe": 13.01, "method": "Damodaran median firm Forward PE", "file": "countrystats21.xls"},
        {"date": "2023-01-05", "fpe": 11.04, "method": "Damodaran median firm Forward PE", "file": "countrystats22.xls"},
        {"date": "2024-01-05", "fpe": 12.55, "method": "Damodaran median firm Forward PE", "file": "countrystats23.xls"},
        {"date": "2025-01-05", "fpe": 7.92, "method": "Damodaran median firm Forward PE", "file": "countrystats24.xls"},
        {"date": "2026-01-05", "fpe": 9.17, "method": "Damodaran median firm Forward PE", "file": "countrystats.xls"},
    ],
    "South Korea": [
        {"date": "2012-01-05", "fpe": 12.74, "method": "Damodaran average firm Forward PE", "file": "countrystats12.xls"},
        {"date": "2013-01-05", "fpe": 18.40, "method": "Damodaran average firm Forward PE", "file": "countrystats13.xls"},
        {"date": "2015-01-05", "fpe": 21.19, "method": "Damodaran average firm Forward PE", "file": "countrystats14.xls"},
        {"date": "2016-01-05", "fpe": 19.59, "method": "Damodaran average firm Forward PE", "file": "countrystats15.xls"},
        {"date": "2017-01-05", "fpe": 16.66, "method": "Damodaran average firm Forward PE", "file": "countrystats16.xls"},
        {"date": "2018-01-05", "fpe": 18.04, "method": "Damodaran average firm Forward PE", "file": "countrystats17.xls"},
        {"date": "2019-01-05", "fpe": 16.72, "method": "Damodaran average firm Forward PE", "file": "countrystats18.xls"},
        {"date": "2020-01-05", "fpe": 18.64, "method": "Damodaran average firm Forward PE", "file": "countrystats19.xls"},
        {"date": "2021-01-05", "fpe": 21.20, "method": "Damodaran median firm Forward PE", "file": "countrystats20.xls"},
        {"date": "2022-01-05", "fpe": 12.89, "method": "Damodaran median firm Forward PE", "file": "countrystats21.xls"},
        {"date": "2023-01-05", "fpe": 9.70, "method": "Damodaran median firm Forward PE", "file": "countrystats22.xls"},
        {"date": "2024-01-05", "fpe": 11.50, "method": "Damodaran median firm Forward PE", "file": "countrystats23.xls"},
        {"date": "2025-01-05", "fpe": 9.50, "method": "Damodaran median firm Forward PE", "file": "countrystats24.xls"},
        {"date": "2026-01-05", "fpe": 12.27, "method": "Damodaran median firm Forward PE", "file": "countrystats.xls"},
    ],
    "China": [
        {"date": "2012-01-05", "fpe": 24.57, "method": "Damodaran average firm Forward PE", "file": "countrystats12.xls"},
        {"date": "2013-01-05", "fpe": 28.70, "method": "Damodaran average firm Forward PE", "file": "countrystats13.xls"},
        {"date": "2015-01-05", "fpe": 42.92, "method": "Damodaran average firm Forward PE", "file": "countrystats14.xls"},
        {"date": "2016-01-05", "fpe": 78.27, "method": "Damodaran average firm Forward PE", "file": "countrystats15.xls"},
        {"date": "2017-01-05", "fpe": 57.52, "method": "Damodaran average firm Forward PE", "file": "countrystats16.xls"},
        {"date": "2018-01-05", "fpe": 37.50, "method": "Damodaran average firm Forward PE", "file": "countrystats17.xls"},
        {"date": "2019-01-05", "fpe": 22.17, "method": "Damodaran average firm Forward PE", "file": "countrystats18.xls"},
        {"date": "2020-01-05", "fpe": 28.53, "method": "Damodaran average firm Forward PE", "file": "countrystats19.xls"},
        {"date": "2021-01-05", "fpe": 34.69, "method": "Damodaran median firm Forward PE", "file": "countrystats20.xls"},
        {"date": "2022-01-05", "fpe": 24.94, "method": "Damodaran median firm Forward PE", "file": "countrystats21.xls"},
        {"date": "2023-01-05", "fpe": 20.54, "method": "Damodaran median firm Forward PE", "file": "countrystats22.xls"},
        {"date": "2024-01-05", "fpe": 20.40, "method": "Damodaran median firm Forward PE", "file": "countrystats23.xls"},
        {"date": "2025-01-05", "fpe": 20.80, "method": "Damodaran median firm Forward PE", "file": "countrystats24.xls"},
        {"date": "2026-01-05", "fpe": 26.46, "method": "Damodaran median firm Forward PE", "file": "countrystats.xls"},
    ],
}
DAMODARAN_URL = "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/countrystats.html"

# MSCI factsheet fundamentals as of 2026-10-30 (downloaded 2026-11-05).
MSCI_CURRENT = {
    "EWZ": {
        "fpe": 7.58, "trailing_pe": 8.89, "pb": 1.71, "div_yld": 5.80,
        "date": "2026-10-30",
        "label": "MSCI Brazil Index P/E Fwd (proxy for EWZ)",
        "source": "MSCI Brazil Index (USD) factsheet fundamentals",
        "url": "https://www.msci.com/documents/10199/c35f1892-7d15-2c28-efe8-9122cf361772",
    },
    "EWY": {
        "fpe": 4.00, "trailing_pe": 8.52, "pb": 1.91, "div_yld": 0.98,
        "date": "2026-10-30",
        "label": "MSCI Korea Index P/E Fwd (proxy for EWY)",
        "source": "MSCI Korea Index (USD) factsheet fundamentals",
        "url": "https://www.msci.com/documents/10199/255599/msci-korea-index.pdf",
    },
    "MCHI": {
        "fpe": 9.32, "trailing_pe": 11.96, "pb": 1.29, "div_yld": 2.63,
        "date": "2026-10-30",
        "label": "MSCI China Index P/E Fwd (proxy for MCHI)",
        "source": "MSCI China Index (USD) factsheet fundamentals",
        "url": "https://www.msci.com/documents/10199/255599/msci-china-index.pdf",
    },
}

META = {
    "EWZ": {
        "etf": "EWZ", "name": "iShares MSCI Brazil ETF",
        "proxy": "MSCI Brazil / Ibovespa Forward P/E (ETF-native FPE history not published)",
        "dam_key": "Brazil", "sib_key": "IBOV",
    },
    "EWY": {
        "etf": "EWY", "name": "iShares MSCI South Korea ETF",
        "proxy": "MSCI Korea / KOSPI Forward P/E (ETF-native FPE history not published)",
        "dam_key": "South Korea", "sib_key": "KOSPI",
    },
    "MCHI": {
        "etf": "MCHI", "name": "iShares MSCI China ETF",
        "proxy": "MSCI China / SSE Composite Forward P/E (chosen over FXI: MCHI tracks MSCI China directly; ETF-native FPE history not published)",
        "dam_key": "China", "sib_key": "SSE",
    },
}


def get_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "market-intelligence-dashboard/fpe"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def month_end_prices(ticker: str) -> pd.Series:
    h = yf.Ticker(ticker).history(period="max", auto_adjust=True)
    if h.empty:
        raise RuntimeError(f"no Yahoo prices for {ticker}")
    h.index = h.index.tz_localize(None)
    s = h["Close"].resample("ME").last().dropna()
    s.index = s.index.normalize()
    return s


def nearest_prior_month_end(series: pd.Series, date: str):
    d = pd.Timestamp(date).normalize()
    prior = series.loc[:d]
    if prior.empty:
        return None, None
    return prior.index[-1], float(prior.iloc[-1])


def fwd_return(series: pd.Series, start_date: str, years: int):
    i0, p0 = nearest_prior_month_end(series, start_date)
    if i0 is None or p0 <= 0:
        return None
    te = (i0 + pd.DateOffset(years=years) + pd.offsets.MonthEnd(0))
    if te not in series.index:
        after = series.loc[te:]
        if after.empty:
            return None
        i1 = after.index[0]
        if (i1 - te).days > 10:
            return None
    else:
        i1 = te
    p1 = float(series.loc[i1])
    tot = p1 / p0 - 1.0
    if years == 1:
        return {"start": i0.date().isoformat(), "end": i1.date().isoformat(), "ret": tot, "ret_ann": tot}
    yrs = (i1 - i0).days / 365.25
    if yrs < years - 0.15:
        return None
    return {"start": i0.date().isoformat(), "end": i1.date().isoformat(), "ret": tot, "ret_ann": (p1 / p0) ** (1 / yrs) - 1, "years": yrs}


def linreg(xs, ys):
    n = len(xs)
    if n < 5:
        return None
    x = np.asarray(xs, float)
    y = np.asarray(ys, float)
    xm, ym = x.mean(), y.mean()
    den = ((x - xm) ** 2).sum()
    if den == 0:
        return None
    slope = float(((x - xm) * (y - ym)).sum() / den)
    intercept = float(ym - slope * xm)
    yhat = intercept + slope * x
    ss_tot = float(((y - ym) ** 2).sum())
    ss_res = float(((y - yhat) ** 2).sum())
    r2 = None if ss_tot == 0 else float(1 - ss_res / ss_tot)
    return {"slope": slope, "intercept": intercept, "r2": r2, "n": n, "x_min": float(x.min()), "x_max": float(x.max())}


def siblis_fpe(ticker: str):
    base = "https://siblisresearch.supabase.co/functions/v1/free-data-api"
    try:
        d = get_json(f"{base}/v1/{ticker}/pe-forward")
    except Exception as e:
        print(f"WARN siblis {ticker}: {e}", file=sys.stderr)
        return []
    rows = []
    for row in d.get("data", []):
        rows.append({
            "date": row["trading_day (EOD)"],
            "fpe": float(row["value"]),
            "source": f"Siblis Research free API ({ticker} pe-forward)",
            "method": "Index-level Forward P/E (aggregate)",
            "url": "https://siblisresearch.com/financial-data-api/",
            "index": d.get("index_name"),
        })
    return rows


def damodaran_rows(country: str):
    rows = []
    for r in DAMODARAN_ANNUAL[country]:
        rows.append({
            **r,
            "source": f"Damodaran countrystats ({r['file']})",
            "url": DAMODARAN_URL,
        })
    return rows


def build_points(fpe_rows, price_series, years: int):
    pts = []
    for r in fpe_rows:
        fr = fwd_return(price_series, r["date"], years)
        if not fr:
            continue
        pts.append({
            "asof": r["date"],
            "fpe": r["fpe"],
            "ret": round(fr["ret_ann"] if years > 1 else fr["ret"], 6),
            "ret_total": round(fr["ret"], 6),
            "window_start": fr["start"],
            "window_end": fr["end"],
            "fpe_source": r["source"],
            "fpe_method": r.get("method"),
        })
    return pts


def main():
    px = {t: month_end_prices(t) for t in META}
    sib_keys = sorted({m["sib_key"] for m in META.values()})
    sib = {k: siblis_fpe(k) for k in sib_keys}
    yahoo_trail = {}
    for t in META:
        info = yf.Ticker(t).info
        yahoo_trail[t] = {
            "trailingPE": info.get("trailingPE"),
            "asof_price": info.get("regularMarketPrice") or info.get("previousClose"),
            "source": "Yahoo Finance info.trailingPE (ETF-native trailing P/E, not forward)",
        }

    tickers = {}
    for tk, meta in META.items():
        dam = damodaran_rows(meta["dam_key"])
        sib_rows = sib[meta["sib_key"]]
        p1_d = build_points(dam, px[tk], 1)
        p5_d = build_points(dam, px[tk], 5)
        p1_s = build_points(sib_rows, px[tk], 1)
        p5_s = build_points(sib_rows, px[tk], 5)
        reg1 = linreg([p["fpe"] for p in p1_d], [p["ret"] for p in p1_d])
        reg5 = linreg([p["fpe"] for p in p5_d], [p["ret"] for p in p5_d])
        cur = MSCI_CURRENT[tk]
        for reg in (reg1, reg5):
            if reg:
                reg["implied_at_current"] = reg["intercept"] + reg["slope"] * cur["fpe"]
        tickers[tk] = {
            **meta,
            "current_msci": cur,
            "yahoo_trailing": yahoo_trail[tk],
            "damodaran_fpe": dam,
            "siblis_fpe": sib_rows,
            "points_1y_damodaran": p1_d,
            "points_5y_damodaran": p5_d,
            "points_1y_siblis": p1_s,
            "points_5y_siblis": p5_s,
            "points_1y": sorted(
                [{**p, "series": "damodaran"} for p in p1_d] + [{**p, "series": "siblis"} for p in p1_s],
                key=lambda x: x["asof"],
            ),
            "points_5y": sorted(
                [{**p, "series": "damodaran"} for p in p5_d] + [{**p, "series": "siblis"} for p in p5_s],
                key=lambda x: x["asof"],
            ),
            "regression_1y_damodaran": reg1,
            "regression_5y_damodaran": reg5,
            "price_asof": px[tk].index[-1].date().isoformat(),
            "price_last": float(px[tk].iloc[-1]),
            "n": {
                "damodaran": len(dam),
                "siblis": len(sib_rows),
                "1y_dam": len(p1_d),
                "5y_dam": len(p5_d),
                "1y_sib": len(p1_s),
                "5y_sib": len(p5_s),
            },
            "years": {
                "damodaran_all": [r["date"][:4] for r in dam],
                "damodaran_1y_scatter": [p["asof"][:4] for p in p1_d],
                "damodaran_5y_scatter": [p["asof"][:4] for p in p5_d],
                "siblis_all": [r["date"][:10] for r in sib_rows],
                "siblis_1y_scatter": [p["asof"][:10] for p in p1_s],
            },
        }
        print(
            f"{tk}: MSCI FPE {cur['fpe']}x @ {cur['date']} | Damodaran years={','.join(r['date'][:4] for r in dam)} "
            f"| 1Y n={len(p1_d)} | 5Y n={len(p5_d)} | Siblis raw={len(sib_rows)} 1Y n={len(p1_s)}"
        )

    payload = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "title": "Forward P/E vs subsequent returns — EWZ / EWY / MCHI",
        "methodology": [
            "ETF-native historical Forward P/E for EWZ/EWY is not published as a continuous public series (Yahoo forwardPE is null for these ETFs).",
            "Current Forward P/E marker = official MSCI country-index factsheet P/E Fwd (EWZ→Brazil, EWY→Korea, MCHI→China), dated 2026-10-30.",
            "Annual historical Forward P/E = every Damodaran Country Stats January workbook publicly archived (countrystats12.xls → current countrystats.xls): firm-average through 2020-01, firm-median from 2021-01. Not identical to MSCI index aggregate FPE; documented firm-distribution proxy. No pre-2012 archive file; no Jan-2014 workbook (countrystats14.xls dated 2015-01-05). All available years are embedded — scatter points require a completed subsequent-return window.",
            "Sparse recent index-level Forward P/E = Siblis free API for IBOV (Brazil), KOSPI (Korea) and SSE (China mainland Composite; free-tier stand-in — not identical to MSCI China which also includes H/Red/P/ADR).",
            "Subsequent returns = Yahoo Finance adjusted close of EWZ/EWY, month-end to month-end (1y simple; 5y annualized). Incomplete windows omitted.",
            "OLS regression only on the Damodaran annual sample (homogeneous method). Small-N — descriptive, not predictive. No invented FPE points.",
        ],
        "sources": [
            {"name": "MSCI Brazil Index factsheet", "url": MSCI_CURRENT["EWZ"]["url"]},
            {"name": "MSCI Korea Index factsheet", "url": MSCI_CURRENT["EWY"]["url"]},
            {"name": "MSCI China Index factsheet", "url": MSCI_CURRENT["MCHI"]["url"]},
            {"name": "Damodaran Country Stats", "url": DAMODARAN_URL},
            {"name": "Siblis Research free valuations API", "url": "https://siblisresearch.com/financial-data-api/"},
            {"name": "Yahoo Finance (yfinance) EWZ/EWY/MCHI adjusted closes", "url": "https://finance.yahoo.com/"},
        ],
        "gaps": [
            "No continuous ETF-native Forward P/E history for EWZ/EWY in free public APIs.",
            "Damodaran Country Stats public XLS archives start at countrystats12.xls (Date updated ~2012-01); no pre-2012 Forward PE country file retrieved (countrystats05–11 → 404).",
            "Damodaran annual series has no January 2014 observation: countrystats14.xls is dated 2015-01-05 (archives jump 2013→2015).",
            "Damodaran asof 2026-01 is stored but omitted from completed-return scatters until the 1Y/5Y window finishes.",
            "Siblis free tier only exposes a handful of recent month-ends (currently ~9 IBOV/KOSPI/SSE snapshots from 2023-12 onward) — too few for a 5-year completed window; points without a finished return window stay in siblis_fpe but not in scatter series.",
            "China sparse recent series = Siblis SSE Composite (mainland), not MSCI China aggregate; Damodaran China is firm-distribution across Chinese listings. Documented proxy stack, not identical series.",
            "Update MSCI_CURRENT in this script when new MSCI factsheets publish (or wire a PDF parser).",
        ],
        "tickers": tickers,
    }
    os.makedirs(DATA, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()

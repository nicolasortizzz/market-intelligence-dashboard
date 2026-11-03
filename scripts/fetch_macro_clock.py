"""Refresh data/macro_clock.json 'now.computed' from FRED (no API key, fredgraph.csv):
CPIAUCSL (CPI), GDPC1 (real GDP), GDPPOT (CBO potential) -> output gap = GDPC1/GDPPOT-1.
Phase = sign of change of gap (latest vs previous quarter) x sign of change of CPI y/y (latest vs 3 months before).
Forecasts (y1/y2) are hand-maintained from FMI WEO / Fed SEP; see UPDATING.md. Never fabricates: on failure keeps the file."""
import csv, io, json, os, sys, datetime as dt, urllib.request
P = os.path.join(os.path.dirname(__file__), "..", "data", "macro_clock.json")
def fred(s):
    r = urllib.request.urlopen(urllib.request.Request(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={s}", headers={"User-Agent": "Mozilla/5.0"}), timeout=60)
    rows = [x for x in csv.reader(io.StringIO(r.read().decode())) if x and x[1] not in ("", ".")][1:]
    return [(d, float(v)) for d, v in rows]
PH = {(1, -1): "recuperacion", (1, 1): "sobrecalentamiento", (-1, 1): "estanflacion", (-1, -1): "reflacion"}
def main():
    d = json.load(open(P))
    try:
        cpi, gdp, pot = fred("CPIAUCSL"), fred("GDPC1"), dict(fred("GDPPOT"))
        yoy = [(cpi[i][0], (cpi[i][1] / cpi[i - 12][1] - 1) * 100) for i in range(12, len(cpi))]
        gap = [(q, (v / pot[q] - 1) * 100) for q, v in gdp if q in pot]
        dc, dg = yoy[-1][1] - yoy[-4][1], gap[-1][1] - gap[-2][1]
        sg = lambda x: 1 if x >= 0 else -1
        d["now"]["computed"] = {"cpiYoY": round(yoy[-1][1], 2), "cpiPeriod": yoy[-1][0], "cpiChange3m": round(dc, 2),
            "gap": round(gap[-1][1], 2), "gapPeriod": gap[-1][0], "gapChangeQ": round(dg, 2), "phase": PH[(sg(dg), sg(dc))],
            "source": "FRED CPIAUCSL, GDPC1, GDPPOT (CBO). Gap CBO como proxy del output gap OECD (OECD EO es semestral).",
            "fetchedAt": dt.datetime.now().isoformat(timespec="minutes")}
    except Exception as e:
        print("macro_clock: FRED fetch failed, keeping previous values:", e); return
    json.dump(d, open(P, "w"), ensure_ascii=False, indent=1); print("macro_clock:", d["now"]["computed"])
if __name__ == "__main__": main()

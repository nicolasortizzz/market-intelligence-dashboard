"""Fetch the latest market price for the reverse-DCF panel -> data/reverse_dcf.json
Source: Yahoo Finance via yfinance (last daily close). Lightweight, so the reverse DCF can be
refreshed without re-pulling the full valuation snapshot.
Usage: python scripts/fetch_reverse_dcf.py [TICKER ...]   (with tickers, only those are refreshed and merged)
"""
import json, os, datetime as dt
import yfinance as yf

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "reverse_dcf.json")
TICKERS = ["META", "UNH", "DIS", "NIO", "YPF", "GGAL", "MU", "ASML", "VST", "ABEV", "UBER", "BE", "AVGO", "VIST", "TSM", "SPCX", "005930.KS"]
LOCAL = {"005930.KS": "KRW"}   # local-currency listings: close converted to USD at the valuation.json official rate (fx.<CCY>USD)


def main():
    import sys
    only = [a.upper() for a in sys.argv[1:]]
    quotes = json.load(open(OUT))["quotes"] if only and os.path.exists(OUT) else {}
    for tk in TICKERS:
        if only and tk not in only: continue
        h = yf.Ticker(tk).history(period="10d", auto_adjust=False)
        h = h.dropna(subset=["Close"])
        if h.empty:
            continue
        px = float(h["Close"].iloc[-1]); extra = {}
        if tk in LOCAL:
            fx = json.load(open(os.path.join(os.path.dirname(OUT), "valuation.json")))["fx"]; cc = LOCAL[tk]
            extra = {"priceLocal": px, "currencyLocal": cc, "fx": fx[cc + "USD"], "fxDate": fx.get(cc + "_date"), "fxSource": fx.get(cc + "_source")}
            px = px / fx[cc + "USD"]
        quotes[tk] = {"price": round(px, 4), **extra,
                      "priceDate": h.index[-1].strftime("%Y-%m-%d"),
                      "field": "Close (unadjusted, last trading day)",
                      "source": "Yahoo Finance via yfinance"}
        print(tk, quotes[tk]["price"], quotes[tk]["priceDate"])
    out = {"generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "quotes": quotes}
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()

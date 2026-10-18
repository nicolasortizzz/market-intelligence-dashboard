"""Fetch the latest market price for the reverse-DCF panel -> data/reverse_dcf.json
Source: Yahoo Finance via yfinance (last daily close). Lightweight, so the reverse DCF can be
refreshed without re-pulling the full valuation snapshot.
Usage: python scripts/fetch_reverse_dcf.py
"""
import json, os, datetime as dt
import yfinance as yf

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "reverse_dcf.json")
TICKERS = ["META", "UNH", "DIS", "NIO"]


def main():
    quotes = {}
    for tk in TICKERS:
        h = yf.Ticker(tk).history(period="10d", auto_adjust=False)
        h = h.dropna(subset=["Close"])
        if h.empty:
            continue
        quotes[tk] = {"price": round(float(h["Close"].iloc[-1]), 4),
                      "priceDate": h.index[-1].strftime("%Y-%m-%d"),
                      "field": "Close (unadjusted, last trading day)",
                      "source": "Yahoo Finance via yfinance"}
        print(tk, quotes[tk]["price"], quotes[tk]["priceDate"])
    out = {"generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "quotes": quotes}
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()

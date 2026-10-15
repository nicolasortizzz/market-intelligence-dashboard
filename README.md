# Market Intelligence Dashboard

**Nicolas Ortiz — Economist | Financial & Data Analyst**

🔗 **Live dashboard:** https://nicolasortizzz.github.io/market-intelligence-dashboard/

An interactive, fully static market-intelligence web app built on **real data** for 30 large companies (26 US large caps across 11 sectors plus the Argentine ADRs YPF, GGAL, MELI and PAM), benchmarked against the S&P 500 (SPY). It brings together prices, risk metrics, fundamentals, a Markowitz portfolio builder, SEC filings, insider trades and US Treasury yields.

![Overview](docs/overview.png)

## Features

| Tab | What it shows |
|---|---|
| **Overview** | KPI cards, a sector treemap sized by market cap and colored by return (1D/1M/YTD/1Y), top movers, a sortable screener with 30-day sparklines |
| **Company** | Candlestick or line chart with range selector (1M–2Y), range slider, MA50/MA200, volume, multi-ticker comparison (rebased returns), fundamentals, analyst recommendation trend and mean target, dividends, drawdown |
| **Risk & Correlation** | Risk/return scatter (bubble = market cap) with **brush selection** that filters the table, plus a 30×30 correlation heatmap |
| **Portfolio Builder** | Weight sliders, add/remove assets, **Equal / Min-variance / Max-Sharpe** optimizers, an efficient-frontier cloud colored by Sharpe, the capital market line and parametric 1-day VaR (95%) |
| **Company Activity** | SEC EDGAR feed of 8-K/10-Q/10-K/Form 4/20-F/6-K filings (180 days) with filters, parsed Form 4 insider transactions, net insider flow by ticker, a filing timeline and upcoming earnings dates |
| **Macro** | US Treasury par yield curve (latest vs ~1M and ~6M ago), 10Y vs 2Y with the spread, and the official USD/ARS rate from BCRA |

Also included: global ticker search (press `/`, use arrow keys), a **USD ⇄ ARS** toggle (BCRA official rate), dark/light theme, skeleton loaders, animated counters and transitions, a responsive layout and deep links (`#company/MELI`).

## Data sources

| Source | Data | Access |
|---|---|---|
| Yahoo Finance via [`yfinance`](https://github.com/ranaroussi/yfinance) | 2y daily OHLCV, adjusted closes, fundamentals, dividends, analyst recommendations, earnings dates | Free, unofficial |
| [SEC EDGAR](https://www.sec.gov/edgar/sec-api-documentation) | `submissions` API (recent filings) and Form 4 XML (insider transactions) | Free, no key; a declared User-Agent is required |
| [U.S. Treasury](https://home.treasury.gov/resource-center/data-chart-center/interest-rates) | Daily par yield curve | Free CSV |
| [BCRA](https://www.bcra.gob.ar/) | Official USD/ARS exchange rate (`estadisticascambiarias` API) | Free, no key |

## Methodology

- **Returns**: from adjusted closes (dividends and splits included). 1D/1M/3M/1Y = 1/21/63/252 trading days.
- **Volatility**: standard deviation of daily returns over the last 252 days × √252.
- **Annualized return** (used for risk/return and Markowitz): mean daily return × 252, i.e. the arithmetic, historical mean. It is **not a forecast**.
- **Beta**: Cov(asset, SPY) / Var(SPY) on 1Y daily returns.
- **Drawdown**: price / running maximum − 1. The maximum drawdown is measured over the last year.
- **Correlation / covariance**: Pearson correlation of 1Y daily returns. Covariance is annualized (×252).
- **Markowitz**: long-only and fully invested. The frontier is approximated with 2,500 random Dirichlet-style portfolios, and Min-variance / Max-Sharpe are found by random search plus local pairwise-swap refinement. The risk-free rate is the latest 3-month T-bill par yield.
- **VaR (95%, 1-day, parametric)**: 1.645·σ/√252 − μ/252.
- **Insider flow**: up to the 6 most recent Form 4 filings per company are parsed. Value = shares × price, with dispositions counted as negative. Grants and awards without a price add zero value.
- **ARS amounts**: USD values × the BCRA official rate on the snapshot date. They are a conversion only.

## Data snapshot and refresh

The site is static: it reads the JSON files in `data/` (`market.json`, `prices.json`, `activity.json`, `macro.json`), each of which carries a `generatedAt` UTC timestamp. The current snapshot uses the **market close of 2026-10-14**.

To refresh:

```bash
pip install -r requirements.txt
python scripts/fetch_data.py      # ~2 minutes; rewrites data/*.json
python -m http.server 8000        # preview at http://localhost:8000
git add data && git commit -m "Refresh data snapshot" && git push
```

Edit `UNIVERSE` in `scripts/fetch_data.py` to change the set of companies. Please keep the SEC User-Agent descriptive (SEC fair-access policy).

## Stack

Vanilla HTML/CSS/JS with [Plotly.js](https://plotly.com/javascript/) for the charts and Python (pandas, numpy, yfinance, requests) for the data pipeline. It is hosted on GitHub Pages and needs no build step.

## Limitations

- Yahoo Finance data is unofficial and can contain gaps or revisions. Fundamentals are trailing and as reported by Yahoo.
- For ADRs (YPF, GGAL, PAM), some fundamentals are reported in ARS by Yahoo, so ratios are fine but absolute figures may differ.
- Insider data covers a sample of the latest Form 4s, not the complete history.
- Historical means are noisy estimators. Optimized portfolios are illustrative.

## Disclaimer

This project is for **educational and portfolio purposes only**. It is **not investment advice** or a recommendation to buy or sell any security. Data may be delayed, incomplete or inaccurate.

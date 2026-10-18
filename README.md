# Market Intelligence Dashboard

**Nicolas Ortiz — Economist | Financial & Data Analyst**

🔗 **Live dashboard:** https://nicolasortizzz.github.io/market-intelligence-dashboard/

An interactive, fully static market-intelligence web app built on **real data** for 31 companies (26 US large caps across 11 sectors, the Argentine ADRs YPF, GGAL, MELI and PAM, and NIO), benchmarked against the S&P 500 (SPY). It brings together prices, risk metrics, fundamentals, a Markowitz portfolio builder, SEC filings, insider trades and US Treasury yields.

![Overview](docs/overview.png)

![Valuation & M&A](docs/valuation.png)

## Features

| Tab | What it shows |
|---|---|
| **Overview** | KPI cards, a sector treemap sized by market cap and colored by return (1D/1M/YTD/1Y), top movers, a sortable screener with 30-day sparklines |
| **Company** | Candlestick or line chart with range selector (1M–2Y), range slider, MA50/MA200, volume, multi-ticker comparison (rebased returns), fundamentals, analyst recommendation trend and mean target, dividends, drawdown |
| **Risk & Correlation** | Risk/return scatter (bubble = market cap) with **brush selection** that filters the table, plus a 31×31 correlation heatmap |
| **Portfolio Builder** | Weight sliders, add/remove assets, **Equal / Min-variance / Max-Sharpe** optimizers, an efficient-frontier cloud colored by Sharpe, the capital market line and parametric 1-day VaR (95%) |
| **Company Activity** | SEC EDGAR feed of 8-K/10-Q/10-K/Form 4/20-F/6-K filings (180 days) with filters, parsed Form 4 insider transactions, net insider flow by ticker, a filing timeline and upcoming earnings dates |
| **Valuation & M&A** | DCF workbench for **META, UNH, DIS, NIO, YPF** plus a residual-income (bank) model for **GGAL**: 10-year projections, WACC/terminal-growth/margin/capex sliders, a WACC × g sensitivity heatmap, an EV→equity bridge, trading comps, a precedent-transaction and control-premium view, a football field, Bear/Base/Bull plus tail scenarios with probabilities, a Monte Carlo distribution, a **reverse DCF** (growth and margin implied by the current price, with a growth × margin grid), a catalyst calendar, quarter-by-quarter timing of the Avengers: Doomsday tail for DIS, and a scored assessment |
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


## Valuation & M&A tab: methodology

🔗 **Live:** https://nicolasortizzz.github.io/market-intelligence-dashboard/#valuation

> ⚠️ Everything in this tab beyond the reported financials is a **model estimate**: projections, margins, scenario probabilities, tail events and precedent ranges are analyst assumptions kept in [`data/valuation_assumptions.json`](data/valuation_assumptions.json). It is a teaching and portfolio tool, **not investment advice**.

**Inputs (real data, `data/valuation.json`, from `scripts/fetch_valuation.py`)**
- Yahoo Finance via yfinance: annual income statement, cash flow and balance sheet (revenue, operating income, D&A, capex, FCF, debt, cash, minority interest), TTM revenue/EBITDA, consensus revenue and EPS estimates (current and next FY), analyst targets, the 52-week range and beta.
- SEC EDGAR XBRL `companyfacts`: reported revenue, operating income, net income, capex and operating cash flow (US-GAAP, annual CY frames), shown as a cross-check table.
- Risk-free rate: latest U.S. Treasury 10Y par yield (`macro.json`).
- NIO reports in CNY. Statements are converted to USD at the Yahoo CNY/USD rate in the snapshot. The ADS ratio is 1:1.

**DCF (FCFF, 10 years)**
- Revenue: years 1-2 use Yahoo consensus growth (± a scenario adjustment), years 3-5 a scenario growth rate, and years 6-10 fade linearly to terminal growth.
- EBIT margin moves linearly from the last fiscal year to the scenario target by year 5. D&A and capex (% of revenue) move from the current or guided level to steady state by year 6. META's year-1 capex reflects its 2026 guidance of $130-145B.
- FCFF = EBIT×(1−t) + D&A − capex − ΔNWC (no tax shield on losses). Discounting is mid-year with a stub-year adjustment: only the unelapsed fraction of the current fiscal year is counted, because the balance sheet already reflects the rest.
- Terminal value uses the value-driver formula: NOPAT₁₁ × (1 − g/RONIC) / (WACC − g), with RONIC = 15%.
- WACC = market-value weights of equity and debt. Ke = rf + β × ERP (4.5%) + country risk (NIO +1.5%). β is Blume-adjusted (0.67β + 0.33), with documented overrides for UNH (0.85) and NIO (1.6). Kd = rf + spread, after tax.
- Equity = EV − net debt − minority interest − scenario one-offs (e.g. fines or settlements). Per share uses market cap / price, adjusted for assumed dilution or buybacks over 3 years. The value is floored at 0 (limited liability).

**Reverse DCF (what the price implies)**

![Reverse DCF](docs/reverse_dcf.png)

- Runs the same DCF engine backwards (same WACC, tax, D&A/capex glide paths, ΔNWC, dilution, net debt, minority interest and terminal value) against the latest close in `data/reverse_dcf.json` (`scripts/fetch_reverse_dcf.py`, yfinance).
- **Implied revenue CAGR**: a flat growth rate for years 1-5 (fading linearly to terminal g over years 6-10) that makes the DCF value equal the market price, at a chosen steady-state EBIT margin (default: the Base-case target). Solved by bisection; the 10-year CAGR is shown for a like-for-like comparison with the Base case, whose growth is front-loaded by consensus.
- **Implied EBIT margin**: the year-5+ margin that matches the price while holding the Base-case revenue path.
- A growth × margin heatmap of value per share with the market-price contour. Its axes are adaptive: centred on the implied point (implied CAGR, target margin) and sized so most cells fall within ~0.3×-3× the current price (colour on a log scale vs price, ¼×-4×); they are rebuilt whenever the price or a slider changes. NIO's margin axis is extended to 18%. a value-vs-growth curve marking implied, Base-case and historical growth, and sliders for WACC, terminal growth and target margin.
- **Historical 5-year revenue CAGR** (`data/revenue_history.json`, `scripts/fetch_revenue_history.py`): reported revenue FY2020→FY2025, i.e. 5 compounding periods, shown as a KPI next to the implied CAGR, as a dash-dot reference line on the value-vs-growth curve and the heatmap (the FY2022-25 3-year CAGR stays as a fainter line), in the "Key inputs & sources" table, and with its source and span in the card tooltip and footnote.
  | Ticker | Span | Currency | 5y CAGR | Source |
  |---|---|---|---|---|
  | META | FY2020→FY2025 | USD | 18.5% | SEC XBRL `RevenueFromContractWithCustomerExcludingAssessedTax` |
  | UNH | FY2020→FY2025 | USD | 11.7% | SEC XBRL `Revenues` |
  | DIS | FY2020 (ended 2020-10-03)→FY2025 (ended 2025-09-27) | USD | 7.6% | SEC XBRL `Revenues` |
  | NIO | FY2020→FY2025 | RMB (constant currency) | 40.0% (USD convenience translation 38.1%) | SEC XBRL, 20-F |
  | YPF | FY2020→FY2025 | USD (functional currency) | 13.7% | SEC XBRL `ifrs-full:Revenue` (USD), 20-F; Yahoo's ARS-labelled figures not used |
  | GGAL | FY2020→FY2025 | USD at year-end BCRA A3500 (84.15 / 1,455) | 19.9% (real ARS 10.3%) | 20-F FY2020 + 4Q2025 release |
- GGAL "revenue" = net operating revenue before loan-loss provisions (net operating income + provisions). Each year is in pesos of its own year end (IAS 29); the real-ARS CAGR restates FY2020 to Dec-2025 pesos with INDEC CPI. After provisions the CAGR is 15.0% in USD / 5.8% real. The Dec-2020 official rate under capital controls flatters the USD figure, and the HSBC Argentina acquisition (Dec-2024) makes growth partly inorganic.
- Example (NIO, close of 2026-10-16, $3.43): ~17.7% revenue CAGR for 5 years (13.2% over 10) at a 4% EBIT margin, or a ~4.1% steady-state margin on Base-case growth, i.e. roughly the Base case. Figures update with the data and the sliders.

**Argentine names: YPF and GGAL**
- **Country risk**: the cost of equity adds the full J.P. Morgan EMBI spread for Argentina, **648 bp at the close of 2026-10-16**, on top of rf (10Y UST) + β × ERP. Betas are documented overrides (YPF 1.1, GGAL 1.15) because Yahoo's 5Y betas (−0.11 and 0.29) are distorted by local ownership and trading.
- **YPF** (1 ADS = 1 Class D share): its functional currency is the **USD** and Yahoo's annual/quarterly statements are in USD, even though Yahoo labels the company "ARS". Debt, cash and TTM revenue/EBITDA are therefore rebuilt from the USD statements (balance sheet 2026-06-30, TTM = Q3 2025-Q2 2026), and Yahoo's ARS revenue consensus is not used for USD growth: FY2026 = H1 2026 reported revenue ($11.5B) + ~$11.5B in H2 at the guided ~$75 Brent (+26%), FY2027 ≈ −2% as Brent normalizes. Year-1 EBIT margin is set at 20% (H1 2026: 23%). Peers: VIST, PAM, PBR, EC. Scenarios include a macro-crisis/devaluation tail (+400 bp country risk, export duties and price controls) and a low-probability tail in which the US Supreme Court revives the $16.1B Petersen/Eton Park judgment against the Republic (voided by the Second Circuit on 2026-03-27, which also confirmed YPF is not liable; plaintiffs petitioned the Supreme Court in October 2026).
- **GGAL** (1 ADS = 10 Class B shares; 1,606.3M Class A+B shares = 160.6M ADR-equivalents) is a bank, so FCFF/EV metrics do not apply. It uses a **residual-income (excess-return) model**: value per ADR = book value + PV of (ROE − Ke) × opening book over 10 years + a terminal residual income. ROE follows consensus EPS for FY2026-27 and converges to a sustainable ROE by year 5; book growth is flat for years 1-5 then fades to g; implied dividends = net income − Δbook.
- **IAS 29 and FX**: GGAL reports in ARS restated for inflation (homogeneous pesos at each statement date). Equity of ARS 9.20T at 2026-06-30 is converted at the **BCRA Com. A3500 rate of that date (1,482 ARS/USD)** → **$38.64 book per ADR**. Older comparatives are restated to later measuring units, so they are not converted into a USD history. The current A3500 rate (1,518 on 2026-10-16) is stored in `valuation.json`.
- **Bank comps**: P/BV (primary) and P/E for BMA, BBAR, SUPV, ITUB and CIB. Peer P/E is TTM while GGAL's TTM earnings are depressed (ROE ~2%), so P/E is applied to FY2026e consensus EPS and shown for reference only; the triangulated value uses P/BV. Precedents use 0.5-1.3x P/BV (Galicia-HSBC Argentina 2024, Macro-Itaú Argentina 2023; estimates).
- **Reverse analysis for a bank** solves for the **implied sustainable ROE** (holding Base book growth) and the implied book-value CAGR (holding the target ROE), with an ROE × book-growth heatmap centred on the implied point.
- Refresh only these two without touching the other snapshots: `python scripts/fetch_valuation.py YPF GGAL`.

**Relative valuation and M&A**
- Trading comps: peer EV/EBITDA, EV/Sales and P/E are **recomputed in USD** (Yahoo's own ratios mix ADR quote and reporting currencies). The IQR is applied to the target's TTM metrics. Outliers are excluded (EV/EBITDA > 60x, P/E > 80x, negatives), and a method is used only with ≥ 2 valid peers.
- Precedent transactions: sector EV/EBITDA (or EV/Sales for NIO) ranges anchored on named deals (e.g. Disney-21CF, CVS-Aetna, Cigna-Express Scripts, Microsoft-Activision, Geely-Volvo) **are estimates**, plus a 15-40% control premium on the unaffected price.
- **Football field**: 52-week range, analyst targets, comps IQR, precedents, takeout range, DCF scenario range and Monte Carlo P10-P90.
- **Triangulated fair value** = 60% probability-weighted DCF + 40% median comps value. Analyst targets are shown only as a cross-check.

**Scenarios, tails and Monte Carlo**
- Each company has Bear / Base / Bull plus two tail scenarios with subjective probabilities that sum to 100%:
  - **DIS**: Avengers: Doomsday mega-hit (Dec 18, 2026 release). The quarterly model splits incremental revenue and operating income across Studio, Home/Disney+, Consumer Products and Experiences for FQ1-FQ4 FY27. A second tail is linear-TV collapse plus recession.
  - **META**: AI super-cycle; regulatory shock (EU DMA, youth-safety litigation, fines).
  - **UNH**: DOJ / False Claims outcome; Medicare Advantage risk-adjustment overhaul.
  - **NIO**: price war plus cash-crunch dilution; battery-swap standard plus subsidy upside.
- Monte Carlo (4,000 runs): draw a scenario by probability, then perturb WACC (σ 0.75pp), terminal g (σ 0.4pp), margin (σ 12% relative) and mid-term growth (σ 1.5pp).
- **Scorecard**: quality, growth and risk scores are qualitative (rationale shown in the app). The valuation score is formula-based: 5 + 10 × implied upside, clipped to 1-10.

**Refresh:** `python scripts/fetch_data.py && python scripts/fetch_valuation.py && python scripts/fetch_reverse_dcf.py`. Edit the assumptions in `data/valuation_assumptions.json`.

**Valuation caveats**
- With a 10Y yield of ~5.2%, discount rates are high. DCF values are very sensitive to WACC and g (see the heatmap), and terminal value is 55-66% of EV.
- Argentina: results are very sensitive to the country-risk premium (each +100 bp lowers Ke/WACC-based values materially), Brent (YPF) and the inflation/FX path (GGAL). Yahoo labels both companies ARS; YPF statements are USD while some Yahoo fields (revenue growth, consensus) are ARS-based, so those are not used for USD projections.
- Yahoo statements are standardized and can differ from company-reported "segment operating income" (e.g. DIS). Peer sets are small, and some peers report in other currencies.
- Scenario probabilities and tails are judgment calls. Event-driven tails (box office, DOJ outcomes, subsidies) are illustrative, not predictions.

## Data snapshot and refresh

The site is static: it reads the JSON files in `data/` (`market.json`, `prices.json`, `activity.json`, `macro.json`), each of which carries a `generatedAt` UTC timestamp. The current snapshot uses the **market close of 2026-10-14**.

To refresh:

```bash
pip install -r requirements.txt
python scripts/fetch_data.py      # ~2 minutes; rewrites market/prices/activity/macro.json
python scripts/fetch_valuation.py # ~20 seconds; rewrites valuation.json
python scripts/fetch_reverse_dcf.py # a few seconds; latest closes for the reverse DCF
python scripts/fetch_revenue_history.py # FY2020-FY2025 revenue (SEC XBRL; GGAL hand-entered)
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

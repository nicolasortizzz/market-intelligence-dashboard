# Updating the dashboard

The site is static: every chart reads JSON files in `data/`. Refreshing means re-running the fetch scripts,
checking the output and pushing `main` (GitHub Pages serves the `gh-pages` branch, which is a copy of `main`).

## 1. One-time setup

```bash
git clone https://github.com/nicolasortizzz/market-intelligence-dashboard.git
cd market-intelligence-dashboard
make setup            # = python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/playwright install chromium
```

Python 3.11+ (tested on 3.13). Playwright/Chromium is optional; it is only used to compute fair values with the
site's own JavaScript engine for the before/after summary and to catch JS errors.

## 2. Refresh everything (one command)

```bash
make update           # or: ./update.sh   or: python scripts/update_all.py
make deploy           # same, then commits data/ and pushes main + gh-pages if validation passes
```

Options (pass with `ARGS="..."` to make, or directly to `update.sh`):

| Flag | Effect |
|---|---|
| `--skip market,embi` | skip steps (`market`, `valuation`, `reverse`, `revenue`, `wacc`, `embi`) |
| `--apply-embi` | set the YPF/GGAL country-risk premium to the latest EMBI (changes valuations; review the diff) |
| `--deploy` | commit `data/` and push `main` and `main:gh-pages` |

What runs, in order (~5 minutes in total):

| Step | Script | Writes | Source |
|---|---|---|---|
| market | `fetch_data.py` | `market.json`, `prices.json`, `activity.json`, `macro.json` | Yahoo Finance, SEC EDGAR, US Treasury, BCRA |
| valuation | `fetch_valuation.py` | `valuation.json` (prices, statements, consensus, peers, FX: CNY Yahoo, EUR ECB, ARS BCRA) | Yahoo, SEC XBRL, ECB, BCRA |
| reverse | `fetch_reverse_dcf.py` | `reverse_dcf.json` (latest closes) | Yahoo |
| revenue | `fetch_revenue_history.py` | `revenue_history.json` (5y revenue CAGR) | SEC XBRL, BCRA, INDEC, ECB |
| wacc | `fetch_wacc_history.py` | `wacc_history.json` (FY2021-FY2025 + current WACC) | ^TNX, ^GSPC, Damodaran, argentinadatos |
| embi | `fetch_embi.py` | `embi.json` (Argentina EMBI) | api.argentinadatos.com |

Validation (the command exits with code 1 and does not deploy if any check fails): every JSON parses and contains no
NaN/Infinity, every file was rewritten by this run, each valuation ticker has a price > 0 dated within 7 days and a
reverse-DCF quote, historical WACC / cost of equity is within 2-45%, and 5y revenue CAGRs are within -50% to +100%.
It then prints price, triangulated fair value and WACC per ticker, before vs after, and saves them to
`data/last_update_summary.json`.

## 3. What stays manual (judgment, edited by hand in `data/valuation_assumptions.json`)

- Scenario probabilities, scenario descriptions, tail events, and growth / margin / capex assumptions.
- Overrides of consensus: `g1`, `g2`, `ebit1` (e.g. YPF, whose Yahoo consensus is in ARS), beta overrides and notes.
- Peer lists (`TARGETS` in `scripts/fetch_valuation.py`), reference-only peers (`compsRef`), precedent ranges and notes.
- Country risk: the EMBI is fetched automatically, but the model CRP only changes with `--apply-embi`.
  Damodaran ERP / China CRP for new years: add the January value to `ERP` / `CHINA_CRP` in `fetch_wacc_history.py`
  (the script also tries to refresh ERP from `histimpl.xls` automatically).
- Hand-entered bank figures for GGAL's revenue history (`GGAL` dict in `fetch_revenue_history.py`) and the
  `END` year (move both windows forward once all companies have filed the next fiscal year).
- Catalyst calendars and scorecard rationales.

Always look at the summary table: a large move in a fair value usually means a data change (new fiscal year,
consensus revision, restated statements) that deserves a look at the assumptions.

## 4. Adding a new ticker (standard template)

1. `scripts/fetch_valuation.py`: add `"TICKER": [peers...]` to `TARGETS`. Special cases: `USD_STMT` (statements in
   USD although Yahoo says otherwise), `BANKS` (residual-income model; value = local shares per ADR),
   `SEC_APPEND` (Yahoo's annual statements lag the latest 10-K). Non-USD reporters need a `fx["<CUR>USD"]` entry
   (units per USD; CNY via Yahoo, EUR via the ECB and BRL via the BCB PTAX are handled; add a fetcher for a new currency
   next to `ecb_eurusd()` / `ptax()` and a label in the "Reporting currency" row of `valuation.js`).
2. `data/valuation_assumptions.json`: copy an existing company block and edit sector, beta (`betaAdj`/`betaOverride`),
   `crp`, `kdSpread`, `tax`, D&A / capex / NWC glide paths, `terminalG`, precedents, `controlPremium`, 3 base
   scenarios plus low-probability high-impact tails (probabilities must sum to 1), catalysts and score.
3. `valuation.js`: add the ticker to `VT` (the selector, DCF, comps, Monte Carlo, football field and scenario table follow).
4. `scripts/fetch_reverse_dcf.py`: add it to `TICKERS`. The reverse-DCF heatmap axes are adaptive (centred on the
   point implied by today's price); widen a range only if needed with `RV_EXTRA` in `reverse_dcf.js`.
5. `scripts/fetch_revenue_history.py`: add `"TICKER": (namespace, [XBRL tags], currency)` to `SEC` for the 5-year
   revenue CAGR card and chart line (FY2020-FY2025; add notes for odd fiscal years or currencies).
6. The 5-year WACC card needs nothing extra: `fetch_wacc_history.py` covers every company in the assumptions file
   (for a new emerging-market name add its Damodaran CRP series to `COUNTRY_CRP`, as for NIO/China and ABEV/Brazil,
   and a currency rule for debt conversion if it reports in a new currency; set `crp` and `crpLabel` in the assumptions).
7. Run `python scripts/fetch_valuation.py TICKER && python scripts/fetch_reverse_dcf.py TICKER` (ticker-scoped,
   leaves other tickers untouched), then `make update ARGS="--skip market,valuation,reverse"`, preview with
   `make serve`, and update the README.

## 5. Optional: weekly GitHub Actions refresh (not installed)

The deploy token used so far has no `workflow` scope, so this file is **not** in the repo. To enable it, save it as
`.github/workflows/update.yml` with a token that has `workflow` scope (and allow Actions to write to the repo):

```yaml
name: Weekly data refresh
on:
  schedule:
    - cron: "0 12 * * 6"      # Saturdays 12:00 UTC (09:00 Buenos Aires), after the Friday close
  workflow_dispatch: {}
permissions:
  contents: write
jobs:
  update:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-python@v5
        with: { python-version: "3.13" }
      - run: pip install -r requirements.txt && python -m playwright install --with-deps chromium
      - name: Refresh, validate and deploy
        run: |
          git config user.name  "Nicolas Ortiz Armesto"
          git config user.email "150628077+nicolasortizzz@users.noreply.github.com"
          python scripts/update_all.py --deploy
```

## Optional per-ticker assumption keys
- `compsRef`: peers shown but excluded from the comps statistics. `peExcludePeers`: peers excluded from P/E only (e.g. one-off tax gains).
- `peNIExclude` (USD) + `peNIExcludeLabel`: one-off items removed from the company's TTM net income before P/E (UBER: tax valuation-allowance release).
- `nonOpAssets` {`row`, `label`, optional `fallback`}: balance-sheet row (fetched in `fetch_valuation.py` `ROWS["balance"]`) added to equity in the DCF, comps and precedent bridges (UBER equity stakes).
- `converts` [{`name`, `principal`, `convPrice`}] + `convertsNote`: convertible notes, if-converted when the price is above the conversion price (shares added, principal removed from debt). Update from each 10-Q.
- `compsExcludeNegEbitda`: drop peers with negative TTM EBITDA from all comps statistics (still shown).
- YPF/GGAL "today" WACC rows use the model CRP from `valuation_assumptions.json` (changed only by `fetch_embi.py --apply`), so rerunning `fetch_wacc_history.py` no longer moves them; year-end rows use the EMBI at each year-end.
- Argentine names (`ARG` in `fetch_wacc_history.py`: YPF, GGAL, VIST) use the EMBI Argentina spread as CRP; `fetch_embi.py --apply` updates all of them.
- `SEC_FALLBACK` in `fetch_revenue_history.py`: annual revenue for a filed 10-K/20-F that is not yet in XBRL companyfacts (checked against the filed document; VIST FY2025).
- TWD: `cbc_twd()` in `fetch_valuation.py` reads the CBC NT$/US$ closing rate (refreshed only with TSM; `verify=False` because the cbc.gov.tw certificate is rejected by Python 3.13). WACC-history year-end TWD debt uses Yahoo TWD=X. `adrRatio` labels the ADR ratio (TSM 5).
- SPCX: `FILING_OVERRIDE` in `fetch_valuation.py` holds shares, cash, debt and TTM revenue/EBITDA from the latest 8-K/10-Q while Yahoo lags (it switches itself off once Yahoo's last quarter reaches `period`; update it after each quarterly report). Revenue history is the hand-entered `SPCX` block in `fetch_revenue_history.py` (424B4; only FY2023-FY2025, `periods: 2`; extend when the first 10-K is filed). Pre-IPO WACC rows use `PROXY` in `fetch_wacc_history.py` (peer-proxy beta, private marks).
- KRW (Samsung 005930.KS, SK hynix 000660.KS): `ecb_cross("KRW")` in `fetch_valuation.py` (refreshed only with Samsung); `fetch_reverse_dcf.py` converts the KRX close with that rate (`LOCAL`). Annual revenue for the 5-year CAGR is the hand-entered `SAMSUNG` block in `fetch_revenue_history.py` (add FY2026 when reported). WACC history converts the KRX price to USD (`LOCAL_PX`, Yahoo KRW=X) before computing the beta.
- `compsCycle` (per ticker in `valuation_assumptions.json`, e.g. `{"years": 4, "metrics": ["evEbitda", "pe"]}`): comps use the average of the last N fiscal years plus TTM instead of peak TTM earnings, and only the listed metrics. Used for Samsung; MU is a candidate (its TTM EBITDA is ~9x its FY2022-25 average) but is unchanged.
- `make validate` (`scripts/validate_dashboard.py`) renders the Valuation tab headlessly for every ticker and fails on: reverse-DCF slider defaults != model values or outside the slider range, custom slider values carried over between tickers or not flagged, Base star / implied point outside the heatmap, price outside the grid's values, non-finite values, unwarned implausible implied growth, >8 x-labels or >11 y-labels, missing revenue CAGR or WACC history, JS errors. It runs inside `make update` / `make deploy`; use `make push` (validate, then push main + gh-pages) for code changes. A local `.git/hooks/pre-push` runs it too.
- SK hynix (000660.KS): revenue for the 5-year CAGR is the hand-entered `SKHYNIX` block in `fetch_revenue_history.py` (add FY2026 when reported). `peNIExclude` in the assumptions removes the Q2-2026 non-operating gain from P/E; drop it once that quarter leaves the TTM window (after Q2-2027 results).

## Valuation summary for external pages
- `data/valuation_summary.json` is written by `scripts/validate_dashboard.py --export` (run by `make update` / `make summary` after every check passes). It holds, per ticker, the model-default values from the same engine (`valSummary()` in `valuation.js`): price, Base / probability-weighted DCF, comps, triangulated value, upside, WACC and its 5-year history, Monte Carlo percentiles, scenarios, reverse-DCF implied growth, 5-year revenue CAGR and the FX rate with date.
- The ModelosArgentina site (https://nicolasortizzz.github.io/ModelosArgentina/) reads this file and embeds the workbench with `?embed=valuation#valuation/<TICKER>` (embed mode hides the header, tape, tabs and footer; `&theme=light|dark`). Nothing is copied, so this repo stays the single source of truth: refresh here and push, and that site updates.


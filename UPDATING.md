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
   (units per USD; CNY and EUR are handled).
2. `data/valuation_assumptions.json`: copy an existing company block and edit sector, beta (`betaAdj`/`betaOverride`),
   `crp`, `kdSpread`, `tax`, D&A / capex / NWC glide paths, `terminalG`, precedents, `controlPremium`, 3 base
   scenarios plus low-probability high-impact tails (probabilities must sum to 1), catalysts and score.
3. `valuation.js`: add the ticker to `VT` (the selector, DCF, comps, Monte Carlo, football field and scenario table follow).
4. `scripts/fetch_reverse_dcf.py`: add it to `TICKERS`. The reverse-DCF heatmap axes are adaptive (centred on the
   point implied by today's price); widen a range only if needed with `RV_EXTRA` in `reverse_dcf.js`.
5. `scripts/fetch_revenue_history.py`: add `"TICKER": (namespace, [XBRL tags], currency)` to `SEC` for the 5-year
   revenue CAGR card and chart line (FY2020-FY2025; add notes for odd fiscal years or currencies).
6. The 5-year WACC card needs nothing extra: `fetch_wacc_history.py` covers every company in the assumptions file
   (add a CRP rule there for a new emerging-market country).
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

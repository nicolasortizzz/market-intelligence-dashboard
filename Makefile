PY ?= python3
.PHONY: setup update deploy serve validate push
setup:            ## create .venv and install pinned dependencies + Chromium for validation
	$(PY) -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/playwright install chromium
update:           ## refresh every data snapshot, validate, print the diff
	.venv/bin/python scripts/update_all.py $(ARGS)
deploy:           ## refresh, validate, commit data and push main + gh-pages
	.venv/bin/python scripts/update_all.py --deploy $(ARGS)
serve:            ## preview at http://localhost:8000
	$(PY) -m http.server 8000
validate:         ## headless checks of every ticker (sliders = model, markers inside grid, labels, CAGR/WACC present, no JS errors)
	.venv/bin/python scripts/validate_dashboard.py
push: validate    ## validate, then push main + gh-pages
	git push origin main && git push origin main:gh-pages

PY ?= python3
.PHONY: setup update deploy serve
setup:            ## create .venv and install pinned dependencies + Chromium for validation
	$(PY) -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/playwright install chromium
update:           ## refresh every data snapshot, validate, print the diff
	.venv/bin/python scripts/update_all.py $(ARGS)
deploy:           ## refresh, validate, commit data and push main + gh-pages
	.venv/bin/python scripts/update_all.py --deploy $(ARGS)
serve:            ## preview at http://localhost:8000
	$(PY) -m http.server 8000

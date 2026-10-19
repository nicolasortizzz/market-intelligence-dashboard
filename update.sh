#!/usr/bin/env bash
# One-command refresh: ./update.sh [--deploy] [--apply-embi] [--skip market,...]
set -euo pipefail
cd "$(dirname "$0")"
PY=python3; [ -x .venv/bin/python ] && PY=.venv/bin/python
exec "$PY" scripts/update_all.py "$@"

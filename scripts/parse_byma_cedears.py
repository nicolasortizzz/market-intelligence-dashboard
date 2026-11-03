"""Parse the BYMA CEDEAR list (pdftotext -layout of byma.pdf) into data/byma_cedears.json.
Usage: python scripts/parse_byma_cedears.py /workspace/cfo/byma.txt"""
import json, re, sys, os, datetime as dt
src = sys.argv[1] if len(sys.argv) > 1 else "/workspace/cfo/byma.txt"
rx = re.compile(r"^\s*(.+?)\s{2,}([A-Z0-9.]{1,8})(?:\s{2,}([A-Za-z][A-Za-z ]*?))?(?:\s{2,}(\d+:\d+))?\s*$")
out = {}
for ln in open(src, encoding="utf-8", errors="ignore"):
    m = rx.match(ln.rstrip())
    if not m or m.group(1).strip().startswith(("Nombre", "Código")): continue
    name, code, mkt, ratio = m.groups()
    out.setdefault(code, {"name": name.strip(), "market": (mkt or "").strip(), "ratio": ratio})
# Universe ticker -> BYMA code when they differ (verified against the BYMA list).
ALIAS = {"DIS": "DISN", "005930.KS": "SMSN"}
# Argentine companies quoted locally on BYMA as shares (not CEDEARs).
LOCAL = {"GGAL": "Grupo Financiero Galicia (acción local BYMA)", "YPF": "YPF (acción local YPFD BYMA)"}
root = os.path.join(os.path.dirname(__file__), "..", "data", "byma_cedears.json")
json.dump({"asOf": dt.date.today().isoformat(), "source": "BYMA, listado 'CEDEARs Negociables en BYMA' (byma.pdf → pdftotext)", "count": len(out), "cedears": out, "alias": ALIAS, "local": LOCAL}, open(root, "w"), ensure_ascii=False, indent=1)
print(len(out), "CEDEARs")

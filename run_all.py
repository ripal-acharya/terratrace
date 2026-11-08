"""One command: raw Apetit package -> app/data/*.json + submissions/*.csv

    python3 run_all.py
"""
import json
import math
import sys
import time
import warnings
from datetime import datetime, timezone

warnings.filterwarnings("ignore")
from pipeline import config as C, audit, climate_risk, nature, transport, actions, pathways, inventory  # noqa: E402


def clean(o):
    """Make JSON strict: NaN/inf -> null, numpy -> python."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if hasattr(o, "item") and not isinstance(o, (str, bytes)):
        o = o.item()
    if isinstance(o, float) and (math.isnan(o) or math.isinf(o)):
        return None
    return o


def write(name, obj):
    p = C.OUT_APP / name
    p.write_text(json.dumps(clean(obj), ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")
    print(f"  wrote {p.relative_to(C.ROOT)} ({p.stat().st_size // 1024} KB)")


def main():
    C.check_data_root()
    C.OUT_APP.mkdir(parents=True, exist_ok=True)
    C.OUT_SUB.mkdir(parents=True, exist_ok=True)
    audit.reset()
    t0 = time.time()
    print("TerraTrace pipeline")
    print("  data:", C.DATA_ROOT)
    cl = climate_risk.run(); print("  climate risk done")
    na = nature.run(); print("  nature done")
    tr = transport.run(); print("  transport done")
    ac = actions.run(cl, na, tr); print("  actions done")
    iv = inventory.run(); print("  inventory 2025 done (A2 + A1)")
    pw = pathways.run(iv); print("  pathways done")
    write("climate.json", cl)
    write("nature.json", na)
    write("transport.json", tr)
    write("actions.json", ac)
    write("pathways.json", pw)
    write("inventory.json", iv)
    write("corrections.json", {"fields": audit.FIELDS, "entries": audit.entries()})
    write("meta.json", {"generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                        "data_package": C.DATA_ROOT.name, "note": C.SYNTHETIC_NOTE})
    print(f"  submissions in {C.OUT_SUB.relative_to(C.ROOT)}/ ; {len(audit.entries())} corrections logged")
    print(f"done in {time.time() - t0:.1f} s")


if __name__ == "__main__":
    sys.exit(main())

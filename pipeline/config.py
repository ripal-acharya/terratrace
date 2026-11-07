"""Paths and constants. Every constant cites the package document it comes from."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(os.environ.get(
    "APETIT_DATA",
    ROOT.parent / "Apetit_SinceAI2026" / "APETIT_CLIMATE_NATURE_NAVIGATOR_2026",
)).resolve()
D = DATA_ROOT / "data"
OUT_APP = ROOT / "app" / "data"          # JSON read by the web app
OUT_SUB = ROOT / "submissions"           # CSVs for the auto-scored tasks

# Crops and regions in the C1/C2 templates (tasks/templates)
APETIT_CROPS = ["pea", "potato", "carrot", "spinach", "turnip_rape"]

# docs/TASKS_AND_SCORING.md (C2): bad year = below 80 % of the 1991-2020 mean
BAD_YEAR_FRACTION = 0.80
BASE_PERIOD = (1991, 2020)
FUTURE_PERIOD = (2041, 2060)
SCENARIOS = ["ssp126", "ssp245", "ssp585"]

# docs/NATURE_SBTN.md (D1)
STATE_WEIGHT = {"good": 1.0, "moderate": 1.2, "poor": 1.5, "bad": 1.8}

# docs/METHODOLOGY.md section 4: inbound legs -> category 4, outbound -> category 9
TRANSPORT_CATEGORY = {"inbound": "Scope 3 category 4 (upstream transport)",
                      "outbound": "Scope 3 category 9 (downstream transport)"}

SYNTHETIC_NOTE = "Synthetic data - not Apetit's real emissions or real farms."


def check_data_root():
    if not (D / "01_master" / "farm_registry.csv").exists():
        raise SystemExit(
            f"Apetit data package not found at: {DATA_ROOT}\n"
            "Set APETIT_DATA to the unzipped APETIT_CLIMATE_NATURE_NAVIGATOR_2026 folder.")

# TerraTrace – one-page method note
Team FarmSense · Since AI Hackathon 2026 · Apetit "Climate & Nature Navigator"

## What it does
TerraTrace turns the Apetit data package into traceable decisions. It shows where climate and nature put the supply at risk, what that costs in euros and tonnes, and five actions for next week, each with an owner. Nothing is final until a named expert approves it.

## Data sources
- Apetit synthetic package only (no other data): `03_farming` (farm survey FI, Foodhills SE), `04_climate` (weather 1991–2060, SSP1-2.6 / 2-4.5 / 5-8.5), `05_scenarios` (contract prices, replacement premiums, decarbonisation levers), `06_nature` (catchments, monitored loads), `02_raw_feeds/shipments.csv`, `frozen_warehousing.csv`, `01_master/emission_factor_library.csv`.
- Standards: GHG Protocol Scope 3 (categories 4 and 9), SBTN step 2 (interpret and prioritise), task rules in `TASKS_AND_SCORING.md`.

## Method (per task)
- **A1 data quality:** rules find import lots with only a road leg (origin not FI/NO) and add the usual sea leg for that material. Found 8 of 8 on the 2023–2024 dev labels. Every fix is logged with rule, evidence and old/new value.
- **C1 / C2 yields:** ridge regression on growing-season weather per crop and region, plus a shrunken farm effect. The penalty (λ) is chosen per crop by a rolling back-test. The model beats the farm-average baseline for every crop (e.g. FI pea 9.3 % vs 15.4 % error).
- **C3 € risk:** expected shortfall in bad years × contract price × replacement premium. Adaptation: irrigation on potato and carrot.
- **D1 nature (SBTN):** priority = (P / median P + 0.5 · N / median N) × state-of-nature weight × P sensitivity. Loads use an export-coefficient model with distance decay (600 m), calibrated on the 6 dev catchments. Dev score 64.0 vs package baseline 12.0.
- **Transport (cat 4 + 9):** tonne-km × well-to-wheel factor, plus frozen warehousing. Our 2023 and 2024 totals match the dev inventory exactly.
- **Copilot:** Google Gemini answers only from TerraTrace results and names its source (file and row). It can read, never change, data.

## Assumptions
- Synthetic data is treated as real records; prices and premiums from the package.
- Climate figures compare 2041–2060 with 1991–2020; bad year = yield below 80 % of normal.
- Lever costs and savings (e.g. HVO100 up to −5,982 t, ≈ €650,000/yr) are design estimates from `decarbonisation_levers.csv` (upper bound).
- Moving from spend-based to supplier data (lever L27) is a measurement change, **not** a reduction.

## Limitations
- No full 2025 inventory (A2), no SBTi pathway (B1) and no import screening (D2) yet.
- Region level only (Finland SW, Sweden Skåne); no per-farm shortage list in the UI.
- Runs locally (127.0.0.1); not yet hosted. Next step: Azure in the EU, connected to Apetit's real data.

## How expert review works
1. The pipeline (`run_all.py`) proposes every number and correction as a **draft**.
2. Each number has a **Source** button: formula, files, records and assumptions.
3. Only a **reviewer** can approve, or reject with a written reason. A decision is final and is checked on the server.
4. Every decision goes into an **append-only, SHA-256 hash-chained audit log** (who, what, when, why). Tampering is detected.
5. Only **approved** results can be exported (CSV).

## Security and privacy
Invite-only login (PBKDF2 passwords, HttpOnly session cookie), roles checked on the server (viewer, reviewer, farm advisor, admin), farm-level data need-to-know only, data served only through the API, strict CSP, rate limits, no API keys in the code.

## Reproduce
`python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`
`python3 run_all.py` → results and the 4 CSVs in `submissions/` · `python3 manage_users.py demo` · `python3 server.py`

# TerraTrace – Climate & Nature Navigator for Apetit

**Since AI Hackathon 2026 · Apetit challenge "Climate & Nature Navigator" · by Team FarmSense**

TerraTrace turns Apetit's fragmented climate, farming, nature and transport data into decisions:
what climate change will cost in euros, where nutrients hurt waters most, how much transport emits,
and who should do what next week. Every number shows its source, and nothing is published until a
person approves it.

> Synthetic data – not Apetit's real emissions or real farms.

## What it does

| Screen | Challenge task | What you see |
|---|---|---|
| **Dashboard** | all | Climate risk in €/yr, largest yield loss, transport CO₂e, top nature priority, and a **next-week action list with owners** |
| **Climate Risk** | C1, C2, C3 | Yield forecast 2027–2031, yield change and bad-year probability 2041–2060 under SSP1-2.6 / 2-4.5 / 5-8.5, € risk and value of irrigation, back-test |
| **Nature Map** | D1 (SBTN) | Phosphorus and nitrogen from contract parcels to water in 2025, catchment priority map and ranking |
| **Transport CO₂** | A (cat 4 and 9) | tCO₂e by mode and year, automatic detection and correction of missing sea legs |
| **AI Copilot** | E | Questions in plain English; answers name their evidence (file and row) |
| **Review & Audit Log** | traceability | Approve / reject every result and every data correction; append-only audit log; export of approved results only |

## Run it (3 commands)

Requirements: Python 3.9+ with pandas and numpy. No Node.js, no build step, no internet needed
(except for free-text AI questions).

```bash
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python3 run_all.py          # raw Apetit package -> app/data/*.json + submissions/*.csv (about 2 s)
python3 server.py           # open http://127.0.0.1:8000
```

The pipeline looks for the unzipped package next to this folder
(`../Apetit_SinceAI2026/APETIT_CLIMATE_NATURE_NAVIGATOR_2026`). Another location:
`APETIT_DATA=/path/to/APETIT_CLIMATE_NATURE_NAVIGATOR_2026 python3 run_all.py`

Tests (formulas, submission formats, data checks, security checks):

```bash
python3 -m unittest discover -s tests -v
```

### Optional: free-text AI in the Copilot

Copy `.env.example` to `.env` and add a Featherless API key (`FEATHERLESS_API_KEY=...`).
Without a key the app still runs and the suggested questions are answered directly from the results.

## Submissions for the auto-scored tasks

`python3 run_all.py` writes, in the template formats from `tasks/templates/`:

* `submissions/C1_yields_2027_2031_submission.csv`
* `submissions/C2_climate_yield_risk_submission.csv`
* `submissions/D1_catchment_priority_submission.csv`
* `submissions/A1_issues_submission.csv` (shipment `missing_leg` issues only)

## Evidence that it works

* **Transport:** our 2023 and 2024 category 4 and category 9 totals match Apetit's public dev
  inventory (2024: 4,380.8 vs 4,380.76 t and 4,771.3 vs 4,771.26 t).
* **Data quality:** 8 of 8 missing sea legs in the 2023–2024 dev labels found, 0 false alarms.
* **Yields:** trained on 2012–2022 and tested on 2023–2026, the model beats the farm-average
  baseline for every crop (for example Finnish pea 9.3 % vs 15.4 % production error, turnip rape 3.0 % vs 12.6 %).
* **Nature:** D1 dev score 64 vs the package baseline 12 (calibrated on the six dev catchments).

## How each number is made

| Result | Method | Source |
|---|---|---|
| Yields (C1, C2) | Ridge regression on log yield per region × crop: May–August temperature, rain, PET, water balance, hot days, irrigation × drought, trend, plus a shrunken farm effect | `farm_survey_fi.csv`, `foodhills_odlingsdata_se.csv`, `weather_monthly_1991_2060.csv` |
| C2 | 2041–2060 mean vs 1991–2020 mean; bad year = below 80 % of the 1991–2020 mean | TASKS_AND_SCORING.md |
| € risk (C3) | expected shortfall (t/yr) × contract price × replacement import premium | SCENARIOS_AND_RISK.md, `contract_prices_and_replacement_premiums.csv` |
| Nature (D1) | priority = (P / median(P) + 0.5 × N / median(N)) × state_weight × p_sensitivity | NATURE_SBTN.md |
| Transport | tkm × WTW factor; inbound = cat 4, outbound = cat 9 (+ frozen warehousing pallet-days) | METHODOLOGY.md §4, `emission_factor_library.csv` |
| Actions | linked to model results and to levers L10, L15, L20, L24; lever values are design estimates | `decarbonisation_levers.csv` |

Measurement improvements are not reductions: lever L27 is shown as "not a reduction".

## Expert review and audit trail

1. The pipeline proposes results and data corrections (status **Draft**). Each correction is logged
   with the fields from `docs/AZURE_FABRIC_QUICKSTART.md`: record_key, field, old_value, new_value,
   rule_or_model, evidence, proposed_by, approved_by, timestamp.
2. A reviewer types their name and approves or rejects (a reason is required to reject).
3. Every decision is appended to the audit log. Only approved results can be exported.

## Security

* Server binds to `127.0.0.1` only and serves files only from `app/` (no directory listing).
* Strict Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`.
* The page never inserts HTML from data or AI answers (text only), so no script injection.
* Copilot API: 8 KB request limit, 1,000-character questions, 10 questions per minute per client,
  origin check, 20 s first-token timeout with one automatic retry, 60 s total, 800-token answers.
* The AI only reads results; it cannot change data. The API key stays in `.env` on the server
  (in `.gitignore`), never in the browser or the repository.
* CSV export escapes spreadsheet formulas.

## Path to Apetit's Microsoft stack

| Layer | Hackathon | Production at Apetit |
|---|---|---|
| Storage | CSV / JSON files | Fabric Lakehouse: raw feeds = bronze, cleaned tables = silver, results = gold |
| Pipelines | `run_all.py` | Fabric notebooks / Data Factory |
| Copilot | Featherless (OpenAI-compatible) | Azure AI Foundry Agent Service + Azure AI Search over framework documents |
| Review & approval | Web app + browser storage | Power Apps approval flow; audit log as a Delta table |
| Sign-in and secrets | none (local demo) | Microsoft Entra ID roles (viewer, reviewer, admin); Azure Key Vault |
| Hosting | local Python server | Azure App Service; a tab in Microsoft Teams |

## Limitations

* Synthetic data; one weather realisation per SSP; no CO₂ fertilisation and no new varieties.
* Earlier sowing and tolerant varieties are not modelled; irrigation is.
* The nature model is a simple export-coefficient model calibrated on six catchments.
* Review decisions are stored in the browser in this demo (see production path above).
* Not covered yet: full GHG inventory (A2) and SBTi pathways (B). These are the next steps.

## Project structure

```
run_all.py          one command: data -> results
server.py           web server + Copilot API (standard library only)
pipeline/           climate_risk.py, nature.py, transport.py, actions.py, audit.py, config.py
app/                index.html, app.js, styles.css, data/*.json
submissions/        CSVs for the auto-scored tasks
tests/              unit tests
```

Data: Apetit × Since AI synthetic package v1.0.0 (CC BY 4.0). Code: MIT.

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
python3 manage_users.py demo   # once: creates demo users and prints their passwords one time
python3 server.py           # open http://127.0.0.1:8000 and sign in
```

The pipeline looks for the unzipped package next to this folder
(`../Apetit_SinceAI2026/APETIT_CLIMATE_NATURE_NAVIGATOR_2026`). Another location:
`APETIT_DATA=/path/to/APETIT_CLIMATE_NATURE_NAVIGATOR_2026 python3 run_all.py`

Tests (formulas, submission formats, data checks, security checks):

```bash
python3 -m unittest discover -s tests -v
```

### Optional: free-text AI in the Copilot (Google Gemini)

The Copilot works with any OpenAI-compatible API. In the demo we use **Google Gemini**.
Copy `.env.example` to `.env` and set:

```
FEATHERLESS_API_KEY=<your Gemini API key from aistudio.google.com>
FEATHERLESS_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
FEATHERLESS_MODEL=gemini-3.6-flash
FEATHERLESS_FALLBACK_MODEL=gemini-3.5-flash-lite
```

If the main model is busy, the server tries the backup model once. Without a key the app still
runs and the suggested questions are answered directly from the results.

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

* **Sign-in, invite-only.** No public sign-up. Accounts are created with `manage_users.py`. Passwords are
  stored only as salted PBKDF2-SHA256 hashes (240,000 iterations) in `instance/` (git-ignored).
* **Sessions.** Random 256-bit token in an HttpOnly, SameSite=Strict cookie; 8-hour expiry; logout ends it.
* **Brute-force protection.** 10 login attempts per minute per client; 10 failures lock an account for 5 minutes.
  Unknown emails take the same time as known ones (no user enumeration).
* **Roles, checked on the server for every request (need to know).**
  viewer = totals only; reviewer = approve/reject + corrections (farm records by code); farm_advisor = farm-level
  records by code; admin = user list, no farm-level records by default.
* **Data is never served as static files.** Results are only returned by the API to signed-in users, filtered by role.
* **Tamper-evident audit log.** Every decision is appended to `instance/audit_log.jsonl` with a SHA-256 hash
  chain; the app shows whether the chain is intact. Nobody can edit or delete entries through the app.
* **CSRF protection.** State-changing requests need a same-origin request and the header `X-TerraTrace: 1`.
* **Browser hardening.** Strict Content-Security-Policy (no inline scripts), X-Frame-Options DENY, nosniff,
  no-referrer, Permissions-Policy. All text is inserted as text (never HTML), so data and AI answers cannot run code.
* **Copilot.** Login required; 1,000 characters; 10 questions per minute per user; 8 KB request limit; the API
  key stays in `.env` on the server; only a short summary of results is sent, never farm-level rows.
* **CSV export** (reviewers and admins) contains approved results only and escapes spreadsheet formulas.
* The server binds to `127.0.0.1` only. Tests: `python3 -m unittest discover -s tests -v` (19 tests).

## Using real Apetit data (privacy by design)

The hackathon uses synthetic data, so its results are public in this repository. With real data the
same code runs, but these rules apply:

* **Never commit real data or results.** Add `app/data/` and `submissions/` to `.gitignore` in the
  company copy; run the pipeline inside Apetit's own environment (Fabric / Azure).
* **Results are private.** The web app reads results from private storage that only signed-in users
  can access (no public URLs).
* **Sign-in and roles.** Microsoft Entra ID single sign-on; roles viewer, reviewer, admin. Only
  reviewers approve; only admins upload new results. The audit log is append-only.
* **AI in Apetit's own tenant.** Free public AI APIs may use prompts to improve their products, so
  real data goes only to an enterprise AI service in the EU with no training on customer data
  (Azure OpenAI / Azure AI Foundry under Apetit's agreement). Only short result summaries are sent,
  never raw files.
* **Farmer data is personal data (GDPR).** Use pseudonymous farm IDs in the app, show no names or
  exact home locations, keep only what is needed, set retention periods, and sign data processing
  agreements with every vendor. Hosting and backups in the EU.
* **Secrets** in Azure Key Vault; access and changes logged.

## Path to Apetit's Microsoft stack

| Layer | Hackathon | Production at Apetit |
|---|---|---|
| Storage | CSV / JSON files | Fabric Lakehouse: raw feeds = bronze, cleaned tables = silver, results = gold |
| Pipelines | `run_all.py` | Fabric notebooks / Data Factory |
| Copilot | Google Gemini via OpenAI-compatible API | Azure AI Foundry Agent Service + Azure AI Search over framework documents |
| Review & approval | Web app + server-side, hash-chained audit log | Power Apps approval flow; audit log as a Delta table |
| Sign-in and secrets | Invite-only email + password, server-side roles | Microsoft Entra ID roles (viewer, reviewer, admin); Azure Key Vault |
| Hosting | local Python server | Azure App Service; a tab in Microsoft Teams |

## Limitations

* Synthetic data; one weather realisation per SSP; no CO₂ fertilisation and no new varieties.
* Earlier sowing and tolerant varieties are not modelled; irrigation is.
* The nature model is a simple export-coefficient model calibrated on six catchments.
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

## Trust layer: signed results + MCP server for AI agents

**Signed results (Ed25519).** After review, a reviewer clicks *Sign approved results* (Review page) or runs
`python3 signing.py sign`. This writes `submissions/terratrace_release.json`: the SHA-256 hash of every result
file, every approval from the audit log, and the audit-log head, signed with an Ed25519 key. Anyone can check it:

    python3 signing.py verify     # OK, or names every file changed after signing

The private key stays in `instance/` (git-ignored). The public key is `submissions/terratrace_signing_public.pem`.

**MCP server.** `mcp_server.py` exposes TerraTrace to AI agents through the Model Context Protocol
(e.g. Microsoft Copilot Studio, Claude Desktop). Tools: `list_next_week_actions`, `get_climate_risk`,
`get_nature_priorities`, `get_transport_emissions`, `verify_signed_release`.
* all tools are read-only (no approve, no write);
* only human-approved results are returned by default; every result carries its review status and sources;
* no farm-level data is exposed;
* every call is written to a hash-chained access log (`instance/mcp_access_log.jsonl`).

Claude Desktop (Settings → Developer → Edit config):

    {"mcpServers": {"terratrace": {"command": "/full/path/to/python3", "args": ["/full/path/to/terratrace/mcp_server.py"]}}}

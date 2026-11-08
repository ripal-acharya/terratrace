# TerraTrace – Method note

Team FarmSense · Since AI Hackathon 2026 · Apetit challenge "Climate & Nature Navigator"

## In short

TerraTrace helps Apetit see where climate change and nature put its supply at risk, what that risk costs in euros and tonnes, and what to do next week. It also calculates the 2025 greenhouse gas inventory automatically from the raw data, instead of by hand in Excel. Every number in the app shows where it came from. Nothing is final until a named expert approves it.

## The data we used

We used only the synthetic data package that Apetit and Since AI gave us (version 1.0.0). We did not add any outside data. The files we used are:

- **Raw feeds:** all files in `02_raw_feeds` (ERP purchases, energy meters, fuel deliveries, refrigerants, GoO log and registry, waste, travel, commuting, shipments, warehousing, sales, supplier PCFs).
- **Master data:** sites, materials, suppliers, parcels (with the soil map) and the emission factor library from `01_master`.
- **Farming:** `farm_survey_fi.csv` (Finland), `foodhills_odlingsdata_se.csv` (Sweden) and the parcel crop plans.
- **Climate:** `weather_monthly_1991_2060.csv` with three scenarios: SSP1-2.6, SSP2-4.5 and SSP5-8.5.
- **Prices, levers and scenarios:** contract prices, replacement premiums, decarbonisation levers, transition scenarios, structural events and the published inventory history from `05_scenarios`.
- **Nature:** catchments, catchment map, monitored loads and the origin state-of-nature table from `06_nature`.
- **Checking:** the public 2023–2024 answers in `tasks/dev`, used only to test our rules.

We followed the standards named in the package: the GHG Protocol (Corporate, Scope 2 and Scope 3 Standards, IPCC AR6 GWP100), SBTi near-term criteria, SBTN steps 1 and 2, and the task rules in `TASKS_AND_SCORING.md`.

## How we made each result

| Task | What we did | How we checked it |
|---|---|---|
| **A2 – 2025 inventory** | Raw feeds → cleaning rules → clean tables → the package's reference calculator (`tools/ccn_tools`, METHODOLOGY.md). Cleaning fixes unit errors, duplicates, decimal shifts, currency errors, wrong materials, wrong gas codes, missing meter months, invalid supplier PCFs and missing sea legs. GoO comes from the national registry. Organic soil comes from the soil map: a farm-crop counts as organic soil when at least 30 % of its area is organic. | The same rules on 2023 and 2024 score 91.4 and 90.1 of 100 against the public answers. The package baseline without cleaning scores 25.5 and 23.2. 2025 result: scope 1 4,414 t, scope 2 market 61 t (location 963 t), scope 3 225,135 t. |
| **A1 – Data quality** | The same rules write every correction to a log. 107 issues in 2025 across 11 tables, each with the record, field, old and new value and the rule. | On the 2023–2024 labels: precision 96 %, recall 82 %, score 88.0 (package baseline 52.2). All 8 missing sea legs found. |
| **C1 / C2 – Crop yields** | One ridge regression per crop and region, using growing-season weather (May–August temperature, rain, water balance, hot days), irrigation and a trend, plus a small farm effect. The model strength is chosen per crop with a rolling back-test. C2 compares 2041–2060 with 1991–2020. A "bad year" is a year below 80 % of the 1991–2020 average. | Trained on 2012–2022 and tested on 2023–2026. The model beats the farm-average baseline for all 6 crop–region pairs, for example Finnish pea 9.3 % error vs 15.4 %. |
| **C3 – Risk in euros** | Expected shortfall in tonnes per year × contract price × replacement import premium. We also show how much irrigation reduces the risk, where the history has enough irrigated fields. | Formula and inputs are shown behind the Source button. |
| **D1 – Nature (SBTN)** | Priority = (P ÷ median P + 0.5 × N ÷ median N) × state-of-water weight × P sensitivity. Nutrient loads come from an export-coefficient model with distance-to-water decay (600 m), calibrated on the 6 dev catchments. | Dev score 64.0, compared with 12.0 for the package baseline. |
| **Transport – Scope 3 cat 4 and 9** | Tonne-km × well-to-wheel emission factor. Inbound = category 4, outbound = category 9. Category 9 also includes frozen warehousing (pallet-days × factor). | Our 2023 and 2024 totals match Apetit's dev inventory to within 0.1 t (for example 2024 category 4: 4,380.8 vs 4,380.76 t). |
| **B1 – SBTi targets and pathway** | Base year: we show both options the brief asks for. Option A is 2019, with the grain trade removed (7.3–8.8 % of scope 3, taken from Apetit's own restatements). Option B is our own 2025 inventory (recommended). We split scope 3 into FLAG and non-FLAG with the `flag_share` of each emission factor (FLAG = 75.8 % of category 1). Targets are linear to 2030: scope 1+2 −4.2 %/yr, scope 3 non-FLAG −2.5 %/yr, FLAG −3.03 %/yr. The pathway removes the levers year by year under two NGFS scenarios: orderly (below 2 °C) and delayed transition. | In the orderly scenario, scope 1+2 and FLAG reach the 2030 target, and scope 3 non-FLAG is about 30 t short. In the delayed scenario, scope 3 non-FLAG and FLAG miss it by about 5,800 t and 11,700 t. |
| **B2 – Abatement cost curve** | All 30 levers from the package. Cost per tonne = (capex spread over the lever lifetime at 6 % + yearly opex change) ÷ abatement. Each lever has an uncertainty band based on its confidence. Structural changes (L05, L26) and the measurement change (L27) are shown, but not counted as reductions. L07 (Bjuv) is left out until the base year is recalculated for Foodhills. | 13 levers (37,540 t) cost less than the orderly 2030 carbon price of €120/t. |
| **D2 – Value-chain nature screening** | 2025 purchases by material and origin, joined with the package's state-of-nature table (water stress, deforestation, biodiversity, nutrients) and SBTN high-impact commodities. Each row gets a simple, open score and a priority. | Soy protein isolate from China is the top priority (high deforestation risk, SBTN high-impact commodity). Tomato sauce from Spain, broccoli from Ecuador and peppers from Portugal follow (water stress or very high biodiversity sensitivity). |
| **Next-week actions** | Five actions, each linked to a model result and a lever, with euros, tonnes and an owner. | Each action lists its sources. |
| **E – AI Copilot** | Google Gemini answers questions in plain English using only TerraTrace results, and ends with an "Evidence" line. It can read data but never change it. Common questions are answered directly from the results, without AI. | If the AI does not name its evidence, the server adds a note asking the user to check the Source buttons. |

## Assumptions

- We treat the synthetic records as if they were real. Prices and premiums come from the package.
- Each climate scenario has one weather series. We do not model CO₂ fertilisation, new crop varieties or earlier sowing. We do model irrigation.
- A missing meter month is filled with the same month of other years, scaled to the year's level. A meter spike is replaced the same way.
- Lever costs and savings are the package's design estimates, as the package says. We use them as given and show an uncertainty band (high ±25 %, medium ±50 %, low ±75 %). For example, moving all road legs to HVO100 could save up to 5,982 t CO₂e (our upper bound for 2025), at an extra cost of about €650,000 per year (lever L20).
- Moving from spend-based to supplier-specific data (lever L27) changes the number, not the emissions. We show it as a measurement improvement, **not** a reduction.
- Foodhills: its own operations are in the 2025 inventory from December 2025. Its pea growers enter scope 3 in 2026 (about 4,500 t, 2.0 % of scope 3).

## What is not covered yet

- The E answers file. The Copilot answers many of the questions, but we did not fill in the file.
- A1 does not yet cover `area_mismatch`, `coordinate_swap`, `total_mismatch` or `mode_mislabel`.
- Scope 2 market-based in 2023 is our one weak line: it depends on one missing meter month at Säkylä.
- The pathway holds volumes at the base-year level. It does not yet put numbers on Pudasjärvi or the Kantvik steam sale.
- Results are at region level (South-West Finland and Skåne, Sweden). There is no per-farm shortage list in the app.
- The app runs on a local computer. It is not hosted online yet.

## How expert review works

1. The pipeline (`run_all.py`) creates every number and every data correction as a **draft**.
2. Every number has a **Source** button that shows the formula, the files, the records and the assumptions.
3. Only a **reviewer** can approve a result, or reject it with a written reason. The decision is final, and the server checks it.
4. Every decision is added to an **audit log** (who, what, when and why). Each entry is linked to the one before it with a SHA-256 hash, so any change to old entries is detected.
5. Only **approved** results can be exported.

## Two features we added ourselves

Apetit asked for results that are traceable and reviewed by experts. We went one step further with two extra features:

1. **Signed results.** After review, a reviewer clicks *Sign approved results*. TerraTrace then signs the hash of every result file, every approval and the latest audit-log entry with an Ed25519 digital signature. Anyone can check it later with `python3 signing.py verify`. If even one number changes after signing, the check fails and names the changed file.
2. **A read-only connection for AI agents (MCP server).** `mcp_server.py` lets AI assistants, such as Microsoft Copilot Studio or Claude Desktop, read TerraTrace results through the Model Context Protocol. Agents can only read, never approve or change. By default they see only expert-approved results, never farm-level data, and every request is logged.

## Security and privacy

- Invite-only login. Passwords are stored only as salted PBKDF2 hashes.
- Four roles (viewer, reviewer, farm advisor, admin), checked by the server on every request.
- Farm-level data is shown only to people who need it, and only by farm code. Viewers see totals, not record-level corrections.
- Data is served only through the API to signed-in users, with limits on login attempts and Copilot questions.
- The AI key stays on the server. Only short result summaries are sent to the AI, never raw files or farm rows.
- With real data, the same code would run in Apetit's own Microsoft environment in the EU, with Entra ID sign-in and an enterprise AI service.

## How to run it

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 run_all.py            # creates the results and the 6 CSV files in submissions/
python3 manage_users.py demo  # creates demo users and shows their passwords once
python3 server.py             # open http://127.0.0.1:8000
```

Tests: `python3 -m unittest discover -s tests` (32 tests).

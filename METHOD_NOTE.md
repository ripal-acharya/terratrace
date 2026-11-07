# TerraTrace – Method note

Team FarmSense · Since AI Hackathon 2026 · Apetit challenge "Climate & Nature Navigator"

## In short

TerraTrace helps Apetit see where climate change and nature put its supply at risk, what that risk costs in euros and tonnes, and what to do next week. Every number in the app shows where it came from. Nothing is final until a named expert approves it.

## The data we used

We used only the synthetic data package that Apetit and Since AI gave us (version 1.0.0). We did not add any outside data. The files we used are:

- **Farming:** `farm_survey_fi.csv` (Finland) and `foodhills_odlingsdata_se.csv` (Sweden), plus parcel and crop plans.
- **Climate:** `weather_monthly_1991_2060.csv` with three scenarios: SSP1-2.6, SSP2-4.5 and SSP5-8.5.
- **Prices, levers and scenarios:** contract prices, replacement premiums, decarbonisation levers, transition scenarios, structural events and the published inventory history from `05_scenarios`.
- **Inventory:** the 2023 and 2024 inventories in `tasks/dev` (used as the starting point for the pathway).
- **Nature:** catchments, catchment map, monitored loads and the origin state-of-nature table from `06_nature`.
- **Transport:** `shipments.csv`, `erp_purchase_lines_2021_2025.csv`, `frozen_warehousing.csv` and `emission_factor_library.csv`.

We followed the standards named in the package: the GHG Protocol for Scope 3 categories 4 and 9, SBTN step 2 for nature, and the task rules in `TASKS_AND_SCORING.md`.

## How we made each result

| Task | What we did | How we checked it |
|---|---|---|
| **A1 – Data quality** | Every import lot should have a road leg and a sea leg. If an import lot (origin not Finland or Norway) has only a road leg, we flag it and add the usual sea leg for that origin. Every fix is logged with the rule, the evidence and the old and new value. | Found 8 of 8 missing sea legs in the 2023–2024 dev labels, with no false alarms. |
| **C1 / C2 – Crop yields** | One ridge regression per crop and region, using growing-season weather (May–August temperature, rain, water balance, hot days), irrigation and a trend, plus a small farm effect. The model strength is chosen per crop with a rolling back-test. C2 compares 2041–2060 with 1991–2020. A "bad year" is a year below 80 % of the 1991–2020 average. | Trained on 2012–2022 and tested on 2023–2026. The model beats the farm-average baseline for all 6 crop–region pairs, for example Finnish pea 9.3 % error vs 15.4 %. |
| **C3 – Risk in euros** | Expected shortfall in tonnes per year × contract price × replacement import premium. We also show how much irrigation reduces the risk, where the history has enough irrigated fields. | Formula and inputs are shown behind the Source button. |
| **D1 – Nature (SBTN)** | Priority = (P ÷ median P + 0.5 × N ÷ median N) × state-of-water weight × P sensitivity. Nutrient loads come from an export-coefficient model with distance-to-water decay (600 m), calibrated on the 6 dev catchments. | Dev score 64.0, compared with 12.0 for the package baseline. |
| **Transport – Scope 3 cat 4 and 9** | Tonne-km × well-to-wheel emission factor. Inbound = category 4, outbound = category 9. Category 9 also includes frozen warehousing (pallet-days × factor). | Our 2023 and 2024 totals match Apetit's dev inventory to within 0.1 t (for example 2024 category 4: 4,380.8 vs 4,380.76 t). |
| **B1 – SBTi targets and pathway** | Base year: we show both options the brief asks for. Option A is 2019, with the grain trade removed (7.3–8.8 % of scope 3, taken from Apetit's own restatements). Option B is the latest complete inventory in the package (2024), which we recommend. We split scope 3 into FLAG and non-FLAG with the `flag_share` of each emission factor (FLAG = 75.6 % of category 1). Targets are linear to 2030: scope 1+2 −4.2 %/yr, scope 3 non-FLAG −2.5 %/yr, FLAG −3.03 %/yr. The pathway removes the levers year by year under two NGFS scenarios: orderly (below 2 °C) and delayed transition. | In the orderly scenario, scope 1+2 and FLAG reach the 2030 target. Scope 3 non-FLAG misses it by about 300 t. In the delayed scenario, scope 3 non-FLAG and FLAG miss it by about 6,000 t and 11,900 t. |
| **B2 – Abatement cost curve** | All 30 levers from the package. Cost per tonne = (capex spread over the lever lifetime at 6 % + yearly opex change) ÷ abatement. Each lever has an uncertainty band based on its confidence. Structural changes (L05, L26) and the measurement change (L27) are shown, but not counted as reductions. L07 (Bjuv) is left out of the pathway, because Bjuv is not in the 2024 base. | 14 levers (38,840 t) cost less than the orderly 2030 carbon price of €120/t. |
| **D2 – Value-chain nature screening** | 2025 purchases by material and origin, joined with the package's state-of-nature table (water stress, deforestation, biodiversity, nutrients) and SBTN high-impact commodities. Each row gets a simple, open score and a priority. | Soy protein isolate from China is the top priority (high deforestation risk, SBTN high-impact commodity). Tomato sauce and peppers from Spain and Portugal follow (extreme water stress). |
| **Next-week actions** | Five actions, each linked to a model result and a lever, with euros, tonnes and an owner. | Each action lists its sources. |
| **E – AI Copilot** | Google Gemini answers questions in plain English using only TerraTrace results, and ends with an "Evidence" line. It can read data but never change it. Common questions are answered directly from the results, without AI. | If the AI does not name its evidence, the server adds a note asking the user to check the Source buttons. |

## Assumptions

- We treat the synthetic records as if they were real. Prices and premiums come from the package.
- Each climate scenario has one weather series. We do not model CO₂ fertilisation, new crop varieties or earlier sowing. We do model irrigation.
- Lever costs and savings are the package's design estimates, as the package says. We use them as given and show an uncertainty band (high ±25 %, medium ±50 %, low ±75 %). For example, moving all road legs to HVO100 could save up to 5,982 t CO₂e (our upper bound for 2025), at an extra cost of about €650,000 per year (lever L20).
- Moving from spend-based to supplier-specific data (lever L27) changes the number, not the emissions. We show it as a measurement improvement, **not** a reduction.

## What is not covered yet

- Our own full 2025 GHG inventory (A2). The pathway (B1) therefore starts from the 2024 inventory in the package, and it will move to 2025 once A2 is done.
- The E answers file. The Copilot works, but most E questions need the 2025 inventory (A2).
- A1 covers one issue type (missing sea legs), not all 18.
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
- Farm-level data is shown only to people who need it, and only by farm code.
- Data is served only through the API to signed-in users, with limits on login attempts and Copilot questions.
- The AI key stays on the server. Only short result summaries are sent to the AI, never raw files or farm rows.
- With real data, the same code would run in Apetit's own Microsoft environment in the EU, with Entra ID sign-in and an enterprise AI service.

## How to run it

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 run_all.py            # creates the results and the 4 CSV files in submissions/
python3 manage_users.py demo  # creates demo users and shows their passwords once
python3 server.py             # open http://127.0.0.1:8000
```

Tests: `python3 -m unittest discover -s tests` (27 tests).

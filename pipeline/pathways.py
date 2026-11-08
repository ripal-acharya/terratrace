"""Tracks B1, B2 and D2: SBTi targets and pathway, abatement cost curve, value-chain nature screening.

Rules: docs/TASKS_AND_SCORING.md (B1/B2), docs/SCENARIOS_AND_RISK.md (Track B), docs/NATURE_SBTN.md (step 1),
docs/METHODOLOGY.md sections 1, 4 and 5.

Honest scope:
* We did not build our own 2025 inventory (task A2). The pathway starts from the most recent complete
  inventory in the package: tasks/dev/A2_dev_inventory_2024.csv. It is labelled as such everywhere.
* Lever abatement values are the package's design estimates (value_status says so). We use them as given,
  with an uncertainty band by confidence, and say so.
"""
import math

import pandas as pd

from . import config as C

TARGET_YEAR = 2030
PATH_END = 2035
DISCOUNT_RATE = 0.06                 # our assumption for annualising capex
SBTI_RATE = {"s12": 0.042, "s3": 0.025, "flag": 0.0303}   # docs/TASKS_AND_SCORING.md B1/B2
BAND = {"high": 0.25, "medium": 0.5, "low": 0.75}            # our assumption: +/- share of design abatement
FX_EUR = {"EUR": 1.0, "USD": 0.92, "SEK": 0.087}              # only used for spend lines (FLAG share 0)
FARM_EF = {"M100": "EF-RAP-FI", "M110": "EF-VEG-PEA-FI", "M111": "EF-VEG-POT-FI", "M112": "EF-VEG-CAR-FI",
           "M113": "EF-VEG-SPI-FI", "M114": "EF-VEG-PEA-SE"}  # proxy factors for contract-farm materials

DEFOR = {"low": 0, "medium": 1, "high": 2}
BIO = {"low": 0, "medium": 1, "high": 2, "very high": 3}


def _num(x):
    try:
        v = float(x)
        return None if math.isnan(v) else v
    except (TypeError, ValueError):
        return None


def load_inventory(year):
    df = pd.read_csv(C.DATA_ROOT / "tasks" / "dev" / f"A2_dev_inventory_{year}.csv")
    get = lambda cat: float(df.loc[df.category == cat, "tco2e"].sum())
    return {"year": year, "scope1": get("scope1_total"), "scope2_market": get("scope2_market_total"),
            "scope2_location": get("scope2_location_total"), "scope3": get("scope3_total"),
            "cat01": get("cat01_purchased_goods_services"),
            "lines": df[df.scope.isin(["scope1", "scope2_location", "scope2_market", "scope3"])]
            [["scope", "category", "tco2e"]].to_dict("records")}


def inventory_from_summary(summary, year):
    """Our own inventory (pipeline/inventory.py, task A2) in the same shape as load_inventory."""
    df = pd.DataFrame(summary)
    get = lambda cat: float(df.loc[df.category == cat, "tco2e"].sum())
    return {"year": year, "scope1": get("scope1_total"), "scope2_market": get("scope2_market_total"),
            "scope2_location": get("scope2_location_total"), "scope3": get("scope3_total"),
            "cat01": get("cat01_purchased_goods_services"), "source": "TerraTrace A2 inventory (pipeline/inventory.py)",
            "lines": df[df.scope.isin(["scope1", "scope2_location", "scope2_market", "scope3"])][["scope", "category", "tco2e"]].to_dict("records")}


def purchases_with_factors(year):
    """ERP purchase lines of one year x library factor (incl. flag_share). Credit notes net against receipts."""
    erp = pd.read_csv(C.D / "02_raw_feeds" / "erp_purchase_lines_2021_2025.csv", parse_dates=["posting_date"])
    mat = pd.read_csv(C.D / "01_master" / "materials.csv")
    ef = pd.read_csv(C.D / "01_master" / "emission_factor_library.csv").set_index("ef_id")
    e = erp[erp.posting_date.dt.year == year].merge(mat[["material_id", "name_en", "material_group", "default_ef_id",
                                                         "eudr_commodity", "sbtn_high_impact_commodity"]], on="material_id")
    e["ef_id"] = [FARM_EF.get(m, d) for m, d in zip(e.material_id, e.default_ef_id)]
    # imported rapeseed: origin-specific factor where the library has one (METHODOLOGY.md section 4)
    rap = e.material_group.eq("oilseed")
    e.loc[rap, "ef_id"] = ["EF-RAP-" + o if ("EF-RAP-" + o) in ef.index else f for o, f in zip(e.loc[rap, "origin_country"], e.loc[rap, "ef_id"])]
    sign = e.movement_type.map({101: 1, 122: -1}).fillna(1)
    kg = e.quantity.where(e.uom.ne("TO"), e.quantity * 1000)
    eur = e.net_amount * e.currency.map(FX_EUR).fillna(1.0)
    e["activity"] = sign * kg.where(e.uom.ne("EUR"), eur)
    e["kg"] = sign * kg.where(e.uom.ne("EUR"), 0.0)
    e["factor"] = e.ef_id.map(ef.kgco2e_per_unit)
    e["flag_share"] = e.ef_id.map(ef.flag_share).fillna(0.0)
    e["tco2e"] = e.activity * e.factor / 1000
    e["flag_tco2e"] = e.tco2e * e.flag_share
    return e[e.factor.notna()]


def flag_split(inv, year):
    p = purchases_with_factors(year)
    est, flag = float(p.tco2e.sum()), float(p.flag_tco2e.sum())
    share = flag / est if est else 0.0
    flag_t = inv["cat01"] * share
    return {"year": year, "cat01_from_inventory": inv["cat01"], "cat01_quick_estimate": est,
            "flag_share_of_cat01": share, "flag_tco2e": flag_t, "scope3_non_flag_tco2e": inv["scope3"] - flag_t,
            "method": "FLAG share = sum(purchased qty x factor x flag_share) / sum(purchased qty x factor), from ERP "
                      f"{year} and emission_factor_library.csv flag_share; applied to category 1 of the {year} inventory. "
                      "Contract-farm materials use the crop factors as a proxy (METHODOLOGY.md section 5)."}


def foodhills_growers():
    """Swedish pea growers enter scope 3 FLAG in full from 2026 (METHODOLOGY.md section 1)."""
    f = pd.read_csv(C.D / "03_farming" / "foodhills_odlingsdata_se.csv", sep=";", decimal=",")
    years = sorted(int(y) for y in f["skördeår"].unique())
    last = 2025 if 2025 in years else years[-1]   # last harvest before the growers enter scope 3 in full (2026)
    t = float(f.loc[f["skördeår"] == last, "levererad_mängd_ton"].sum())
    ef = pd.read_csv(C.D / "01_master" / "emission_factor_library.csv").set_index("ef_id").loc["EF-VEG-PEA-SE"]
    return {"year": last, "delivered_t": t, "factor_kg_per_kg": float(ef.kgco2e_per_unit), "flag_share": float(ef.flag_share),
            "tco2e": t * float(ef.kgco2e_per_unit)}


def base_year(inv):
    hist = pd.read_csv(C.D / "05_scenarios" / "published_inventory_history.csv")
    h = hist.set_index("year")
    shares = [1 - h.loc[y, "scope3_restated"] / h.loc[y, "scope3"] for y in (2022, 2023) if _num(h.loc[y, "scope3_restated"])]
    s19 = float(h.loc[2019, "scope3"])
    fh = foodhills_growers()
    ev = pd.read_csv(C.D / "05_scenarios" / "structural_events.csv")
    ev = ev[ev.relevance.str.contains("recalculation|scope", case=False, na=False) & (ev.date >= "2021")]
    events = [{"date": r.date, "event": r.event, "relevance": r.relevance} for r in ev.itertuples()]
    return {
        "option_2019": {"published_scope1": float(h.loc[2019, "scope1"]), "published_scope2_market": float(h.loc[2019, "scope2_market"]),
                        "published_scope3": s19, "grain_trade_share_low": min(shares), "grain_trade_share_high": max(shares),
                        "scope3_recalculated_low": s19 * (1 - max(shares)), "scope3_recalculated_high": s19 * (1 - min(shares)),
                        "note": "Grain trade (divested 31.5.2022) must be removed from the 2019 base. Its size is taken from "
                                "Apetit's own restatements of 2022 and 2023 scope 3 (published_inventory_history.csv). "
                                "The 2019 activity data are not in the package, so this stays a range."},
        "option_recent": {"year": inv["year"], "scope1": inv["scope1"], "scope2_market": inv["scope2_market"], "scope3": inv["scope3"],
                          "note": f"Latest complete inventory ({inv['year']}, source: {inv.get('source', '')}). SBTi V2 prefers the latest "
                                  "year with comprehensive data. Add the Foodhills growers (in scope from 2026) to this base."},
        "foodhills": {**fh, "share_of_scope3": fh["tco2e"] / inv["scope3"], "threshold": 0.05,
                      "note": "Foodhills growers are in scope 3 FLAG from 2026. Add them to the base year. The acquisition "
                              "also adds Bjuv's own scope 1 and 2 (from December 2025), not estimated here."},
        "events": events,
        "rule": "Recalculate the base year when a structural change moves base-year emissions by more than 5 %.",
    }


def levers_table():
    lv = pd.read_csv(C.D / "05_scenarios" / "decarbonisation_levers.csv")
    rows = []
    for r in lv.itertuples():
        ab = float(r.abatement_tco2e_2030_design or 0)
        life = max(int(r.lifetime_yr or 1), 1)
        crf = DISCOUNT_RATE / (1 - (1 + DISCOUNT_RATE) ** -life)
        annual = float(r.capex_eur or 0) * crf + float(r.opex_delta_eur_per_yr or 0)
        kind = ("measurement" if r.lever_type == "data" else "structural" if r.lever_type == "structural"
                else "abatement")
        bucket = ("s12" if str(r.scope).startswith("scope1") and kind == "abatement"
                  else "flag" if str(r.flag) == "True" else "s3" if str(r.scope).startswith("scope3") else None)
        conf = str(r.confidence).strip().lower() if isinstance(r.confidence, str) else "medium"
        band = BAND.get(conf, 0.5)
        note = None
        if r.lever_id == "L07":
            note = "Bjuv (Foodhills) is not in the 2024 base; counts only after the base-year recalculation."
        rows.append({"lever_id": r.lever_id, "name": r.name, "scope": r.scope, "flag": str(r.flag) == "True", "type": r.lever_type,
                     "kind": kind, "bucket": bucket, "abatement_t": ab, "abatement_low": ab * (1 - band), "abatement_high": ab * (1 + band),
                     "confidence": conf, "capex_eur": float(r.capex_eur or 0), "opex_eur_per_yr": float(r.opex_delta_eur_per_yr or 0),
                     "lifetime_yr": life, "start": int(r.earliest_start), "ramp_years": max(int(r.ramp_years or 1), 1),
                     "cost_eur_per_t": annual / ab if ab > 0 else None, "package_cost_eur_per_t": _num(r.indicative_cost_eur_per_tco2e),
                     "co_benefits": r.co_benefits if isinstance(r.co_benefits, str) else "",
                     "trade_offs": r.trade_offs if isinstance(r.trade_offs, str) else "", "in_pathway": kind == "abatement" and r.lever_id != "L07",
                     "note": note})
    return rows


def carbon_price(scen, year):
    ts = pd.read_csv(C.D / "05_scenarios" / "transition_scenarios.csv")
    s = ts[ts.scenario == scen].sort_values("year")
    return float(pd.Series(s.carbon_price_eur_t.values, index=s.year.values).reindex(range(2025, 2051)).interpolate().loc[year])


def pathway(inv, fl, levers):
    """Emissions held at the base year (no growth), minus levers by start year and ramp.
    Orderly (below_2c): levers start at their earliest start. Delayed transition: no new action before 2030."""
    base = {"s12": inv["scope1"] + inv["scope2_market"], "s3": fl["scope3_non_flag_tco2e"], "flag": fl["flag_tco2e"]}
    y0 = inv["year"]
    years = list(range(y0, PATH_END + 1))
    scen = {"below_2c": {"label": "Orderly: below 2 °C (NGFS)", "delay_to": None},
            "delayed_transition": {"label": "Delayed transition (NGFS)", "delay_to": 2030}}
    out = {}
    for key, sc in scen.items():
        series = {b: [] for b in base}
        for y in years:
            cut = {b: 0.0 for b in base}
            for lv in levers:
                if not lv["in_pathway"] or lv["bucket"] not in base:
                    continue
                start = max(lv["start"], sc["delay_to"] or 0)
                frac = min(max((y - start + 1) / lv["ramp_years"], 0.0), 1.0)
                cut[lv["bucket"]] += lv["abatement_t"] * frac
            for b in base:
                series[b].append(max(base[b] - cut[b], 0.0))
        out[key] = {"label": sc["label"], "series": series,
                    "carbon_price_2030": carbon_price(key, 2030), "carbon_price_2035": carbon_price(key, 2035)}
    target = {b: [base[b] * (1 - SBTI_RATE[b] * (y - y0)) for y in years] for b in base}
    gaps = {k: {b: [round(v["series"][b][i] - target[b][i], 1) for i in range(len(years))] for b in base} for k, v in out.items()}
    return {"years": years, "base": base, "target": target, "scenarios": out, "gap": gaps,
            "target_year": TARGET_YEAR, "target_reduction": {b: SBTI_RATE[b] * (TARGET_YEAR - y0) for b in base}}


def coverage(inv):
    s3 = inv["scope3"]
    cats = [l for l in inv["lines"] if l["scope"] == "scope3"]
    return [{"category": l["category"], "tco2e": l["tco2e"], "share": l["tco2e"] / s3, "needs_target": l["tco2e"] / s3 >= 0.05}
            for l in sorted(cats, key=lambda l: -l["tco2e"])]


def screening(year=2025):
    """D2: what Apetit buys, from where, and the state of nature there (SBTN step 1)."""
    p = purchases_with_factors(year)
    g = (p[p.uom.ne("EUR")].groupby(["material_id", "name_en", "material_group", "origin_country", "eudr_commodity",
                                     "sbtn_high_impact_commodity"], as_index=False)
         .agg(t=("kg", lambda s: s.sum() / 1000), tco2e=("tco2e", "sum"), flag_tco2e=("flag_tco2e", "sum")))
    o = pd.read_csv(C.D / "06_nature" / "origin_state_of_nature_indicative.csv").set_index("origin_country")
    rows = []
    for r in g.itertuples():
        if r.t <= 0:
            continue
        if r.origin_country in o.index:
            s = o.loc[r.origin_country]
            water = int(s.baseline_water_stress_cat_indicative)
            defor_txt = str(s.deforestation_conversion_risk_indicative)
            bio_txt = str(s.biodiversity_sensitivity_indicative)
            nut_txt = str(s.freshwater_nutrient_status_indicative)
            defor = DEFOR.get(defor_txt.split(" ")[0], 1)
            bio = BIO.get(bio_txt.split(" (")[0], 1)
            nut = 2 if nut_txt.startswith("poor") else 1.5 if nut_txt.startswith("moderate-poor") else 1 if nut_txt.startswith("moderate") else 0
            score = water + 2 * defor + bio + nut + (2 if bool(r.sbtn_high_impact_commodity) else 0)
            screened = True
        else:
            water = defor = bio = nut = score = None
            defor_txt = bio_txt = nut_txt = None
            screened = False
        rows.append({"material_id": r.material_id, "material": r.name_en, "group": r.material_group, "origin": r.origin_country,
                     "t": float(r.t), "tco2e": float(r.tco2e), "flag_tco2e": float(r.flag_tco2e),
                     "eudr": bool(r.eudr_commodity), "high_impact": bool(r.sbtn_high_impact_commodity), "screened": screened,
                     "water_stress": water, "deforestation": defor_txt, "biodiversity": bio_txt, "nutrients": nut_txt, "nature_score": score})
    total = sum(r["tco2e"] for r in rows) or 1.0
    for r in rows:
        r["ghg_share"] = r["tco2e"] / total
        r["priority"] = (("high" if (r["nature_score"] or 0) >= 7 or (r["ghg_share"] >= 0.05 and (r["nature_score"] or 0) >= 4)
                          else "medium" if (r["nature_score"] or 0) >= 4 or r["ghg_share"] >= 0.05 else "low") if r["screened"] else "not screened")
    order = {"high": 0, "medium": 1, "low": 2, "not screened": 3}
    rows.sort(key=lambda r: (order[r["priority"]], -(r["nature_score"] or 0), -r["tco2e"]))
    return {"year": year, "rows": rows,
            "method": "ERP purchases of the year by material and origin x library factor (category 1 estimate) joined with "
                      "origin_state_of_nature_indicative.csv. Nature score = water stress (0-4) + 2 x deforestation risk (0-2) + "
                      "biodiversity sensitivity (0-3) + freshwater nutrient status (0-2) + 2 if SBTN high-impact commodity. "
                      "Priority: high if score >= 7, or score >= 4 and >= 5 % of the screened GHG. Indicative teaching values: "
                      "use WRI Aqueduct 4.0 and Global Forest Watch for real decisions.",
            "eudr_note": "EU Deforestation Regulation applies from 30.12.2026. Soy protein isolate (HS 3504) is not listed in "
                         "Annex I: verify per product (structural_events.csv)."}


def run(inventory=None):
    if inventory:
        inv = inventory_from_summary(inventory["summary"], inventory["year"])
    else:
        inv = load_inventory(2024)
        inv["source"] = "tasks/dev/A2_dev_inventory_2024.csv"
    fl = flag_split(inv, inv["year"])
    lv = levers_table()
    pw = pathway(inv, fl, lv)
    abate = [l for l in lv if l["kind"] == "abatement" and l["abatement_t"] > 0]
    return {
        "inventory": {k: v for k, v in inv.items()},
        "flag": fl,
        "base_year": base_year(inv),
        "coverage": coverage(inv),
        "levers": lv,
        "macc_total_t": sum(l["abatement_t"] for l in abate),
        "pathway": pw,
        "screening": screening(2025),
        "method": {
            "targets": "SBTi near-term, linear from the base year: scope 1+2 4.2 %/yr, scope 3 non-FLAG 2.5 %/yr, FLAG 3.03 %/yr "
                       "(docs/TASKS_AND_SCORING.md). Target year 2030.",
            "timing": "Commitment made 1.12.2025; targets due within 24 months. SBTi Net-Zero Standard V2 is effective 1.2.2027 "
                      "and V1.3.1 can be used until the end of 2027 (structural_events.csv). A submission in 2026-2027 can use "
                      "V1.3.1; V2 prefers the latest complete year as base and asks every scope 3 category >= 5 % to be covered.",
            "pathway": "Emissions held at the base-year level (no volume growth), minus levers from their start year with a linear "
                       "ramp. Orderly = below 2 °C (levers at earliest start); delayed transition = no new action before 2030. "
                       "Structural (L05, L26) and measurement (L27) levers are not counted as reductions.",
            "macc": "Cost per tonne = (capex x capital recovery factor at 6 % over the lever lifetime + yearly opex change) / design "
                    "abatement. Uncertainty band by confidence: high +/-25 %, medium +/-50 %, low +/-75 % (our assumption).",
            "sources": ["app/data/inventory.json (our 2025 inventory, task A2)", "tasks/dev/A2_dev_inventory_2024.csv", "data/05_scenarios/decarbonisation_levers.csv",
                        "data/05_scenarios/transition_scenarios.csv", "data/05_scenarios/structural_events.csv",
                        "data/05_scenarios/published_inventory_history.csv", "data/02_raw_feeds/erp_purchase_lines_2021_2025.csv",
                        "data/01_master/emission_factor_library.csv", "data/03_farming/foodhills_odlingsdata_se.csv",
                        "data/06_nature/origin_state_of_nature_indicative.csv"],
        },
    }

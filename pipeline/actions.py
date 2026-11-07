"""Action list: each action links to model results and to a lever in decarbonisation_levers.csv.
Lever abatement and cost are design estimates (value_status in the file) and are labelled as such."""
import numpy as np
import pandas as pd

from . import config as C


def run(climate, nature, transport):
    lev = pd.read_csv(C.D / "05_scenarios" / "decarbonisation_levers.csv").set_index("lever_id")
    risk = pd.DataFrame(climate["risk"])
    r245 = risk[risk.scenario == "ssp245"].set_index(["region", "crop"])
    ser = pd.DataFrame(climate["series"])

    def lever(lid):
        l = lev.loc[lid]
        return {"lever_id": lid, "lever_name": l["name"],
                "design_abatement_tco2e_2030": None if pd.isna(l.abatement_tco2e_2030_design) else float(l.abatement_tco2e_2030_design),
                "capex_eur": float(l.capex_eur), "opex_delta_eur_per_yr": float(l.opex_delta_eur_per_yr),
                "indicative_cost_eur_per_tco2e": None if pd.isna(l.indicative_cost_eur_per_tco2e) else float(l.indicative_cost_eur_per_tco2e),
                "confidence": l.confidence, "value_status": l.value_status}

    # hedge: correlation of FI and SE pea regional yields in 2041-2060 under ssp245
    fi = ser[(ser.region == "FI_SW") & (ser.crop == "pea") & (ser.scenario == "ssp245")].set_index("year").yield_t_ha
    se = ser[(ser.region == "SE_SKANE") & (ser.crop == "pea") & (ser.scenario == "ssp245")].set_index("year").yield_t_ha
    corr = float(np.corrcoef(fi.values, se.reindex(fi.index).values)[0, 1])
    pea_fi, pea_se = r245.loc[("FI_SW", "pea")], r245.loc[("SE_SKANE", "pea")]
    top3 = [c for c in nature["catchments"] if c["p_kg"] > 0][:3]
    t25 = next(s for s in transport["summary"] if s["year"] == 2025)

    irr_rows = r245[r245.eur_saved_by_irrigation_per_yr.notna()]
    irr_eur = float(irr_rows.loc[[i for i in irr_rows.index if i[1] in ("potato", "carrot")]].eur_saved_by_irrigation_per_yr.sum())
    tr = r245.loc[("FI_SW", "turnip_rape")]

    actions = [
        {"id": "A1", "priority": 1, "area": "Climate risk",
         "action": "Keep and grow two-region pea sourcing (Finland + Sweden) as a climate hedge",
         "evidence": f"FI pea: {pea_fi.mean_yield_change_pct:+.1f} % yield, EUR {pea_fi.eur_risk_per_yr:,.0f}/yr risk (SSP2-4.5, 2041-2060). "
                     f"FI-SE yearly yield correlation r = {corr:.2f}: bad years rarely hit both regions.",
         "eur_per_yr": float(pea_fi.eur_risk_per_yr + pea_se.eur_risk_per_yr), "eur_label": "pea climate risk to manage (FI + SE)",
         "tco2e": None, "owner": "Sourcing manager (vegetables)",
         "next_week": "Set a minimum Swedish share in the 2027 pea contract plan and agree a shortfall swap with Foodhills.",
         "sources": ["climate.json risk (FI_SW pea, SE_SKANE pea, ssp245)", "climate.json series (yearly yields)"], "lever": None},
        {"id": "A2", "priority": 2, "area": "Climate risk",
         "action": "Turnip rape: grower programme for heat and drought (earlier sowing, tolerant varieties)",
         "evidence": f"Largest yield loss: {tr.mean_yield_change_pct:+.1f} % (SSP2-4.5), bad-year probability {tr.p_bad_year:.0%}. "
                     f"Expected shortfall {tr.expected_shortfall_t_per_yr:,.0f} t/yr.",
         "eur_per_yr": float(tr.eur_risk_per_yr), "eur_label": "turnip rape replacement cost at risk",
         "tco2e": None, "owner": "Oilseed contract manager",
         "next_week": "Pick 20 pilot growers in the highest-risk grid cells and test earlier sowing in 2027.",
         "sources": ["climate.json risk (FI_SW turnip_rape)"], "lever": lever("L15")},
        {"id": "A3", "priority": 3, "area": "Climate risk",
         "action": "Irrigation scheduling and drip on potatoes and carrots",
         "evidence": f"Model: irrigating all potato and carrot fields cuts replacement cost by about EUR {irr_eur:,.0f}/yr (SSP2-4.5).",
         "eur_per_yr": irr_eur, "eur_label": "replacement cost avoided", "tco2e": float(lev.loc["L24", "abatement_tco2e_2030_design"]),
         "owner": "Field advisor (vegetables)", "next_week": "List growers without irrigation and check water permits.",
         "sources": ["climate.json risk (eur_saved_by_irrigation_per_yr)", "decarbonisation_levers.csv L24"], "lever": lever("L24")},
        {"id": "A4", "priority": 4, "area": "Nature (SBTN)",
         "action": f"Catch crops and buffer strips first in catchments {', '.join(c['catchment_id'] for c in top3)}",
         "evidence": "Top SBTN priority (pressure x state): " + "; ".join(
             f"{c['catchment_id']} {c['p_kg']:.0f} kg P, {c['n_kg']:.0f} kg N, status {c['status']}" for c in top3),
         "eur_per_yr": None, "eur_label": None, "tco2e": float(lev.loc["L10", "abatement_tco2e_2030_design"]),
         "owner": "Sustainability team + field advisors", "next_week": "Share the parcel list for these catchments with field advisors.",
         "sources": ["nature.json catchments", "decarbonisation_levers.csv L10"], "lever": lever("L10")},
        {"id": "A5", "priority": 5, "area": "Transport CO2",
         "action": "HVO100 for inbound and outbound trucking",
         "evidence": f"2025 transport: cat 4 {t25['cat4_corrected_tco2e']:,.0f} t + cat 9 {t25['cat9_tco2e']:,.0f} t. "
                     f"Switching all road legs to HVO100 would save up to {transport['hvo_whatif_2025_tco2e_saved']:,.0f} t (upper bound).",
         "eur_per_yr": float(lev.loc["L20", "opex_delta_eur_per_yr"]), "eur_label": "extra cost per year (lever L20 design estimate)",
         "tco2e": float(transport["hvo_whatif_2025_tco2e_saved"]), "owner": "Logistics manager",
         "next_week": "Ask the two largest hauliers for an HVO100 price per km.",
         "sources": ["transport.json", "emission_factor_library.csv EF-TKM-TRUCK-HVO", "decarbonisation_levers.csv L20"],
         "lever": lever("L20")},
    ]
    not_reduction = {"lever": lever("L27"),
                     "note": "Switching from spend-based to supplier-specific data changes the number, not the emissions. "
                             "It is a measurement improvement, not a reduction (TASKS_AND_SCORING.md B1)."}
    return {"actions": actions, "not_a_reduction": not_reduction, "hedge_correlation_ssp245": round(corr, 3)}

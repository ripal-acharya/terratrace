"""Track D1: phosphorus and nitrogen from Apetit-contract parcels to water (2025), SBTN-style priority.

Field losses use a simple export-coefficient model (Finnish averages ~1.1 kg P/ha and ~15 kg N/ha,
SIMULATION_DESIGN.md), adjusted by parcel attributes. Delivery to water decays with distance, then
catchment retention applies. Two scale factors and the decay length are calibrated on the six public
dev catchments (tasks/dev/D1_dev_catchments_2025.csv).
"""
import itertools
import json

import numpy as np
import pandas as pd

from . import config as C

EROSIVE = {"potato": 1.4, "carrot": 1.3, "turnip_rape": 1.1, "pea": 1.0, "spinach": 1.2}


def parcel_losses(decay_m):
    par = pd.read_csv(C.D / "01_master" / "parcels.csv")
    ch = pd.read_csv(C.D / "03_farming" / "parcel_crop_history_and_plan.csv")
    ch = ch[(ch.year == 2025) & ch.crop.isin(C.APETIT_CROPS)]
    d = ch.merge(par, on="parcel_id", suffixes=("", "_p"))
    cat = pd.read_csv(C.D / "06_nature" / "catchments.csv").set_index("catchment_id")
    ptest = d.p_test_mgl_latest.fillna(d.groupby("catchment_id").p_test_mgl_latest.transform("median")) \
        .fillna(par.p_test_mgl_latest.median())
    catch = d.catch_crop.astype(str).str.lower().eq("true")
    p_ha = (1.1 * (ptest / 14.0) ** 0.5 * (1 + d.clay_pct_soilmap / 100) * (1 + 0.15 * d.slope_pct)
            * d.crop.map(EROSIVE).fillna(1.0) * np.where(d.buffer_strip, 0.7, 1.0) * np.where(catch, 0.85, 1.0))
    sandy = d.soil_class_soilmap.isin(["sand", "fine_sand"])
    n_ha = (15.0 * np.where(sandy, 1.4, 1.0) * np.where(d.soil_class_soilmap == "organic", 1.5, 1.0)
            * np.where(catch, 0.7, 1.0) * np.where(d.drainage == "subsurface", 1.15, 1.0))
    deliver = np.exp(-d.dist_to_water_m / decay_m)
    keep = 1 - d.catchment_id.map(cat.nutrient_retention_frac_estimate)
    d["p_kg"] = d.area_ha * p_ha * deliver * keep
    d["n_kg"] = d.area_ha * n_ha * deliver * keep
    return d, cat


def priority(df, cat):
    P, N = df.apetit_p_to_water_kg, df.apetit_n_to_water_kg
    sw = df.catchment_id.map(cat.ecological_status_class).map(C.STATE_WEIGHT)
    ps = df.catchment_id.map(cat.p_sensitivity)
    return (P / P[P > 0].median() + 0.5 * N / N[N > 0].median()) * sw * ps


def score_d1_dev(sub, key):
    """Same formula as tools/ccn_tools/score.py score_d1 (Spearman = Pearson on ranks, no scipy needed)."""
    key = key.copy()
    key["ps"] = key.apetit_p_to_water_kg / key.apetit_p_to_water_kg.median() + \
        0.5 * key.apetit_n_to_water_kg / key.apetit_n_to_water_kg.median()
    m = key.merge(sub[["catchment_id", "apetit_p_to_water_kg", "apetit_n_to_water_kg", "priority_rank"]],
                  on="catchment_id", suffixes=("_true", "_pred"))
    rk_t = m.ps.rank(ascending=False)
    rho = float(np.corrcoef(rk_t.rank(), m.priority_rank.rank())[0, 1])
    k = min(5, len(m))
    overlap = len(set(m.loc[rk_t <= k, "catchment_id"]) & set(m.sort_values("priority_rank").catchment_id.head(k))) / k
    def mae(col):
        t = np.log10(m[col + "_true"].clip(lower=0.1))
        q = np.log10(m[col + "_pred"].clip(lower=0.1))
        return float((t - q).abs().mean())
    mp, mn = mae("apetit_p_to_water_kg"), mae("apetit_n_to_water_kg")
    sc = 100 * (0.1 * max(0, rho) + 0.1 * overlap + 0.4 * max(0, 1 - mp / 0.15) + 0.4 * max(0, 1 - mn / 0.15))
    return dict(score=round(sc, 2), spearman=round(rho, 3), top5_overlap=round(overlap, 3),
                mae_log10_p=round(mp, 4), mae_log10_n=round(mn, 4))


def run():
    dev = pd.read_csv(C.DATA_ROOT / "tasks" / "dev" / "D1_dev_catchments_2025.csv")
    best = None
    for L in [150, 300, 600, 1200, 3000]:
        d, cat = parcel_losses(L)
        g = d.groupby("catchment_id")[["p_kg", "n_kg"]].sum().reindex(dev.catchment_id)
        # best log-scale factor = mean log ratio
        sp = 10 ** np.mean(np.log10(dev.apetit_p_to_water_kg.values / g.p_kg.values))
        sn = 10 ** np.mean(np.log10(dev.apetit_n_to_water_kg.values / g.n_kg.values))
        err = np.mean(np.abs(np.log10(g.p_kg.values * sp / dev.apetit_p_to_water_kg.values))) + \
              np.mean(np.abs(np.log10(g.n_kg.values * sn / dev.apetit_n_to_water_kg.values)))
        if best is None or err < best[0]:
            best = (err, L, sp, sn)
    _, L, sp, sn = best
    d, cat = parcel_losses(L)
    d["p_kg"] *= sp
    d["n_kg"] *= sn
    g = d.groupby("catchment_id").agg(apetit_p_to_water_kg=("p_kg", "sum"), apetit_n_to_water_kg=("n_kg", "sum"),
                                      contract_area_ha=("area_ha", "sum"), parcels=("parcel_id", "count"))
    tpl = pd.read_csv(C.DATA_ROOT / "tasks" / "templates" / "D1_catchment_priority_submission.csv")
    sub = tpl[["catchment_id", "region"]].merge(g, on="catchment_id", how="left").fillna(
        {"apetit_p_to_water_kg": 0.0, "apetit_n_to_water_kg": 0.0, "contract_area_ha": 0.0, "parcels": 0})
    sub["priority_score"] = priority(sub, cat)
    sub["priority_rank"] = sub.priority_score.rank(ascending=False, method="first").astype(int)
    sub = sub.round({"apetit_p_to_water_kg": 2, "apetit_n_to_water_kg": 1, "contract_area_ha": 1, "priority_score": 3})
    sub[["catchment_id", "region", "apetit_p_to_water_kg", "apetit_n_to_water_kg", "priority_rank"]].to_csv(
        C.OUT_SUB / "D1_catchment_priority_submission.csv", index=False)

    # dev check with the official scorer
    dev_score = score_d1_dev(sub, dev)
    loads = pd.read_csv(C.D / "06_nature" / "monitored_catchment_loads.csv")
    l25 = loads[loads.year == 2025].set_index("catchment_id")

    geo = json.loads((C.D / "06_nature" / "catchments.geojson").read_text())
    rows = []
    for _, r in sub.sort_values("priority_rank").iterrows():
        c = cat.loc[r.catchment_id]
        rows.append({
            "catchment_id": r.catchment_id, "region": r.region, "rank": int(r.priority_rank),
            "p_kg": float(r.apetit_p_to_water_kg), "n_kg": float(r.apetit_n_to_water_kg),
            "contract_area_ha": float(r.contract_area_ha), "parcels": int(r.parcels),
            "priority_score": float(r.priority_score), "status": c.ecological_status_class,
            "state_weight": C.STATE_WEIGHT[c.ecological_status_class], "p_sensitivity": float(c.p_sensitivity),
            "water_type": c.receiving_water_type, "retention": float(c.nutrient_retention_frac_estimate),
            "monitored_total_p_kg_2025": float(l25.total_p_load_kg[r.catchment_id]) if r.catchment_id in l25.index else None,
            "monitored_total_n_kg_2025": float(l25.total_n_load_kg[r.catchment_id]) if r.catchment_id in l25.index else None,
        })
    return {
        "catchments": rows, "geojson": geo,
        "calibration": {"decay_length_m": L, "p_scale": round(float(sp), 3), "n_scale": round(float(sn), 3),
                        "dev_score": dev_score, "baseline_dev_score": 12.0,
                        "note": "Calibrated on the 6 public dev catchments; those 6 are excluded from the hidden test score."},
        "method": {
            "formula": "priority = (P / median(P) + 0.5 x N / median(N)) x state_weight x p_sensitivity",
            "state_weight": C.STATE_WEIGHT,
            "loads": "parcel area x export coefficient (soil-P test, clay, slope, crop, buffer strip, catch crop, "
                     "drainage, soil class) x exp(-distance to water / L) x (1 - catchment retention)",
            "standard": "SBTN Step 2 (interpret and prioritise): pressure x state of nature (docs/NATURE_SBTN.md)",
            "sources": ["data/01_master/parcels.csv", "data/03_farming/parcel_crop_history_and_plan.csv (2025)",
                        "data/06_nature/catchments.csv", "data/06_nature/catchments.geojson",
                        "tasks/dev/D1_dev_catchments_2025.csv (calibration)"],
            "actions": "Levers L09 (precision N), L10 (catch crops), L11 (shift off peat), L12 (rewetting), "
                       "L24 (irrigation scheduling) in data/05_scenarios/decarbonisation_levers.csv",
        },
    }

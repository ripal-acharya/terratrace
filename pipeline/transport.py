"""Transport CO2e from shipments.csv (GHG Protocol Scope 3 categories 4 and 9).

Method (docs/METHODOLOGY.md section 4): tkm x well-to-wheel factor per mode (GLEC-style factors in
emission_factor_library.csv). Every import lot has a road leg plus a sea or Ro-Pax leg where relevant,
so import lots with only a road leg are flagged as `missing_leg` and the sea leg is estimated.
"""
import numpy as np
import pandas as pd

from . import config as C
from . import audit

MODE_EF = {"truck": "EF-TKM-TRUCK", "truck-reefer": "EF-TKM-TRUCK-REEFER", "ropax": "EF-TKM-ROPAX",
           "ship-bulk": "EF-TKM-SHIP-BULK", "ship-reefer": "EF-TKM-SHIP-REEFER", "rail": "EF-TKM-RAIL"}
ROAD_ONLY_ORIGINS = {"FI", "NO"}          # domestic, and Norway reached by road in the data
SEA_LEG_FOR = {"truck": "EF-TKM-SHIP-BULK", "truck-reefer": "EF-TKM-SHIP-REEFER"}


def find_missing_legs(s, erp):
    o = erp.groupby("doc_no").origin_country.first()
    mat = erp.groupby("doc_no").material_id.first()
    inb = s[s.direction == "inbound"].copy()
    inb["origin"] = inb.ref_doc.map(o)
    inb["material_id"] = inb.ref_doc.map(mat)
    legs = inb.groupby("ref_doc").agg(origin=("origin", "first"), year=("year", "first"), material_id=("material_id", "first"),
                                      modes=("mode", lambda x: tuple(sorted(set(x)))), t=("t", "max"))
    complete = inb[inb["mode"].str.startswith(("ship", "ropax"))]
    sea_km = complete.groupby(["origin", "ef_id"]).km.median()
    sea_km_any = complete.groupby("ef_id").km.median()
    # usual vessel type for the same material (else same origin): learned from complete lots
    usual_mat = complete.groupby("material_id").ef_id.agg(lambda x: x.value_counts().index[0])
    usual_org = complete.groupby("origin").ef_id.agg(lambda x: x.value_counts().index[0])
    rows = []
    for ref, r in legs.iterrows():
        if pd.isna(r.origin) or r.origin in ROAD_ONLY_ORIGINS:
            continue
        if len(r.modes) == 1 and r.modes[0] in SEA_LEG_FOR:
            ef = usual_mat.get(r.material_id, usual_org.get(r.origin, SEA_LEG_FOR[r.modes[0]]))
            km = sea_km.get((r.origin, ef), sea_km_any.get(ef, np.nan))
            rows.append({"record_key": f"ship:{ref}:{ef}", "ref_doc": ref, "year": int(r.year), "origin": r.origin,
                         "material_id": r.material_id, "road_mode": r.modes[0], "missing_ef_id": ef, "t": float(r.t),
                         "est_km": float(km), "est_tkm": float(r.t * km)})
    return pd.DataFrame(rows)


def run():
    s = pd.read_csv(C.D / "02_raw_feeds" / "shipments.csv", dtype={"ref_doc": str})
    erp = pd.read_csv(C.D / "02_raw_feeds" / "erp_purchase_lines_2021_2025.csv", dtype={"doc_no": str},
                      usecols=["doc_no", "origin_country", "material_id"])
    ef = pd.read_csv(C.D / "01_master" / "emission_factor_library.csv").set_index("ef_id")

    # 1) consistency check: mode label vs factor id
    exp = s["mode"].map(MODE_EF)
    mislabel = s[exp.notna() & (exp != s.ef_id)]
    for _, r in mislabel.iterrows():
        audit.log(f"ship:{r.ref_doc}:{r.ef_id}", "mode", r["mode"], None, "rule: mode must match ef_id",
                  "issue type mode_mislabel (TASKS_AND_SCORING.md)")

    # 2) missing sea legs
    miss = find_missing_legs(s, erp)
    for _, r in miss.iterrows():
        audit.log(r.record_key, "tkm", None, round(r.est_tkm, 1),
                  "rule: import lot (origin not FI/NO) has only a road leg -> add the usual sea leg of the same "
                  "material; tkm = lot tonnes x median sea km for same origin and vessel type",
                  "METHODOLOGY.md s.4: every import lot has a road leg plus a sea or Ro-Pax leg")

    # dev check against public 2023-2024 labels
    lab = pd.read_csv(C.DATA_ROOT / "tasks" / "dev" / "A1_dev_issue_labels_2023_2024.csv")
    lab = lab[(lab.table == "shipments") & (lab.issue_type == "missing_leg")]
    pred_dev = set(miss[miss.year.isin([2023, 2024])].record_key)
    true_dev = set(lab.record_key)
    tp = len(pred_dev & true_dev)
    dev_check = {"true_labels": len(true_dev), "flagged": len(pred_dev), "correct": tp,
                 "precision": round(tp / max(len(pred_dev), 1), 3), "recall": round(tp / max(len(true_dev), 1), 3)}

    # 3) emissions
    s["kg_per_tkm"] = s.ef_id.map(ef.kgco2e_per_unit)
    s["tco2e"] = s.tkm * s.kg_per_tkm / 1000
    by = s.groupby(["year", "direction", "mode", "ef_id"], as_index=False).agg(
        tkm=("tkm", "sum"), tco2e=("tco2e", "sum"), shipments=("shipment_id", "count"))
    by["kg_per_tkm"] = by.ef_id.map(ef.kgco2e_per_unit)
    by["category"] = by.direction.map(C.TRANSPORT_CATEGORY)
    add = miss.assign(tco2e=lambda d: d.est_tkm * d.missing_ef_id.map(ef.kgco2e_per_unit) / 1000) \
        .groupby("year").tco2e.sum() if len(miss) else pd.Series(dtype=float)
    wh = pd.read_csv(C.D / "02_raw_feeds" / "frozen_warehousing.csv")
    wh_t = (wh.set_index("year").pallet_days * ef.kgco2e_per_unit["EF-PALLETDAY-FROZEN"] / 1000)
    years = sorted(s.year.unique())
    summary = []
    for y in years:
        g = by[by.year == y]
        summary.append({"year": int(y),
                        "cat4_raw_tco2e": round(float(g[g.direction == "inbound"].tco2e.sum()), 1),
                        "cat9_transport_tco2e": round(float(g[g.direction == "outbound"].tco2e.sum()), 1),
                        "cat9_warehousing_tco2e": round(float(wh_t.get(y, 0.0)), 1),
                        "missing_leg_tco2e": round(float(add.get(y, 0.0)), 1)})
        summary[-1]["cat4_corrected_tco2e"] = round(summary[-1]["cat4_raw_tco2e"] + summary[-1]["missing_leg_tco2e"], 1)
        summary[-1]["cat9_tco2e"] = round(summary[-1]["cat9_transport_tco2e"] + summary[-1]["cat9_warehousing_tco2e"], 1)

    # what-if: road legs on HVO100 (lever L20) - inbound + outbound diesel trucks
    y25 = by[(by.year == 2025) & by["mode"].isin(["truck", "truck-reefer"])]
    hvo = float((y25.tkm * (y25.kg_per_tkm - ef.kgco2e_per_unit["EF-TKM-TRUCK-HVO"])).sum() / 1000)

    a1 = miss[miss.year == 2025].assign(table="shipments", issue_type="missing_leg", confidence=0.9,
                                        explanation=lambda d: "import lot from " + d.origin + " has only a "
                                        + d.road_mode + " leg; expected " + d.missing_ef_id)
    a1[["table", "record_key", "issue_type", "confidence", "explanation"]].to_csv(
        C.OUT_SUB / "A1_issues_submission.csv", index=False)

    factors = {k: {"name": ef.loc[k, "name"], "kg_per_tkm": float(ef.loc[k, "kgco2e_per_unit"]),
                   "source": ef.loc[k, "reference_source"], "status": ef.loc[k, "value_status"]}
               for k in MODE_EF.values()} | {"EF-TKM-TRUCK-HVO": {
                   "name": ef.loc["EF-TKM-TRUCK-HVO", "name"], "kg_per_tkm": float(ef.loc["EF-TKM-TRUCK-HVO", "kgco2e_per_unit"]),
                   "source": ef.loc["EF-TKM-TRUCK-HVO", "reference_source"], "status": ef.loc["EF-TKM-TRUCK-HVO", "value_status"]}}
    keys = {}
    for y in (2023, 2024):
        k = pd.read_csv(C.DATA_ROOT / "tasks" / "dev" / f"A2_dev_inventory_{y}.csv").set_index("category").tco2e
        ours = next(r for r in summary if r["year"] == y)
        keys[str(y)] = {"cat4_truth": float(k["cat04_upstream_transport"]), "cat4_ours": ours["cat4_corrected_tco2e"],
                        "cat9_truth": float(k["cat09_downstream_transport"]), "cat9_ours": ours["cat9_tco2e"]}
    return {
        "dev_inventory_check": keys,
        "summary": summary, "by_mode": by.round({"tkm": 0, "tco2e": 1}).to_dict("records"),
        "missing_legs": miss.round({"est_km": 0, "est_tkm": 0, "t": 2}).to_dict("records"),
        "mislabels": int(len(mislabel)), "dev_check": dev_check, "factors": factors,
        "hvo_whatif_2025_tco2e_saved": round(hvo, 1),
        "method": {
            "formula": "tCO2e = tkm x kg CO2e/tkm (WTW) / 1000",
            "standard": "GHG Protocol Scope 3: inbound = category 4, outbound = category 9 (METHODOLOGY.md s.4)",
            "sources": ["data/02_raw_feeds/shipments.csv", "data/02_raw_feeds/erp_purchase_lines_2021_2025.csv (origin)",
                        "data/01_master/emission_factor_library.csv (EF-TKM-*, EF-PALLETDAY-FROZEN)",
                        "data/02_raw_feeds/frozen_warehousing.csv"],
            "assumptions": ["Missing sea leg distance = median of complete lots with the same origin and vessel type",
                            "Factors are GLEC-style, value_status calibrated_synthetic",
                            "Category 9 includes third-party frozen warehousing: pallet-days x EF-PALLETDAY-FROZEN"],
        },
    }

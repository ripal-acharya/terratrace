"""Task A2 (2025 inventory with audit trail) and task A1 (data-quality issues, all tables).

Method: raw feeds -> cleaning rules (below) -> canonical clean tables -> the package's reference
calculator (tools/ccn_tools/reference_calculator.py, docs/METHODOLOGY.md). Every rule was checked
against the public 2023-2024 answers (tasks/dev): the A1 labels and the A2 inventories.

Every correction is logged (table, record_key, issue_type, field, old -> new, rule).
"""
import json
import sys

import numpy as np
import pandas as pd

from . import config as C
from . import transport as TR

SOIL_ORGANIC_SHARE = 0.30   # docs/TASKS_AND_SCORING.md A1: soil_misreport when >= 30 % of the crop area is organic


def _tools():
    p = str(C.DATA_ROOT / "tools")
    if p not in sys.path:
        sys.path.insert(0, p)
    from ccn_tools import io as IO, reference_calculator as RC, factors as F, score as SC  # noqa: E402
    from ccn_tools.farm_calculator import farm_footprint_per_ha  # noqa: E402
    return IO, RC, F, SC, farm_footprint_per_ha


class Log:
    def __init__(self):
        self.rows = []

    def add(self, table, key, issue, year, field="", old="", new="", rule=""):
        self.rows.append({"table": table, "record_key": key, "issue_type": issue, "year": int(year), "field": field,
                          "old_value": "" if old is None else str(old), "new_value": "" if new is None else str(new), "rule": rule})


def clean_tables(raw, IO, F, fp):
    L = Log()
    raw = dict(raw)

    # ---------- energy meters: unit error (x1000), spike, missing month
    em = raw["energy_meter"].copy()
    fixed = []
    for _, g in em.groupby(["site_id", "carrier", "year"]):
        g = g.copy()
        nz = g.value[g.value > 0]
        med = nz.median() if len(nz) >= 3 else None    # months with no operation (e.g. Bjuv before Dec 2025) are not errors
        for i in (g.index[g.value > 200 * med] if med else []):
            r = g.loc[i]
            L.add("energy_meter_readings", f"energy:{r.site_id}:{int(r.year)}-{int(r.month):02d}:{r.carrier}", "unit_error", r.year,
                  "value", r.value, r.value / 1000, "value > 200 x site-year median: kWh keyed as MWh")
            g.loc[i, "value"] = r.value / 1000
        fixed.append(g)
    em = pd.concat(fixed)
    ymed = em.groupby(["site_id", "carrier", "year"]).value.transform("median")
    em["spike"] = (em.value > 2.4 * ymed) & (ymed > 0)
    ok = em[~em.spike]

    def typical(site, carrier, year, month, level):
        h = ok[(ok.site_id == site) & (ok.carrier == carrier) & (ok.month == month) & (ok.year != year)]
        if h.empty:
            return level
        lv = ok[(ok.site_id == site) & (ok.carrier == carrier) & (ok.year != year)].groupby("year").value.median()
        return float((h.set_index("year").value / lv.reindex(h.year).values).median() * level)

    rows = []
    for (site, carrier, year), g in em.groupby(["site_id", "carrier", "year"]):
        g = g.copy()
        level = g.loc[~g.spike, "value"].median()
        for i in g.index[g.spike]:
            new = typical(site, carrier, year, g.loc[i, "month"], level)
            L.add("energy_meter_readings", f"energy:{site}:{int(year)}-{int(g.loc[i, 'month']):02d}:{carrier}", "meter_spike", year,
                  "value", g.loc[i, "value"], round(new, 3), "> 2.4 x median: replaced with the same month of other years")
            g.loc[i, "value"] = new
        if len(g) >= 8:
            for m in sorted(set(range(1, 13)) - set(g.month)):
                r = g.iloc[0].copy()
                r["month"], r["value"] = m, typical(site, carrier, year, m, level)
                L.add("energy_meter_readings", f"energy:{site}:{int(year)}-{m:02d}:{carrier}", "missing_record", year,
                      "value", "", round(r["value"], 3), "missing month filled from the same month of other years")
                g = pd.concat([g, r.to_frame().T])
        rows.append(g)
    raw["energy_meter"] = pd.concat(rows, ignore_index=True).drop(columns="spike").astype({"year": int, "month": int, "value": float})

    # ---------- fuel deliveries: m3 keyed as litres
    fd = raw["fuel_deliveries"].copy()
    medf = fd.groupby(["site_id", "carrier"]).quantity.transform("median")
    for i in fd.index[fd.quantity < 0.01 * medf]:
        r = fd.loc[i]
        L.add("fuel_deliveries", f"fuel:{r.delivery_id}", "unit_error", r.year, "quantity", r.quantity, r.quantity * 1000, "< 1 % of usual delivery: x1000")
        fd.loc[i, "quantity"] = r.quantity * 1000
    raw["fuel_deliveries"] = fd

    # ---------- waste: tonnes keyed as kg
    w = raw["waste"].copy()
    medw = w.groupby(["site_id", "waste_stream"]).quantity.transform("median")
    for i in w.index[w.quantity < 0.01 * medw]:
        r = w.loc[i]
        L.add("waste_transfer_notes", f"waste:{r.transfer_note}", "unit_error", r.year, "quantity", r.quantity, r.quantity * 1000, "< 1 % of stream median: x1000")
        w.loc[i, "quantity"] = r.quantity * 1000
    raw["waste"] = w

    # ---------- travel: duplicates
    tr = raw["travel"]
    dmask = tr.duplicated(["traveller_id", "travel_date", "route", "pkm", "nights"], keep="first")
    for r in tr[dmask].itertuples():
        L.add("travel_bookings", f"travel:{r.booking_id}", "duplicate_record", r.year, "*", "", "removed", "same traveller, date, route, distance, nights")
    raw["travel"] = tr[~dmask]

    # ---------- ERP purchases
    e = raw["erp"].copy()
    e["yr_"] = e.posting_date.str[:4].astype(int)
    e["dt_"] = pd.to_datetime(e.posting_date)
    e = e.sort_values(["dt_", "doc_no"])
    gap = e.groupby(["supplier_id", "material_id", "quantity", "net_amount"]).dt_.diff().dt.days
    dup = gap.notna() & (gap <= 10) & e.movement_type.eq(101)
    for r in e[dup].itertuples():
        L.add("erp_purchase_lines", f"erp:{r.doc_no}:{r.line_no}", "duplicate_record", r.yr_, "*", "", "removed", "same supplier, material, qty, amount within 10 days")
    e = e[~dup].copy()
    goods = e.uom.ne("EUR")
    cnt = e[goods].groupby(["supplier_id", "material_id"]).size()
    tot = cnt.groupby(level=0).sum()
    main = cnt.groupby(level=0).idxmax().map(lambda t: t[1])
    for i, r in e[goods].iterrows():
        n = cnt.get((r.supplier_id, r.material_id), 0)
        if tot[r.supplier_id] >= 10 and n / tot[r.supplier_id] < 0.15 and main[r.supplier_id] != r.material_id:
            L.add("erp_purchase_lines", f"erp:{r.doc_no}:{r.line_no}", "material_mismatch", r.yr_, "material_id", r.material_id, main[r.supplier_id],
                  "supplier almost never delivers this material")
            e.loc[i, "material_id"] = main[r.supplier_id]
    fx = F.FX_PER_EUR
    cur_main = e.groupby("supplier_id").currency.agg(lambda c: c.mode().iloc[0])
    kg = e.quantity.where(e.uom.ne("TO"), e.quantity * 1000)
    eur = e.net_amount / e.currency.map(fx).fillna(1.0)
    up = (eur / kg).where(goods & (kg > 0))
    ratio = up / up.groupby(e.material_id).transform("median")
    foreign = e.supplier_id.map(cur_main).ne(e.currency)
    for i in e.index[ratio > 300]:
        r = e.loc[i]
        L.add("erp_purchase_lines", f"erp:{r.doc_no}:{r.line_no}", "unit_error", r.yr_, "quantity", r.quantity, r.quantity * 1000, "unit price ~1000 x median: tonnes keyed as KG")
        e.loc[i, "quantity"] = r.quantity * 1000
    for i in e.index[(ratio.between(8.5, 11.8) & ~foreign) | ratio.between(0.085, 0.118)]:
        r = e.loc[i]
        k = 10 if ratio[i] > 1 else 0.1
        L.add("erp_purchase_lines", f"erp:{r.doc_no}:{r.line_no}", "decimal_shift", r.yr_, "quantity", r.quantity, r.quantity * k, "unit price ~10 x off: decimal shift")
        e.loc[i, "quantity"] = r.quantity * k
    for i in e.index[goods & foreign & ratio.between(8.5, 13)]:
        r = e.loc[i]
        L.add("erp_purchase_lines", f"erp:{r.doc_no}:{r.line_no}", "currency_error", r.yr_, "currency", r.currency, cur_main[r.supplier_id], "supplier bills in another currency")
        e.loc[i, "currency"] = cur_main[r.supplier_id]
    sp = e.uom.eq("EUR")
    meds = e[sp].groupby(["supplier_id", "material_id"]).net_amount.transform("median").reindex(e.index)
    for i in e.index[sp & (e.net_amount > 6 * meds)]:
        r = e.loc[i]
        L.add("erp_purchase_lines", f"erp:{r.doc_no}:{r.line_no}", "currency_error", r.yr_, "currency", r.currency, "SEK", "spend ~11 x usual: SEK amount booked as EUR")
        e.loc[i, "currency"] = "SEK"
    raw["erp"] = e.drop(columns=["yr_", "dt_"])

    T = IO.naive_canonical(raw)

    # ---------- refrigerants: grams keyed as kg; ammonia code on a system that runs another gas
    rr = raw["refrigerants"]
    rf = T["refrigerants"].copy()
    other = rr[rr.refrigerant != "R717_ammonia"].groupby("system").refrigerant.agg(lambda s: s.mode().iloc[0])
    for i in rr.index:
        r = rr.loc[i]
        if r.kg_added > 1000:
            L.add("refrigerant_service_log", f"refrigerant:{r.event_id}", "unit_error", r.year, "kg_added", r.kg_added, r.kg_added / 1000, "grams keyed as kg")
            rf.loc[i, "kg_added"] = r.kg_added / 1000
        if r.refrigerant == "R717_ammonia" and r.system in other.index:
            L.add("refrigerant_service_log", f"refrigerant:{r.event_id}", "wrong_gas_code", r.year, "refrigerant", r.refrigerant, other[r.system], "system runs another refrigerant")
            rf.loc[i, "refrigerant"] = other[r.system]
    T["refrigerants"] = rf

    # ---------- GoO: the national registry statement is authoritative
    gr = raw["goo_reg"].copy()
    gr["vintage_year"] = gr.production_period_start.str[:4].astype(int)
    reg = gr.groupby(["beneficiary_site", "consumption_year"]).mwh.sum()
    for r in raw["goo"].itertuples():
        rv = reg.get((r.site_id, r.year), 0.0)
        if abs(rv - r.mwh_cancelled) > 1 or r.vintage_year != r.year:
            L.add("goo_cancellations", f"goo:{r.site_id}:{r.year}", "certificate_mismatch", r.year, "mwh_cancelled", r.mwh_cancelled, round(rv, 1), "internal log differs from the registry")
    T["goo"] = gr.rename(columns={"consumption_year": "year", "beneficiary_site": "site_id", "mwh": "mwh_cancelled"})[["year", "site_id", "mwh_cancelled", "vintage_year"]]

    # ---------- commuting: metres keyed as km
    cs = T["commuting_survey"].copy()
    for i in cs.index[cs.one_way_km > 500]:
        r = cs.loc[i]
        L.add("commuting_survey", f"commute:{r.response_id}", "unit_error", 2025, "one_way_km", r.one_way_km, r.one_way_km / 1000, "metres keyed as km")
        cs.loc[i, "one_way_km"] = r.one_way_km / 1000
    T["commuting_survey"] = cs

    # ---------- supplier PCFs: valid only for a reference period covering the year and per kg
    p = raw["pcfs"].copy()
    valid = []
    for r in p.itertuples():
        bad = None
        if not (int(r.ref_start[:4]) <= r.year < int(r.ref_end[:4]) or r.ref_start[:4] == str(r.year)):
            bad = "pcf_stale_period"
        elif r.value > 50 or str(r.declared_unit).lower() not in ("kilogram", "kg"):
            bad = "pcf_unit_error"
        if bad:
            L.add("supplier_pcfs", f"pcf:{r.supplier_id}:{r.material_id}:{r.year}", bad, r.year, "pcf", r.value, "library factor used", "PCF not valid for this year / unit")
        else:
            valid.append(r.Index)
    T["pcf_used"] = p.loc[valid].rename(columns={"value": "kgco2e_per_kg"})[["year", "supplier_id", "material_id", "kgco2e_per_kg"]]

    # ---------- contract farms: survey fixes + soil map
    sv = raw["farm_survey"].copy()
    medn = sv.groupby("crop").n_mineral_kg_ha.transform("median")
    for i in sv.index[((sv.n_mineral_kg_ha > 0) & (sv.n_mineral_kg_ha < 0.2 * medn)) | (sv.n_mineral_kg_ha > 5 * medn)]:
        r = sv.loc[i]
        k = 10 if r.n_mineral_kg_ha < medn[i] else 0.1
        L.add("farm_survey", f"farm_survey:{r.survey_id}", "decimal_shift", r.year, "n_mineral_kg_ha", r.n_mineral_kg_ha, round(r.n_mineral_kg_ha * k, 2), "N rate ~10 x off the crop median")
        sv.loc[i, "n_mineral_kg_ha"] = r.n_mineral_kg_ha * k
    medy = sv.groupby("crop").yield_t_ha.transform("median")
    for i in sv.index[sv.yield_t_ha > 3 * medy]:
        r = sv.loc[i]
        L.add("farm_survey", f"farm_survey:{r.survey_id}", "outlier_implausible", r.year, "yield_t_ha", r.yield_t_ha, r.yield_t_ha / 10, "yield > 3 x crop median")
        sv.loc[i, "yield_t_ha"] = r.yield_t_ha / 10
    ch = raw["crop_history"]
    par = raw["parcels"].set_index("parcel_id")
    ch = ch.join(par[["area_ha", "soil_class_soilmap"]], on="parcel_id")
    ch["org_ha"] = ch.area_ha.where(ch.soil_class_soilmap.eq("organic"), 0.0)
    sh = ch.groupby(["farm_id", "year", "crop"])[["org_ha", "area_ha"]].sum()
    sh = (sh.org_ha / sh.area_ha).rename("org_share").reset_index()
    sv = sv.merge(sh, on=["farm_id", "year", "crop"], how="left")
    rep_org = sv.soil_type_reported.str.lower().str.startswith("organic")
    for r in sv[~rep_org & (sv.org_share >= SOIL_ORGANIC_SHARE)].itertuples():
        L.add("farm_survey", f"farm_survey:{r.survey_id}", "soil_misreport", r.year, "soil_type_reported", "Mineral soil",
              f"organic share {r.org_share:.2f} (soil map)", ">= 30 % of the crop area on organic soil")
    sv["organic_soil"] = rep_org | (sv.org_share >= SOIL_ORGANIC_SHARE)
    sv["kg_per_kg"] = fp(sv) / (sv.yield_t_ha * 1000)
    crop_mat = {"M100": "turnip_rape", "M110": "pea", "M111": "potato", "M112": "carrot", "M113": "spinach"}
    d = T["purchases"][T["purchases"].material_id.isin(crop_mat)].copy()
    d["crop"] = d.material_id.map(crop_mat)
    d = d.groupby(["supplier_id", "crop", "year"]).qty_kg.sum().reset_index().rename(columns={"supplier_id": "farm_id"})
    d = d.merge(sv[["farm_id", "crop", "year", "kg_per_kg"]], on=["farm_id", "crop", "year"], how="left")
    avg = sv.groupby(["crop", "year"]).kg_per_kg.median()
    d["kg_per_kg"] = d.kg_per_kg.fillna(pd.Series(list(zip(d.crop, d.year))).map(avg))
    d["tco2e"] = d.qty_kg * d.kg_per_kg / 1000
    d["region"] = "FI_SW"
    T["farm_footprints"] = d[["farm_id", "crop", "year", "region", "tco2e"]]

    # ---------- shipments: add the missing sea legs (same rule as the transport screen)
    s = T["shipments"].copy()
    sh_raw = pd.read_csv(C.D / "02_raw_feeds" / "shipments.csv", dtype={"ref_doc": str})
    erp_raw = pd.read_csv(C.D / "02_raw_feeds" / "erp_purchase_lines_2021_2025.csv", dtype={"doc_no": str})
    erp_raw["year"] = erp_raw.posting_date.str[:4].astype(int)
    miss = TR.find_missing_legs(sh_raw, erp_raw)
    if len(miss):
        for r in miss.itertuples():
            L.add("shipments", r.record_key, "missing_leg", r.year, "leg", "", f"{r.missing_ef_id} {r.est_tkm:.0f} tkm", "import lot with only a road leg")
        add = pd.DataFrame({"year": miss.year, "direction": "inbound", "ef_id": miss.missing_ef_id, "tkm": miss.est_tkm})
        T["shipments"] = pd.concat([s, add], ignore_index=True)
    return T, L


def run():
    IO, RC, F, SC, fp = _tools()
    raw = IO.load_raw(C.DATA_ROOT)
    raw["goo_reg"] = pd.read_csv(C.D / "02_raw_feeds" / "goo_registry_statement.csv")
    T, L = clean_tables(raw, IO, F, fp)
    log = pd.DataFrame(L.rows).drop_duplicates(["record_key", "issue_type"])

    checks = {}
    for y in (2023, 2024):
        s = RC.summarise(RC.compute_inventory(T, y))
        k = pd.read_csv(C.DATA_ROOT / "tasks" / "dev" / f"A2_dev_inventory_{y}.csv")
        sc = SC.score_a2(s, k)
        m = k.merge(s, on=["scope", "category"], how="left", suffixes=("_true", "_ours"))
        checks[str(y)] = {"score": sc["score"], "rows": [{"scope": r.scope, "category": r.category, "truth": r.tco2e_true, "ours": r.tco2e_ours,
                                                         "error_pct": (r.tco2e_ours / r.tco2e_true - 1) * 100 if r.tco2e_true else None} for r in m.itertuples()]}
    naive = {}
    Tn = IO.naive_canonical(raw)
    for y in (2023, 2024):
        naive[str(y)] = SC.score_a2(RC.summarise(RC.compute_inventory(Tn, y)), pd.read_csv(C.DATA_ROOT / "tasks" / "dev" / f"A2_dev_inventory_{y}.csv"))["score"]

    inv25 = RC.compute_inventory(T, 2025)
    s25 = RC.summarise(inv25)
    tpl = pd.read_csv(C.DATA_ROOT / "tasks" / "templates" / "A2_inventory_2025_submission.csv")
    val = s25.set_index(["scope", "category"]).tco2e
    notes = {"scope1": "fuel MWh x fossil EF + refrigerant top-up x GWP100", "scope2_location": "MWh x grid / heat average",
             "scope2_market": "uncovered MWh x residual mix (GoO from registry) / supplier heat EF", "scope3": "reference calculator on cleaned data",
             "total": "sum", "memo": "biogenic CO2, reported separately"}
    tpl["tco2e"] = [round(float(val.get((r.scope, r.category), np.nan)), 2) if (r.scope, r.category) in val.index else np.nan for r in tpl.itertuples()]
    tpl["method_note"] = [notes.get(r.scope, "") + "; cleaned per pipeline/inventory.py" for r in tpl.itertuples()]
    C.OUT_SUB.mkdir(parents=True, exist_ok=True)
    tpl.to_csv(C.OUT_SUB / "A2_inventory_2025_submission.csv", index=False)

    # A1 submission: 2025 issues from every table (+ year column, other years are ignored)
    a1 = log[log.year == 2025][["table", "record_key", "issue_type"]].copy()
    a1["confidence"] = 0.9
    a1["explanation"] = log[log.year == 2025].rule.values
    a1.to_csv(C.OUT_SUB / "A1_issues_submission.csv", index=False)

    dev = pd.read_csv(C.DATA_ROOT / "tasks" / "dev" / "A1_dev_issue_labels_2023_2024.csv")
    a1dev = log[log.year.isin([2023, 2024])][["table", "record_key", "issue_type"]]
    a1score = SC.score_a1(a1dev, dev)

    lines = inv25.copy()
    lines["category"] = lines.category.replace({"cat01_purchased_goods": "cat01_purchased_goods_services", "cat01_purchased_services": "cat01_purchased_goods_services"})
    top = lines.sort_values("tco2e", ascending=False)
    by_type = log[log.year == 2025].groupby(["table", "issue_type"]).size().reset_index(name="n")
    return {
        "year": 2025,
        "summary": [{"scope": r.scope, "category": r.category, "tco2e": float(r.tco2e)} for r in s25.itertuples()],
        "lines": [{"scope": r.scope, "category": r.category, "line_item": r.line_item, "tco2e": float(r.tco2e), "basis": r.basis} for r in top.itertuples()],
        "dev_check": checks, "naive_score": naive, "a1_dev": a1score,
        "issues_2025": [{"table": r.table, "issue_type": r.issue_type, "n": int(r.n)} for r in by_type.itertuples()],
        "corrections_2025": log[log.year == 2025].to_dict("records"),
        "method": {
            "steps": "raw feeds -> cleaning rules -> canonical clean tables -> reference calculator (tools/ccn_tools, docs/METHODOLOGY.md)",
            "standard": "GHG Protocol Corporate, Scope 2 and Scope 3 Standards; IPCC AR6 GWP100; operational control",
            "check": "Rules tested on the public 2023 and 2024 answers (tasks/dev) before being applied to 2025.",
            "boundary": "Foodhills (Bjuv) own operations from December 2025; Swedish grower farm emissions are not in 2025 (METHODOLOGY.md s.1).",
            "sources": ["data/02_raw_feeds/*", "data/01_master/*", "data/03_farming/farm_survey_fi.csv", "data/03_farming/parcel_crop_history_and_plan.csv",
                        "data/01_master/parcels.csv (soil map)", "tools/ccn_tools/reference_calculator.py"],
        },
    }

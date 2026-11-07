"""Track C: climate risk to farming (C1 yields 2027-2031, C2 risk 2041-2060, C3 euro risk).

Model: one ridge regression per (region, crop) on monthly weather of the growing
season (May-August), irrigation and a technology trend, plus a shrunken farm effect.
Training data: farm_survey_fi.csv (FI) and foodhills_odlingsdata_se.csv (SE), 2012-2026.
"""
import numpy as np
import pandas as pd

from . import config as C
from . import audit

MONTHS = [5, 6, 7, 8]
VARS = ["tmean_c", "precip_mm", "pet_mm", "hot_days_tmax_ge_27"]
FARM_SHRINK_K = 3.0
RIDGE_LAMBDA = 3.0
TREND_YEAR_FIXED = 2025   # C2: "current irrigation and management" -> hold technology at 2025


# ------------------------------------------------------------------ data
def load_weather():
    w = pd.read_csv(C.D / "04_climate" / "weather_monthly_1991_2060.csv")
    w = w[w.month.isin(MONTHS)]
    wide = w.pivot_table(index=["cell_id", "scenario", "year"], columns="month", values=VARS)
    wide.columns = [f"{v}_m{m}" for v, m in wide.columns]
    wide = wide.reset_index()
    for m in MONTHS:
        wide[f"wb_m{m}"] = wide[f"precip_mm_m{m}"] - wide[f"pet_mm_m{m}"]
    return wide


def farm_cells():
    fr = pd.read_csv(C.D / "01_master" / "farm_registry.csv")
    cells = pd.read_csv(C.D / "01_master" / "climate_grid_cells.csv")
    out = []
    for _, f in fr.iterrows():
        cc = cells[cells.region == f.region]
        d = (cc.lat - f.lat) ** 2 + ((cc.lon - f.lon) * np.cos(np.radians(f.lat))) ** 2
        out.append((f.farm_id, f.region, cc.loc[d.idxmin(), "cell_id"]))
    return pd.DataFrame(out, columns=["farm_id", "region", "cell_id"])


def load_yields():
    """Observed farm yields. Implausible values are removed and logged (not silently)."""
    fs = pd.read_csv(C.D / "03_farming" / "farm_survey_fi.csv")
    med = fs.groupby("crop").yield_t_ha.transform("median")
    bad = fs[(fs.yield_t_ha > 3 * med) | (fs.yield_t_ha <= 0)]
    for _, r in bad.iterrows():
        audit.log(f"farm_survey:{r.survey_id}", "yield_t_ha", r.yield_t_ha, None,
                  "rule: yield > 3 x crop median -> excluded from yield model",
                  f"crop median {med[r.name]:.2f} t/ha; likely unit/decimal error "
                  "(issue types unit_error / outlier_implausible, TASKS_AND_SCORING.md)")
    fs = fs.drop(bad.index)
    fi = fs[["farm_id", "crop", "year", "area_ha", "irrigated", "yield_t_ha"]].copy()
    fi["region"] = "FI_SW"

    se = pd.read_csv(C.D / "03_farming" / "foodhills_odlingsdata_se.csv", sep=";", decimal=",")
    audit.log("foodhills_odlingsdata_se.csv", "format", "sep=';' decimal=','", "parsed",
              "parser setting", "docs/AZURE_FABRIC_QUICKSTART.md: Foodhills file uses ';' and decimal comma")
    se = se.rename(columns={"odlar_id": "farm_id", "skördeår": "year", "areal_ha": "area_ha"})
    se["crop"] = "pea"
    se["irrigated"] = se["bevattnad"].str.lower().eq("ja")
    se["yield_t_ha"] = se["levererad_mängd_ton"] / se["area_ha"]
    se = se[(se.area_ha > 0) & se.yield_t_ha.between(0.1, 15)]
    se["region"] = "SE_SKANE"
    cols = ["farm_id", "region", "crop", "year", "area_ha", "irrigated", "yield_t_ha"]
    y = pd.concat([fi[cols], se[cols]], ignore_index=True)
    y["irrigated"] = y["irrigated"].astype(bool)
    return y


# ------------------------------------------------------------------ model
def feature_cols(df):
    return [c for c in df.columns if any(c.startswith(v) for v in VARS + ["wb"]) and "_m" in c]


def design(df, fcols):
    X = df[fcols].to_numpy(float)
    dry = np.minimum(df[[f"wb_m{m}" for m in (6, 7)]].to_numpy(float), 0).sum(1)
    irr = df["irrigated"].to_numpy(float)
    extra = np.column_stack([irr, irr * dry, dry, df["year"].to_numpy(float) - 2020])
    return np.column_stack([X, extra])


class RidgeYield:
    def __init__(self, lam=None):
        self.lam = RIDGE_LAMBDA if lam is None else lam

    def fit(self, df, fcols):
        self.fcols = fcols
        X = design(df, fcols)
        self.mu, self.sd = X.mean(0), X.std(0) + 1e-9
        Z = (X - self.mu) / self.sd
        y = np.log(df.yield_t_ha.to_numpy(float))
        self.b0 = y.mean()
        A = Z.T @ Z + self.lam * np.eye(Z.shape[1])
        self.b = np.linalg.solve(A, Z.T @ (y - self.b0))
        res = y - self.predict_log(df, farm=False)
        g = pd.DataFrame({"farm_id": df.farm_id.values, "r": res}).groupby("farm_id").r
        self.farm = (g.sum() / (g.count() + FARM_SHRINK_K)).to_dict()
        self.sigma = float(np.std(res))
        return self

    def predict_log(self, df, farm=True):
        Z = (design(df, self.fcols) - self.mu) / self.sd
        p = self.b0 + Z @ self.b
        if farm:
            p = p + df.farm_id.map(self.farm).fillna(0.0).to_numpy(float)
        return p

    def predict(self, df, farm=True):
        return np.exp(self.predict_log(df, farm))


def wsum(df, by, val, w="area_ha"):
    t = df.assign(_p=df[w] * df[val]).groupby(by)["_p"].sum()
    return t


LAMBDAS = [3.0, 30.0, 300.0, 1000.0]


def rolling_mape(g, fcols, lam):
    errs = []
    for split in sorted(g.year.unique())[-5:-1]:
        tr, te = g[g.year <= split], g[g.year == split + 1]
        if len(tr) < 30 or len(te) == 0:
            continue
        p = RidgeYield(lam).fit(tr, fcols).predict(te)
        errs.append(abs((te.area_ha * p).sum() / (te.area_ha * te.yield_t_ha).sum() - 1))
    return float(np.mean(errs)) if errs else np.inf


def attach_weather(df, weather, cells, scenario_of_year):
    d = df.merge(cells[["farm_id", "cell_id"]], on="farm_id", how="left")
    d["scenario"] = d["year"].map(scenario_of_year)
    return d.merge(weather, on=["cell_id", "scenario", "year"], how="left")


def hist_or(scen):
    return lambda y: "historical" if y <= 2026 else scen


# ------------------------------------------------------------------ main
def run():
    weather = load_weather()
    cells = farm_cells()
    obs = load_yields()
    obs = attach_weather(obs, weather, cells, hist_or("ssp245"))
    obs = obs.dropna(subset=["tmean_c_m6"])
    fcols = feature_cols(weather)

    models, backtest, lam_used = {}, [], {}
    for (reg, crop), g in obs.groupby(["region", "crop"]):
        lam = min(LAMBDAS, key=lambda l: rolling_mape(g, fcols, l))
        lam_used[(reg, crop)] = lam
        tr, te = g[g.year <= 2022], g[g.year >= 2023]
        if len(tr) > 30 and len(te) > 5:
            m = RidgeYield(lam).fit(tr, fcols)
            te = te.assign(p=m.predict(te))
            base = te.farm_id.map(tr.groupby("farm_id").yield_t_ha.mean()).fillna(tr.yield_t_ha.mean())
            te = te.assign(b=base.values)
            truth = wsum(te, "year", "yield_t_ha")
            mp, mb = wsum(te, "year", "p"), wsum(te, "year", "b")
            backtest.append({
                "region": reg, "crop": crop, "n_test": int(len(te)), "ridge_lambda": lam,
                "test_years": "2023-2026 (trained on 2012-2022)",
                "model_mape_pct": round(float((abs(mp - truth) / truth).mean() * 100), 1),
                "baseline_mape_pct": round(float((abs(mb - truth) / truth).mean() * 100), 1),
                "model_nrmse": round(float(np.sqrt(((te.p - te.yield_t_ha) ** 2).mean()) / te.yield_t_ha.mean()), 3),
                "baseline_nrmse": round(float(np.sqrt(((te.b - te.yield_t_ha) ** 2).mean()) / te.yield_t_ha.mean()), 3),
            })
        models[(reg, crop)] = RidgeYield(lam).fit(g, fcols)
    n_irrigated = obs.groupby(["region", "crop"]).irrigated.sum().to_dict()

    # current irrigation per farm and crop = latest observed status
    irr_now = obs.sort_values("year").groupby(["farm_id", "crop"]).irrigated.last()

    # ---------------- C1
    tpl = pd.read_csv(C.DATA_ROOT / "tasks" / "templates" / "C1_yields_2027_2031_submission.csv")
    t = tpl.drop(columns=["yield_t_ha_pred"])
    t["irrigated"] = [bool(irr_now.get((f, c), False)) for f, c in zip(t.farm_id, t.crop)]
    t = attach_weather(t, weather, cells, hist_or("ssp245"))
    t["yield_t_ha_pred"] = np.nan
    for (reg, crop), idx in t.groupby(["region", "crop"]).groups.items():
        t.loc[idx, "yield_t_ha_pred"] = models[(reg, crop)].predict(t.loc[idx])
    c1 = tpl.drop(columns=["yield_t_ha_pred"]).assign(yield_t_ha_pred=t["yield_t_ha_pred"].round(3).values)
    assert c1.yield_t_ha_pred.notna().all(), "C1 has missing predictions"
    c1.to_csv(C.OUT_SUB / "C1_yields_2027_2031_submission.csv", index=False)

    # ---------------- C2 + C3
    ch = pd.read_csv(C.D / "03_farming" / "parcel_crop_history_and_plan.csv")
    parcels = pd.read_csv(C.D / "01_master" / "parcels.csv", usecols=["parcel_id", "area_ha"])
    mix = ch[(ch.year == 2025) & ch.crop.isin(C.APETIT_CROPS)].merge(parcels, on="parcel_id")
    mix = mix.merge(cells[["farm_id", "region"]], on="farm_id")
    mix = mix.groupby(["region", "crop", "farm_id"], as_index=False).area_ha.sum()

    prices = pd.read_csv(C.D / "05_scenarios" / "contract_prices_and_replacement_premiums.csv")
    p26 = prices[prices.year == 2026].set_index("item")

    c2_tpl = pd.read_csv(C.DATA_ROOT / "tasks" / "templates" / "C2_climate_yield_risk_submission.csv")
    c2_rows, risk, series = [], [], []
    for (reg, crop), g in mix.groupby(["region", "crop"]):
        m = models[(reg, crop)]
        area = g.set_index("farm_id").area_ha
        def regional(years, scen, irrigate_all=False):
            rows = pd.DataFrame([(f, y) for f in area.index for y in years], columns=["farm_id", "year"])
            rows["irrigated"] = True if irrigate_all else [bool(irr_now.get((f, crop), False)) for f in rows.farm_id]
            rows = attach_weather(rows, weather, cells, lambda y: scen)
            yr = rows["year"].copy()
            rows["year"] = TREND_YEAR_FIXED
            rows["y"] = m.predict(rows)
            rows["year"] = yr
            rows["a"] = rows.farm_id.map(area)
            return wsum(rows, "year", "y", w="a") / rows.groupby("year").a.sum()
        base = regional(range(C.BASE_PERIOD[0], C.BASE_PERIOD[1] + 1), "historical")
        base_mean = float(base.mean())
        item = "pea_SE" if reg == "SE_SKANE" else crop
        price, prem = float(p26.loc[item, "contract_price_eur_t"]), float(p26.loc[item, "replacement_import_premium_frac"])
        total_area = float(area.sum())
        for scen in C.SCENARIOS:
            fut = regional(range(C.FUTURE_PERIOD[0], C.FUTURE_PERIOD[1] + 1), scen)
            fut_irr = regional(range(C.FUTURE_PERIOD[0], C.FUTURE_PERIOD[1] + 1), scen, irrigate_all=True)
            chg = (fut.mean() / base_mean - 1) * 100
            pbad = float((fut < C.BAD_YEAR_FRACTION * base_mean).mean())
            c2_rows.append({"region": reg, "crop": crop, "scenario": scen, "period": "2041-2060",
                            "mean_yield_change_pct": round(float(chg), 2), "p_bad_year": round(pbad, 3)})
            # C3: shortfall volume x contract price x replacement premium (SCENARIOS_AND_RISK.md)
            short_t = float(np.maximum(base_mean - fut, 0).mean() * total_area)
            short_irr = float(np.maximum(base_mean - fut_irr, 0).mean() * total_area)
            eur = short_t * price * prem
            eur_irr = short_irr * price * prem
            irr_ok = n_irrigated.get((reg, crop), 0) >= 20
            risk.append({
                "region": reg, "crop": crop, "scenario": scen,
                "area_ha_2025": round(total_area, 1), "base_yield_t_ha": round(base_mean, 2),
                "future_yield_t_ha": round(float(fut.mean()), 2),
                "mean_yield_change_pct": round(float(chg), 1), "p_bad_year": round(pbad, 3),
                "expected_shortfall_t_per_yr": round(short_t, 0),
                "contract_price_eur_t": price, "replacement_premium_frac": prem,
                "eur_risk_per_yr": round(eur, 0),
                "eur_saved_by_irrigation_per_yr": round(max(eur - eur_irr, 0.0), 0) if irr_ok else None,
                "irrigation_note": "model estimate from irrigated vs non-irrigated history" if irr_ok
                    else "not enough irrigated fields in the history to estimate",
                "formula": "expected shortfall (t/yr) x contract price 2026 (EUR/t) x replacement import premium",
                "sources": ["data/03_farming/farm_survey_fi.csv", "data/03_farming/foodhills_odlingsdata_se.csv",
                            "data/04_climate/weather_monthly_1991_2060.csv",
                            "data/03_farming/parcel_crop_history_and_plan.csv (2025 contract mix)",
                            f"data/05_scenarios/contract_prices_and_replacement_premiums.csv (2026, item {item})"],
                "assumptions": ["2025 contract-parcel mix and current irrigation held fixed",
                                "technology trend held at 2025 level",
                                "one weather realisation per SSP (ASSUMPTIONS_AND_LIMITATIONS.md)",
                                "no CO2 fertilisation, no new varieties"],
            })
            for y, v in fut.items():
                series.append({"region": reg, "crop": crop, "scenario": scen, "year": int(y), "yield_t_ha": round(float(v), 3)})
        for y, v in base.items():
            series.append({"region": reg, "crop": crop, "scenario": "historical", "year": int(y), "yield_t_ha": round(float(v), 3)})

    c2 = c2_tpl[["region", "crop", "scenario", "period"]].merge(pd.DataFrame(c2_rows), on=["region", "crop", "scenario", "period"], how="left")
    assert c2[["mean_yield_change_pct", "p_bad_year"]].notna().all().all(), "C2 has missing rows"
    c2.to_csv(C.OUT_SUB / "C2_climate_yield_risk_submission.csv", index=False)

    # C1 summary for the app: production by region x crop x year
    c1s = c1.assign(prod_t=c1.area_ha * c1.yield_t_ha_pred).groupby(["region", "crop", "year"], as_index=False) \
            .agg(area_ha=("area_ha", "sum"), production_t=("prod_t", "sum"))
    c1s["yield_t_ha"] = (c1s.production_t / c1s.area_ha).round(2)
    c1s = c1s.round({"area_ha": 1, "production_t": 0})
    hist = obs.assign(p=obs.area_ha * obs.yield_t_ha).groupby(["region", "crop", "year"], as_index=False) \
              .agg(a=("area_ha", "sum"), p=("p", "sum"))
    hist["yield_t_ha"] = (hist.p / hist.a).round(2)

    return {
        "risk": risk, "series": series, "backtest": backtest,
        "c1_summary": c1s.to_dict("records"),
        "observed_yield": hist[["region", "crop", "year", "yield_t_ha"]].to_dict("records"),
        "method": {
            "model": "Ridge regression on log yield per region x crop: May-August monthly temperature, rain, "
                     "PET, water balance, hot days (Tmax >= 27 C), irrigation x drought, technology trend; "
                     "plus a shrunken farm effect.",
            "c1": "Weather 2027-2031 = scenario ssp245 (TASKS_AND_SCORING.md C1).",
            "c2": "Change of 2041-2060 mean vs 1991-2020 mean; p_bad_year = share of years below 80 % of the "
                  "1991-2020 mean (TASKS_AND_SCORING.md C2).",
            "c3": "EUR risk = shortfall volume x contract price x replacement premium (SCENARIOS_AND_RISK.md).",
            "standards": "SSP1-2.6 / SSP2-4.5 / SSP5-8.5 climate scenarios (FMI CMIP6 signals in the package).",
        },
    }

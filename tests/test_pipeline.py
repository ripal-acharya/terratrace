"""Run after `python3 run_all.py`:   python3 -m unittest discover -s tests -v"""
import csv
import json
import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "app" / "data"
SUB = ROOT / "submissions"
sys.path.insert(0, str(ROOT))
from pipeline import config as C  # noqa: E402


def load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def rows(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


class TestFormulas(unittest.TestCase):
    def test_transport_formula_by_hand(self):
        # 1000 tkm by diesel truck x 0.092 kg/tkm = 92 kg = 0.092 t
        t = load("transport.json")
        self.assertAlmostEqual(1000 * t["factors"]["EF-TKM-TRUCK"]["kg_per_tkm"] / 1000, 0.092)

    def test_transport_matches_public_dev_inventory(self):
        t = load("transport.json")
        for y, k in t["dev_inventory_check"].items():
            self.assertLess(abs(k["cat4_ours"] - k["cat4_truth"]) / k["cat4_truth"], 0.01, f"cat4 {y}")
            self.assertLess(abs(k["cat9_ours"] - k["cat9_truth"]) / k["cat9_truth"], 0.01, f"cat9 {y}")

    def test_missing_legs_on_dev_labels(self):
        d = load("transport.json")["dev_check"]
        self.assertEqual(d["correct"], d["true_labels"])

    def test_c3_euro_formula(self):
        for r in load("climate.json")["risk"]:
            exp = r["expected_shortfall_t_per_yr"] * r["contract_price_eur_t"] * r["replacement_premium_frac"]
            self.assertLess(abs(exp - r["eur_risk_per_yr"]), 0.6 * r["contract_price_eur_t"] + 1)

    def test_d1_priority_formula(self):
        n = load("nature.json")["catchments"]
        P = sorted(c["p_kg"] for c in n if c["p_kg"] > 0)
        N = sorted(c["n_kg"] for c in n if c["n_kg"] > 0)

        def med(v):
            return (v[len(v) // 2] + v[(len(v) - 1) // 2]) / 2
        for c in n[:5]:
            exp = (c["p_kg"] / med(P) + 0.5 * c["n_kg"] / med(N)) * C.STATE_WEIGHT[c["status"]] * c["p_sensitivity"]
            self.assertAlmostEqual(exp, c["priority_score"], delta=0.05)
        self.assertEqual([c["rank"] for c in n], sorted(c["rank"] for c in n))


class TestSubmissions(unittest.TestCase):
    def check(self, name, value_cols):
        tpl = rows(C.DATA_ROOT / "tasks" / "templates" / name)
        sub = rows(SUB / name)
        self.assertEqual(len(sub), len(tpl), name)
        self.assertEqual(list(sub[0].keys()), list(tpl[0].keys()), name)
        for r in sub:
            for c in value_cols:
                self.assertTrue(math.isfinite(float(r[c])), f"{name} {c}")

    def test_c1(self):
        self.check("C1_yields_2027_2031_submission.csv", ["yield_t_ha_pred"])

    def test_c2(self):
        self.check("C2_climate_yield_risk_submission.csv", ["mean_yield_change_pct", "p_bad_year"])
        for r in rows(SUB / "C2_climate_yield_risk_submission.csv"):
            self.assertTrue(0 <= float(r["p_bad_year"]) <= 1)

    def test_d1(self):
        self.check("D1_catchment_priority_submission.csv", ["apetit_p_to_water_kg", "apetit_n_to_water_kg", "priority_rank"])
        ranks = sorted(int(r["priority_rank"]) for r in rows(SUB / "D1_catchment_priority_submission.csv"))
        self.assertEqual(ranks, list(range(1, len(ranks) + 1)))

    def test_a1_columns(self):
        tpl = rows(C.DATA_ROOT / "tasks" / "templates" / "A1_issues_submission.csv")
        with open(SUB / "A1_issues_submission.csv", newline="", encoding="utf-8") as f:
            header = next(csv.reader(f))
        with open(C.DATA_ROOT / "tasks" / "templates" / "A1_issues_submission.csv", newline="", encoding="utf-8") as f:
            self.assertEqual(header, next(csv.reader(f)))
        del tpl


class TestAppData(unittest.TestCase):
    def test_json_is_strict(self):
        for p in DATA.glob("*.json"):
            json.loads(p.read_text(encoding="utf-8"), parse_constant=lambda x: self.fail(f"{p.name} has {x}"))

    def test_backtest_beats_baseline(self):
        for b in load("climate.json")["backtest"]:
            self.assertLessEqual(b["model_mape_pct"], b["baseline_mape_pct"], f"{b['region']} {b['crop']}")

    def test_actions_have_owner_and_evidence(self):
        for a in load("actions.json")["actions"]:
            self.assertTrue(a["owner"] and a["evidence"] and a["next_week"] and a["sources"])

    def test_corrections_have_audit_fields(self):
        c = load("corrections.json")
        self.assertEqual(c["fields"], ["record_key", "field", "old_value", "new_value", "rule_or_model",
                                       "evidence", "proposed_by", "approved_by", "timestamp"])
        for e in c["entries"]:
            self.assertEqual(set(e.keys()), set(c["fields"]))
            self.assertIsNone(e["approved_by"])  # nothing is approved until a person does it

    def test_no_secrets_in_code(self):
        files = list(ROOT.glob("*.py")) + list((ROOT / "app").glob("*.*")) + list((ROOT / "pipeline").glob("*.py"))
        for p in files:
            txt = p.read_text(encoding="utf-8", errors="ignore")
            self.assertNotRegex(txt, r"rc_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}", p.name)

    def test_no_innerhtml_in_frontend(self):
        js = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
        self.assertNotRegex(js, r"\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(")


if __name__ == "__main__":
    unittest.main()

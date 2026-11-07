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


class TestSecurity(unittest.TestCase):
    def test_password_hashing(self):
        import server
        rec = server.hash_password("correct horse battery")
        self.assertTrue(server.verify_password("correct horse battery", rec))
        self.assertFalse(server.verify_password("wrong", rec))
        self.assertNotIn("correct horse", json.dumps(rec))
        self.assertGreaterEqual(rec["iter"], 200000)

    def test_audit_chain_detects_tampering(self):
        import server
        entries, prev = [], "0" * 64
        import hashlib
        for i in range(3):
            e = {"record_key": f"action:A{i}", "new_value": "approved", "prev_hash": prev}
            e["hash"] = hashlib.sha256(json.dumps(e, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            prev = e["hash"]
            entries.append(e)
        self.assertTrue(server.chain_ok(entries))
        entries[1]["new_value"] = "rejected"
        self.assertFalse(server.chain_ok(entries))

    def test_roles_need_to_know(self):
        import server
        self.assertFalse(server.can(["viewer"], "review"))
        self.assertFalse(server.can(["admin"], "see_farm"))
        self.assertTrue(server.can(["farm_advisor"], "see_farm"))
        self.assertTrue(server.can(["reviewer"], "review"))
        self.assertTrue(server.is_farm_key("corr:farm_survey:FS00012"))
        self.assertFalse(server.is_farm_key("action:A1"))

    def test_data_not_served_as_static_files(self):
        src = (ROOT / "server.py").read_text(encoding="utf-8")
        self.assertIn('path.startswith("/data/")', src)
        self.assertIn("HttpOnly; SameSite=Strict", src)
        self.assertIn('HOST = "127.0.0.1"', src)

    def test_review_keys_and_final_decisions(self):
        import server
        keys = server.known_review_keys()
        self.assertIn("action:A1", keys)
        self.assertNotIn("action:FAKE", keys)
        src = (ROOT / "server.py").read_text(encoding="utf-8")
        self.assertIn("_review_lock", src)          # check + write is one step
        self.assertIn("self._json(409", src)        # a second decision is refused
        self.assertIn('"Unknown result."', src)     # made-up keys are refused


class TestMcpAndSigning(unittest.TestCase):
    def _rpc(self, *msgs):
        import subprocess, sys as _s
        inp = "\n".join(json.dumps(m) for m in msgs) + "\n"
        out = subprocess.run([_s.executable, str(ROOT / "mcp_server.py")], input=inp, capture_output=True, text=True, timeout=60).stdout
        return [json.loads(l) for l in out.splitlines() if l.strip()]

    def test_mcp_tools_are_read_only_and_approved_only(self):
        r = self._rpc({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
                      {"jsonrpc": "2.0", "method": "notifications/initialized"},
                      {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                      {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "list_next_week_actions", "arguments": {}}},
                      {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "approve", "arguments": {}}})
        by = {m["id"]: m for m in r}
        self.assertEqual(by[1]["result"]["serverInfo"]["name"], "terratrace")
        tools = by[2]["result"]["tools"]
        self.assertTrue(all(t["annotations"]["readOnlyHint"] for t in tools))
        self.assertFalse(any(w in t["name"] for t in tools for w in ("approve", "reject", "write", "delete", "update")))
        for res in by[3]["result"]["structuredContent"]["results"]:
            self.assertEqual(res["review"]["status"], "approved")
        self.assertIn("error", by[4])
        self.assertNotIn("farm_survey", json.dumps(r))

    def test_signature_detects_tampering(self):
        try:
            import cryptography  # noqa: F401
        except ImportError:
            self.skipTest("cryptography not installed")
        import base64, signing
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        key = Ed25519PrivateKey.generate()
        man = {"format": signing.FORMAT, "files": [{"path": "x", "sha256": "a" * 64}]}
        sig = key.sign(signing.canonical(man))
        key.public_key().verify(sig, signing.canonical(man))
        man["files"][0]["sha256"] = "b" * 64
        with self.assertRaises(Exception):
            key.public_key().verify(sig, signing.canonical(man))


class TestPathways(unittest.TestCase):
    """B1/B2/D2 output (app/data/pathways.json)."""

    @classmethod
    def setUpClass(cls):
        cls.p = json.loads((ROOT / "app" / "data" / "pathways.json").read_text(encoding="utf-8"))

    def test_sbti_rates_and_linear_target(self):
        pw = self.p["pathway"]
        y0, rates = pw["years"][0], {"s12": 0.042, "s3": 0.025, "flag": 0.0303}
        i = pw["years"].index(pw["target_year"])
        for b, r in rates.items():
            self.assertAlmostEqual(pw["target"][b][i], pw["base"][b] * (1 - r * (pw["target_year"] - y0)), places=3)

    def test_flag_split_adds_up(self):
        f, inv = self.p["flag"], self.p["inventory"]
        self.assertTrue(0 < f["flag_share_of_cat01"] < 1)
        self.assertAlmostEqual(f["flag_tco2e"] + f["scope3_non_flag_tco2e"], inv["scope3"], places=3)
        # the quick category 1 estimate from ERP x factors should be close to the inventory (sanity check)
        self.assertLess(abs(f["cat01_quick_estimate"] / f["cat01_from_inventory"] - 1), 0.10)

    def test_measurement_and_structural_levers_are_not_reductions(self):
        lv = {l["lever_id"]: l for l in self.p["levers"]}
        for k in ("L05", "L26", "L27"):
            self.assertFalse(lv[k]["in_pathway"], k)
        self.assertFalse(lv["L07"]["in_pathway"])          # Bjuv is outside the 2024 base
        self.assertEqual(lv["L27"]["kind"], "measurement")

    def test_pathway_never_below_zero_and_delay_is_worse(self):
        sc = self.p["pathway"]["scenarios"]
        for k in sc:
            for b, ser in sc[k]["series"].items():
                self.assertTrue(all(v >= 0 for v in ser))
        i = self.p["pathway"]["years"].index(2030)
        for b in ("s12", "s3", "flag"):
            self.assertGreaterEqual(sc["delayed_transition"]["series"][b][i], sc["below_2c"]["series"][b][i])

    def test_screening_rows_have_priority(self):
        rows = self.p["screening"]["rows"]
        self.assertTrue(rows)
        self.assertTrue(all(r["priority"] in ("high", "medium", "low", "not screened") for r in rows))
        soy = [r for r in rows if r["material_id"] == "M130"]
        self.assertTrue(soy and soy[0]["priority"] == "high" and soy[0]["high_impact"])

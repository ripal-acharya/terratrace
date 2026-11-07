"""TerraTrace MCP server (Model Context Protocol, stdio, no extra packages).

Lets an AI agent (Microsoft Copilot Studio, Claude Desktop, any MCP client) read
TerraTrace results in a controlled way:
  * every tool is READ-ONLY – an agent can never change data or approve anything;
  * by default only results APPROVED by a human reviewer are returned;
  * every answer carries its review status, formula and source files;
  * farm-level data is never exposed (need-to-know);
  * every call is written to a hash-chained access log (instance/mcp_access_log.jsonl);
  * one tool checks the Ed25519-signed release (signing.py).

Run by an MCP client, e.g. Claude Desktop config:
  {"mcpServers": {"terratrace": {"command": "python3", "args": ["/full/path/mcp_server.py"]}}}
"""
import contextlib
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
with contextlib.redirect_stdout(sys.stderr):  # stdout is reserved for the protocol
    import server  # noqa: E402

PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]
ACCESS_LOG = server.INSTANCE / "mcp_access_log.jsonl"
REGION = {"fi": "FI_SW", "finland": "FI_SW", "fi_sw": "FI_SW", "se": "SE_SKANE", "sweden": "SE_SKANE", "se_skane": "SE_SKANE"}
SCEN = {"ssp126": "ssp126", "ssp1-2.6": "ssp126", "ssp245": "ssp245", "ssp2-4.5": "ssp245", "ssp585": "ssp585", "ssp5-8.5": "ssp585"}
NOTE = "Synthetic data (Since AI / Apetit package). Read-only. Drafts are not approved for use."

APPROVED_ONLY = {"type": "boolean", "default": True,
                 "description": "Return only results approved by a human reviewer (default true). Set false to also see drafts, clearly marked."}
TOOLS = [
    {"name": "list_next_week_actions", "title": "Next-week actions",
     "description": "Apetit's recommended actions for next week, each with euros, tonnes CO2e, owner, first step, evidence and review status.",
     "inputSchema": {"type": "object", "properties": {"approved_only": APPROVED_ONLY}}},
    {"name": "get_climate_risk", "title": "Climate yield risk in euros",
     "description": "Yield change, bad-year probability, shortfall and euro risk per crop and region for 2041-2060 vs 1991-2020 under an SSP scenario.",
     "inputSchema": {"type": "object", "properties": {
         "crop": {"type": "string", "description": "pea, potato, carrot, spinach or turnip_rape (optional)"},
         "region": {"type": "string", "description": "Finland (FI_SW) or Sweden (SE_SKANE) (optional)"},
         "scenario": {"type": "string", "default": "ssp245", "description": "ssp126, ssp245 or ssp585"},
         "approved_only": APPROVED_ONLY}}},
    {"name": "get_nature_priorities", "title": "SBTN catchment priorities",
     "description": "Catchments ranked by phosphorus and nitrogen pressure times state of nature (SBTN step 2).",
     "inputSchema": {"type": "object", "properties": {"top": {"type": "integer", "default": 5, "minimum": 1, "maximum": 50},
                                                      "approved_only": APPROVED_ONLY}}},
    {"name": "get_transport_emissions", "title": "Transport CO2e (Scope 3 cat 4 and 9)",
     "description": "Transport emissions for one year: category 4 and 9, warehousing, missing sea legs added, and CO2e by mode.",
     "inputSchema": {"type": "object", "properties": {"year": {"type": "integer", "default": 2025, "minimum": 2021, "maximum": 2025},
                                                      "approved_only": APPROVED_ONLY}}},
    {"name": "verify_signed_release", "title": "Verify signed results",
     "description": "Check the Ed25519 signature of the TerraTrace release and that no result file changed since it was signed.",
     "inputSchema": {"type": "object", "properties": {}}},
]
for t in TOOLS:
    t["annotations"] = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}


def reviews():
    return server.current_reviews(["reviewer"])  # no farm-level keys (need-to-know)


def review_of(key, rv):
    r = rv.get(key)
    return {"status": r["status"], "by": r["by"], "at": r["ts"]} if r else {"status": "draft"}


def pick(items, approved_only):
    """items: list of (key, payload). Keeps approved ones (or all, marked)."""
    rv, out, held = reviews(), [], 0
    for key, payload in items:
        rev = review_of(key, rv)
        if rev["status"] == "rejected":
            held += 1
            continue
        if approved_only and rev["status"] != "approved":
            held += 1
            continue
        out.append({"record_key": key, "review": rev, **payload})
    return out, held


def wrap(results, held, approved_only, source):
    msg = None
    if approved_only and held and not results:
        msg = f"No approved results yet. {held} result(s) are waiting for expert review in TerraTrace."
    elif held:
        msg = f"{held} result(s) not shown because they are not approved (draft or rejected)."
    return {"results": results, "withheld": held, "message": msg, "source": source, "note": NOTE}


def t_actions(a):
    ap = a.get("approved_only", True) is not False
    ac = server.read_json("actions.json") or {"actions": []}
    items = [(f"action:{x['id']}", {k: x.get(k) for k in ("priority", "action", "area", "eur_per_yr", "eur_label", "tco2e", "owner", "next_week", "evidence", "sources")})
             for x in ac["actions"]]
    res, held = pick(items, ap)
    return wrap(res, held, ap, "app/data/actions.json (TerraTrace pipeline, run_all.py)")


def t_climate(a):
    ap = a.get("approved_only", True) is not False
    scen = SCEN.get(str(a.get("scenario", "ssp245")).lower(), "ssp245")
    crop = str(a.get("crop") or "").lower().replace(" ", "_") or None
    region = REGION.get(str(a.get("region") or "").lower()) if a.get("region") else None
    cl = server.read_json("climate.json") or {"risk": []}
    rows = [r for r in cl["risk"] if r["scenario"] == scen and (not crop or r["crop"] == crop) and (not region or r["region"] == region)]
    fields = ("region", "crop", "scenario", "mean_yield_change_pct", "p_bad_year", "expected_shortfall_t_per_yr", "contract_price_eur_t",
              "replacement_premium_frac", "eur_risk_per_yr", "eur_saved_by_irrigation_per_yr", "formula", "sources", "assumptions")
    items = [(f"risk:{r['region']}:{r['crop']}:{r['scenario']}", {k: r.get(k) for k in fields}) for r in rows]
    res, held = pick(items, ap)
    out = wrap(res, held, ap, "app/data/climate.json -> risk (2041-2060 vs 1991-2020)")
    out["period"] = "2041-2060 vs 1991-2020"
    return out


def t_nature(a):
    ap = a.get("approved_only", True) is not False
    top = max(1, min(50, int(a.get("top", 5) or 5)))
    na = server.read_json("nature.json") or {"catchments": []}
    rows = sorted(na["catchments"], key=lambda c: c.get("rank", 9999))
    fields = ("catchment_id", "region", "rank", "p_kg", "n_kg", "priority_score", "status", "state_weight", "p_sensitivity", "contract_area_ha")
    items = [(f"nature:{c['catchment_id']}", {k: c.get(k) for k in fields}) for c in rows]
    res, held = pick(items, ap)
    out = wrap(res[:top], held, ap, "app/data/nature.json -> catchments (SBTN step 2)")
    out["formula"] = "(P/median P + 0.5 x N/median N) x state-of-nature weight x P sensitivity"
    return out


def t_transport(a):
    ap = a.get("approved_only", True) is not False
    year = int(a.get("year", 2025) or 2025)
    tr = server.read_json("transport.json") or {"summary": [], "by_mode": []}
    sm = next((s for s in tr["summary"] if s["year"] == year), None)
    if not sm:
        return wrap([], 0, ap, "app/data/transport.json") | {"message": f"No transport data for {year}."}
    modes = {}
    for r in tr["by_mode"]:
        if r["year"] == year:
            modes[r["mode"]] = round(modes.get(r["mode"], 0) + r["tco2e"], 1)
    res, held = pick([(f"transport:{year}", {**sm, "tco2e_by_mode": modes})], ap)
    return wrap(res, held, ap, "app/data/transport.json (shipments.csv x well-to-wheel factors + frozen warehousing)")


def t_verify(_a):
    import signing
    r = signing.verify()
    changed = [f["path"] for f in r.get("files", []) if f["state"] != "OK"]
    return {"ok": r.get("ok"), "signature_valid": r.get("signature_valid"), "signed_at": r.get("signed_at"),
            "approved_results_in_release": r.get("approved_results"), "audit_log_continues": r.get("audit_continues"),
            "changed_or_missing_files": changed, "key_fingerprint": r.get("key_fingerprint"), "error": r.get("error"),
            "summary": ("All result files match the signed release." if r.get("ok") else "Verification FAILED: results changed after signing, or no release.")}


HANDLERS = {"list_next_week_actions": t_actions, "get_climate_risk": t_climate, "get_nature_priorities": t_nature,
            "get_transport_emissions": t_transport, "verify_signed_release": t_verify}


def log_access(tool, args, n):
    try:
        server.INSTANCE.mkdir(exist_ok=True)
        prev = "0" * 64
        if ACCESS_LOG.exists():
            lines = ACCESS_LOG.read_text(encoding="utf-8").strip().splitlines()
            if lines:
                prev = json.loads(lines[-1]).get("hash", prev)
        e = {"timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "client": "mcp", "tool": tool,
             "arguments": args, "results_returned": n, "prev_hash": prev}
        e["hash"] = hashlib.sha256(json.dumps(e, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        with open(ACCESS_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
    except Exception as ex:  # logging must never break an answer
        print(f"access log error: {ex}", file=sys.stderr)


def handle(msg):
    method, mid, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
    if mid is None:  # notification (e.g. notifications/initialized): no reply
        return None
    if method == "initialize":
        want = params.get("protocolVersion")
        return {"protocolVersion": want if want in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0],
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "terratrace", "title": "TerraTrace – Climate & Nature Navigator", "version": "1.0.0"},
                "instructions": "Read-only access to TerraTrace results for Apetit. Only human-approved results are returned by default. "
                                "Always quote the record_key and source when you use a number."}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "tools/call":
        name, args = params.get("name"), params.get("arguments") or {}
        if name not in HANDLERS:
            raise ValueError(f"Unknown tool: {name}")
        try:
            out = HANDLERS[name](args)
            log_access(name, args, len(out.get("results", [])) if isinstance(out, dict) else 0)
            return {"content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False, indent=1)}], "structuredContent": out, "isError": False}
        except Exception as e:
            return {"content": [{"type": "text", "text": f"Tool error: {e}"}], "isError": True}
    raise LookupError(method)


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            reply = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
        else:
            try:
                result = handle(msg)
                if result is None:
                    continue
                reply = {"jsonrpc": "2.0", "id": msg.get("id"), "result": result}
            except LookupError:
                reply = {"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32601, "message": "Method not found"}}
            except ValueError as e:
                reply = {"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32602, "message": str(e)}}
        sys.stdout.write(json.dumps(reply, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()

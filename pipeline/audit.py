"""Correction log in the audit-trail pattern from docs/AZURE_FABRIC_QUICKSTART.md."""
from datetime import datetime, timezone

FIELDS = ["record_key", "field", "old_value", "new_value", "rule_or_model",
          "evidence", "proposed_by", "approved_by", "timestamp"]

_log = []


def log(record_key, field, old_value, new_value, rule_or_model, evidence):
    _log.append({
        "record_key": str(record_key), "field": str(field),
        "old_value": None if old_value is None else str(old_value),
        "new_value": None if new_value is None else str(new_value),
        "rule_or_model": rule_or_model, "evidence": evidence,
        "proposed_by": "TerraTrace pipeline (agent)", "approved_by": None,
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    })


def entries():
    return list(_log)


def reset():
    _log.clear()

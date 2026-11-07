"""TerraTrace signed results (Ed25519 digital signature).

A "release" is a small JSON file that lists every result file with its SHA-256 hash,
every approved result from the audit log, and the head of the hash-chained audit log.
The release is signed with an Ed25519 private key. Anyone with the public key can check
that no number was changed after approval.

  python3 signing.py sign      # create submissions/terratrace_release.json
  python3 signing.py verify    # check every file and the signature

The private key lives in instance/ (git-ignored, never shared). The public key is written
to submissions/terratrace_signing_public.pem so auditors can verify.
"""
import base64
import contextlib
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INSTANCE = ROOT / "instance"
KEY_FILE = INSTANCE / "signing_key.pem"
RELEASE_FILE = ROOT / "submissions" / "terratrace_release.json"
PUBLIC_FILE = ROOT / "submissions" / "terratrace_signing_public.pem"
FORMAT = "terratrace-signed-release/1"


def _crypto():
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
        return serialization, Ed25519PrivateKey, Ed25519PublicKey
    except ImportError:
        raise SystemExit("The 'cryptography' package is needed: pip install cryptography")


def _server():
    # server.py is the single place that reads the audit log; keep stdout clean for MCP use
    with contextlib.redirect_stdout(sys.stderr):
        sys.path.insert(0, str(ROOT))
        import server  # noqa: E402
    return server


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def result_files():
    files = sorted((ROOT / "submissions").glob("*.csv")) + sorted((ROOT / "app" / "data").glob("*.json"))
    return [p for p in files if p.name != RELEASE_FILE.name]


def load_or_create_key():
    serialization, Ed25519PrivateKey, _ = _crypto()
    if KEY_FILE.exists():
        return serialization.load_pem_private_key(KEY_FILE.read_bytes(), password=None)
    INSTANCE.mkdir(exist_ok=True)
    key = Ed25519PrivateKey.generate()
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    fd = os.open(KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(pem)
    return key


def public_pem(pub):
    serialization, _, _ = _crypto()
    return pub.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()


def fingerprint(pem_text):
    return "SHA256:" + hashlib.sha256(pem_text.encode()).hexdigest()[:32]


def build_manifest():
    srv = _server()
    entries = srv.audit_entries()
    valid = srv.chain_ok(entries)
    reviews = srv.current_reviews(["reviewer", "farm_advisor"])
    hash_of = {}
    for e in entries:
        if e.get("field") == "review_status":
            hash_of[e["record_key"]] = e.get("hash")
    approved = [{"record_key": k, "approved_by": v["by"], "timestamp": v["ts"], "audit_hash": hash_of.get(k)}
                for k, v in sorted(reviews.items()) if v["status"] == "approved"]
    return {
        "format": FORMAT,
        "created_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "signer": "TerraTrace release key (Team FarmSense)",
        "note": "Synthetic data from the Since AI / Apetit package.",
        "files": [{"path": str(p.relative_to(ROOT)), "sha256": sha256_file(p), "bytes": p.stat().st_size} for p in result_files()],
        "approved_results": approved,
        "audit": {"entries": len(entries), "head_hash": entries[-1]["hash"] if entries else None, "chain_valid": valid},
    }, valid


def sign():
    manifest, valid = build_manifest()
    if not valid:
        raise SystemExit("Audit log chain is broken. Refusing to sign.")
    key = load_or_create_key()
    pem = public_pem(key.public_key())
    release = {"manifest": manifest, "signature_ed25519": base64.b64encode(key.sign(canonical(manifest))).decode(),
               "public_key_pem": pem, "key_fingerprint": fingerprint(pem)}
    RELEASE_FILE.parent.mkdir(exist_ok=True)
    RELEASE_FILE.write_text(json.dumps(release, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    PUBLIC_FILE.write_text(pem, encoding="utf-8")
    return release


def verify(release_path=RELEASE_FILE):
    """Return a report dict. ok is True only if the signature and every file hash match."""
    serialization, _, _ = _crypto()
    report = {"ok": False, "signature_valid": False, "files": [], "approved_results": 0, "audit_continues": None}
    try:
        rel = json.loads(Path(release_path).read_text(encoding="utf-8"))
        man = rel["manifest"]
    except Exception as e:
        report["error"] = f"No readable release file ({e}). Run: python3 signing.py sign"
        return report
    if man.get("format") != FORMAT:
        report["error"] = "Unknown release format."
        return report
    try:
        pub = serialization.load_pem_public_key(rel["public_key_pem"].encode())
        pub.verify(base64.b64decode(rel["signature_ed25519"]), canonical(man))
        report["signature_valid"] = True
    except Exception:
        report["signature_valid"] = False
    all_files = True
    for f in man.get("files", []):
        p = ROOT / f["path"]
        if not p.exists():
            state = "MISSING"
        else:
            state = "OK" if sha256_file(p) == f["sha256"] else "CHANGED"
        all_files = all_files and state == "OK"
        report["files"].append({"path": f["path"], "state": state})
    report["approved_results"] = len(man.get("approved_results", []))
    report["signed_at"] = man.get("created_utc")
    report["key_fingerprint"] = rel.get("key_fingerprint")
    # optional: is the signed audit head still part of today's (valid) log?
    try:
        srv = _server()
        entries = srv.audit_entries()
        head = man.get("audit", {}).get("head_hash")
        report["audit_continues"] = bool(srv.chain_ok(entries) and (head is None or any(e.get("hash") == head for e in entries)))
    except Exception:
        report["audit_continues"] = None
    report["ok"] = report["signature_valid"] and all_files
    return report


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "verify"
    if cmd == "sign":
        rel = sign()
        m = rel["manifest"]
        print(f"Signed {len(m['files'])} files and {len(m['approved_results'])} approved results.")
        print(f"Release: {RELEASE_FILE.relative_to(ROOT)}  key {rel['key_fingerprint']}")
        return 0
    if cmd == "verify":
        r = verify()
        if r.get("error"):
            print(r["error"])
            return 1
        for f in r["files"]:
            print(f"  {f['state']:8} {f['path']}")
        print(f"Signature: {'VALID' if r['signature_valid'] else 'INVALID'} · approved results: {r['approved_results']} · "
              f"audit log continues: {r['audit_continues']} · signed {r.get('signed_at')}")
        print("RESULT: OK – nothing changed since signing" if r["ok"] else "RESULT: FAILED – something changed after signing")
        return 0 if r["ok"] else 2
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))

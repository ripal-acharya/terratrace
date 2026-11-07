"""Manage TerraTrace users (invite-only; there is no public sign-up).

    python3 manage_users.py demo                     create the 4 demo users; prints their passwords ONCE
    python3 manage_users.py add EMAIL ROLE[,ROLE]    add a user (asks for a password)
    python3 manage_users.py reset EMAIL              set a new random password (printed once)
    python3 manage_users.py roles EMAIL ROLE[,ROLE]  change roles
    python3 manage_users.py remove EMAIL             remove a user
    python3 manage_users.py list                     list users and roles (never passwords)

Roles: viewer, reviewer, farm_advisor, admin. Passwords are stored only as PBKDF2-SHA256 hashes in
instance/users.json (git-ignored). In production this is replaced by Microsoft Entra ID sign-in.
"""
import getpass
import re
import secrets
import sys

from server import ROLES, hash_password, load_users, save_users

DEMO = {
    "viewer@terratrace.demo": ["viewer"],
    "reviewer@terratrace.demo": ["reviewer"],
    "advisor@terratrace.demo": ["farm_advisor"],
    "admin@terratrace.demo": ["admin"],
}


def strong_password():
    return secrets.token_urlsafe(12) + "!7a"


def parse_roles(text):
    roles = [r.strip() for r in text.split(",") if r.strip()]
    bad = [r for r in roles if r not in ROLES]
    if not roles or bad:
        raise SystemExit(f"Roles must be from: {', '.join(ROLES)}")
    return roles


def valid_email(e):
    return re.fullmatch(r"[^@\s]{1,64}@[^@\s]{1,100}\.[A-Za-z]{2,}", e or "") is not None


def main(argv):
    if not argv:
        print(__doc__)
        return
    cmd, users = argv[0], load_users()
    if cmd == "demo":
        print("Demo users (save these passwords now; they are not stored in plain text):")
        for email, roles in DEMO.items():
            pw = strong_password()
            users[email] = {"roles": roles, "password": hash_password(pw)}
            print(f"  {email:28s} {','.join(roles):13s} {pw}")
        save_users(users)
    elif cmd == "add" and len(argv) == 3:
        email = argv[1].lower()
        if not valid_email(email):
            raise SystemExit("Invalid email.")
        roles = parse_roles(argv[2])
        pw = getpass.getpass("Password (min 12 characters): ")
        if len(pw) < 12:
            raise SystemExit("Password too short (min 12 characters).")
        users[email] = {"roles": roles, "password": hash_password(pw)}
        save_users(users)
        print("Added", email, roles)
    elif cmd == "reset" and len(argv) == 2:
        email = argv[1].lower()
        if email not in users:
            raise SystemExit("No such user.")
        pw = strong_password()
        users[email]["password"] = hash_password(pw)
        save_users(users)
        print(f"New password for {email}: {pw}")
    elif cmd == "roles" and len(argv) == 3:
        email = argv[1].lower()
        if email not in users:
            raise SystemExit("No such user.")
        users[email]["roles"] = parse_roles(argv[2])
        save_users(users)
        print("Updated", email, users[email]["roles"])
    elif cmd == "remove" and len(argv) == 2:
        users.pop(argv[1].lower(), None)
        save_users(users)
        print("Removed", argv[1])
    elif cmd == "list":
        for email, u in sorted(users.items()):
            print(f"  {email:28s} {','.join(u['roles'])}")
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])

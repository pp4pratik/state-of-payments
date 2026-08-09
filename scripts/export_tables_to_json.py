"""
One-off migration: dumps every remaining Supabase table into the public/data/*.json
files the app now reads directly (see src/lib/queries.ts and scripts/json_store.py).
Run once, after which nothing reads or writes Supabase - fetch_npci_data.py,
fetch_rbi_data.py, and the app itself all go straight to these JSON files.

Usage:
    python3 scripts/export_tables_to_json.py

Requires .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""

import json
import urllib.request
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = PROJECT_DIR / "public" / "data"

TABLES = [
    "monthly_trend",
    "app_stats",
    "p2p_p2m",
    "merchant_categories",
    "autopay_registrations",
    "autopay_executions",
    "autopay_registrations_by_bank",
    "autopay_executions_by_psp",
    "psp_member_performance",
    "rbi_cards",
    "rbi_payments",
    "circulars",
]


def load_env(path):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k] = v
    return env


def fetch_table(supabase_url, service_role_key, table):
    headers = {"apikey": service_role_key, "Authorization": f"Bearer {service_role_key}"}
    all_rows = []
    frm = 0
    while True:
        to = frm + 999
        req = urllib.request.Request(
            f"{supabase_url}/rest/v1/{table}?select=*",
            headers={**headers, "Range-Unit": "items", "Range": f"{frm}-{to}"},
        )
        with urllib.request.urlopen(req) as resp:
            chunk = json.loads(resp.read())
        all_rows.extend(chunk)
        if len(chunk) < 1000:
            break
        frm += 1000
    return all_rows


def main():
    env = load_env(PROJECT_DIR / ".env")
    supabase_url = env["SUPABASE_URL"].rstrip("/")
    service_role_key = env["SUPABASE_SERVICE_ROLE_KEY"]

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for table in TABLES:
        rows = fetch_table(supabase_url, service_role_key, table)
        # Supabase's identity column isn't part of any unique key the app cares
        # about and isn't something json_store's writers preserve going forward -
        # drop it so a freshly-exported file matches what a fresh write produces.
        for row in rows:
            row.pop("id", None)
        out_path = OUT_DIR / f"{table}.json"
        with open(out_path, "w") as f:
            json.dump(rows, f, indent=2)
        print(f"{table}: {len(rows)} rows -> {out_path.relative_to(PROJECT_DIR)}")

    print("\nExport complete.")


if __name__ == "__main__":
    main()

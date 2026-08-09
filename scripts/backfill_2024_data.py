"""
One-off backfill: upserts missing historical rows (mostly 2024) from a set of JSON
exports into Supabase, for the 6 tables found to have gaps (see the comparison run
before this script was written). Purely additive - every overlapping row already
matched Supabase exactly, so merge-duplicates upsert is safe here.

Usage:
    python3 scripts/backfill_2024_data.py

Requires .env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (same as
sync_airtable_to_supabase.py, whose upsert_supabase() this mirrors).
"""

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path("/Users/pratikpujara/Downloads/UPI App Builder/data")
BATCH_SIZE = 500

TABLES = [
    "app_stats",
    "merchant_categories",
    "statewise",
    "circulars",
    "rbi_cards",
    "rbi_payments",
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


def upsert_supabase(supabase_url, service_role_key, pg_table, unique_cols, rows):
    if not rows:
        return 0
    url = f"{supabase_url}/rest/v1/{pg_table}?on_conflict={','.join(unique_cols)}"
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    synced = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        req = urllib.request.Request(
            url, data=json.dumps(batch).encode(), headers=headers, method="POST"
        )
        try:
            with urllib.request.urlopen(req) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            print(f"  ERROR upserting into {pg_table}: {e.code} {e.read().decode()}")
            sys.exit(1)
        synced += len(batch)
    return synced


def main():
    env = load_env(PROJECT_DIR / ".env")
    supabase_url = env["SUPABASE_URL"].rstrip("/")
    service_role_key = env["SUPABASE_SERVICE_ROLE_KEY"]

    table_map = json.load(open(PROJECT_DIR / "supabase" / "table_map.json"))
    pg_tables = {v["pg"]: v for v in table_map.values()}

    for table in TABLES:
        cfg = pg_tables[table]
        with open(DATA_DIR / f"{table}.json") as f:
            rows = json.load(f)

        # PostgREST's bulk insert requires every object in the array to have the
        # same set of keys - some source rows are missing optional fields (e.g. a
        # circular with no date_added yet), so normalize to the table's full pg
        # column list, defaulting absent fields to null, rather than whatever keys
        # happened to be present in a given row.
        pg_cols = sorted(set(cfg["fields"].values()))
        rows = [{col: row.get(col) for col in pg_cols} for row in rows]

        # A single upsert statement can't touch the same (unique key) row twice -
        # dedupe defensively (keeping the last occurrence), same as
        # sync_airtable_to_supabase.py does for the same reason.
        by_key = {}
        for row in rows:
            key = tuple(row.get(col) for col in cfg["unique"])
            by_key[key] = row
        if len(by_key) != len(rows):
            print(f"  WARNING: {table} has {len(rows) - len(by_key)} duplicate row(s) for the same {cfg['unique']} - keeping the last one seen.")
        rows = list(by_key.values())

        synced = upsert_supabase(supabase_url, service_role_key, table, cfg["unique"], rows)
        print(f"{table}: upserted {synced} rows")

    print("Backfill complete.")


if __name__ == "__main__":
    main()

"""
One-off migration: exports the months Supabase's `statewise` table still holds that
aren't already covered by scripts/fetch_statewise_historical.py's output (2024's 12
months + June 2026 - the rest of the table, Jan 2025-May 2026, was already replaced by
better data scraped directly from NPCI) into the same public/statewise-historical/
JSON shape, and writes an index.json manifest of every available month.

Run once as part of pulling Geography off Supabase entirely - after this, Supabase's
statewise table is no longer read by the app (see useStatewiseAll in
src/lib/queries.ts) or written by the live fetcher (see fetch_npci_data.py). The
Supabase table itself is left in place, just unused, in case it's ever needed again.

Usage:
    python3 scripts/export_statewise_to_json.py
"""

import json
import urllib.request
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = PROJECT_DIR / "public" / "statewise-historical"

# Every month Supabase's statewise table has that isn't already covered by the
# NPCI-scraped JSON files (Jan 2025-May 2026).
MONTHS_TO_EXPORT = [f"2024-{m:02d}-01" for m in range(1, 13)] + ["2026-06-01"]


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


def fetch_month(supabase_url, service_role_key, month):
    headers = {"apikey": service_role_key, "Authorization": f"Bearer {service_role_key}"}
    cols = "state,district,month,volume_mn,volume_share_pct,value_cr,value_share_pct"
    all_rows = []
    frm = 0
    while True:
        to = frm + 999
        req = urllib.request.Request(
            f"{supabase_url}/rest/v1/statewise?select={cols}&month=eq.{month}",
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

    for month in MONTHS_TO_EXPORT:
        rows = fetch_month(supabase_url, service_role_key, month)
        if not rows:
            print(f"{month}: no rows in Supabase, skipping")
            continue
        out_path = OUT_DIR / f"{month}.json"
        with open(out_path, "w") as f:
            json.dump(rows, f, indent=2)
        print(f"{month}: {len(rows)} rows -> {out_path.relative_to(PROJECT_DIR)}")

    all_months = sorted(p.stem for p in OUT_DIR.glob("*.json"))
    with open(OUT_DIR / "index.json", "w") as f:
        json.dump(all_months, f, indent=2)
    print(f"\nindex.json: {len(all_months)} months ({all_months[0]} - {all_months[-1]})")


if __name__ == "__main__":
    main()

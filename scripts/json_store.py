"""
Shared JSON-file storage helpers - the project's data store, replacing Supabase.
Every table lives as one file, public/data/<table>.json, an array of plain dicts
keyed by the same pg-style snake_case column names Supabase used, so nothing
downstream (queries.ts, other scripts) has to change shape.

Mirrors the exact write semantics the old Supabase-backed scripts relied on:
  - upsert_single: one row per natural key (e.g. one row per month, for
    monthly_trend/rbi_cards/rbi_payments/p2p_p2m) - overwrite the matching row (or
    append if new), leave every other row untouched.
  - replace_for_key: delete-then-recreate every row matching one column's value
    (typically a month) - the multi-row-per-month tables' rename/drop-safe pattern
    (Postgres equivalent: supabase_replace_month). A renamed or dropped entity's
    stale row for THAT key value is removed; every other key value is untouched.
  - upsert_many: merge a batch into the file by unique key, no scoping - for tables
    that aren't month-scoped (circulars) or where the incoming batch is a full
    from-Airtable refresh (sync_airtable_to_json.py).
  - distinct_values: read back all values of one column, optionally excluding a
    given key value - what normalize_names' spelling-drift check compares a fresh
    name against (must exclude the month being written THIS run, or a bad spelling
    already sitting in that month's not-yet-replaced rows pollutes its own
    reference set - confirmed the hard way when Supabase did this).
"""

import json
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_DIR / "public" / "data"


def _path(name):
    return DATA_DIR / f"{name}.json"


def read(name):
    p = _path(name)
    if not p.exists():
        return []
    with open(p) as f:
        return json.load(f)


def _write(name, rows):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(_path(name), "w") as f:
        json.dump(rows, f, indent=2)


def upsert_single(name, unique_cols, row, dry_run=False):
    if dry_run:
        print(f"  [dry-run] would upsert 1 row into data/{name}.json")
        return
    rows = read(name)
    key = tuple(row.get(c) for c in unique_cols)
    rows = [r for r in rows if tuple(r.get(c) for c in unique_cols) != key]
    rows.append(row)
    rows.sort(key=lambda r: tuple(str(r.get(c)) for c in unique_cols))
    _write(name, rows)
    print(f"  Wrote 1 row to public/data/{name}.json ({len(rows)} total)")


def replace_for_key(name, key_col, key_val, new_rows, dry_run=False):
    if not new_rows:
        return
    if dry_run:
        print(f"  [dry-run] would replace {len(new_rows)} row(s) for {key_col}={key_val} in data/{name}.json")
        return
    rows = read(name)
    kept = [r for r in rows if r.get(key_col) != key_val]
    rows = kept + new_rows
    rows.sort(key=lambda r: str(r.get(key_col)))
    _write(name, rows)
    print(f"  Wrote {len(new_rows)} row(s) to public/data/{name}.json ({len(rows)} total)")


def upsert_many(name, unique_cols, new_rows, dry_run=False):
    if not new_rows:
        return
    if dry_run:
        print(f"  [dry-run] would upsert {len(new_rows)} row(s) into data/{name}.json")
        return
    rows = read(name)
    by_key = {tuple(r.get(c) for c in unique_cols): r for r in rows}
    for r in new_rows:
        by_key[tuple(r.get(c) for c in unique_cols)] = r
    merged = list(by_key.values())
    merged.sort(key=lambda r: tuple(str(r.get(c)) for c in unique_cols))
    _write(name, merged)
    print(f"  Wrote {len(new_rows)} row(s) to public/data/{name}.json ({len(merged)} total)")


def distinct_values(name, column, exclude_key_col=None, exclude_key_val=None):
    rows = read(name)
    return {
        r[column]
        for r in rows
        if r.get(column) and not (exclude_key_col and r.get(exclude_key_col) == exclude_key_val)
    }

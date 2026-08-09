"""
One-off historical backfill (phase 1 of 2): re-fetches full district-level Statewise
data for months that only have the old "top 10 states" snapshot in Supabase (Jan 2025
through May 2026 - see fetch_npci_data.py's fetch_statewise for the current, correct
per-month fetch; this loops the same NPCI endpoint over explicit past year/month pairs
instead of just "the latest month").

Writes ONE JSON FILE PER MONTH under data/statewise_historical/ - does NOT touch
Supabase. Deliberately split from the load step (unlike fetch_npci_data.py's direct
scrape-then-upsert) because this is scraping 17 months in one run against a
bot-protected site: if it dies partway, a JSON-per-month checkpoint means only the
remaining months need re-scraping, and the raw output can be eyeballed before it goes
anywhere near the live database - both burned us on this exact endpoint already (see
commit 9114faf's "Total" row bug, and the earlier empty-district convention bug).

Row shape matches what backfill_2024_data.py expects to load (pg column names, not
Airtable field labels) so the same loading logic can be reused as phase 2.

Usage:
    python3 scripts/fetch_statewise_historical.py

Requires: pip install playwright && playwright install chromium
"""

import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = PROJECT_DIR / "data" / "statewise_historical"
MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Jan 2025 through May 2026 - everything between the 2024 backfill (already
# state-level-complete) and June 2026 (already fetched at full district level).
TARGET_MONTHS = [(2025, m) for m in range(1, 13)] + [(2026, m) for m in range(1, 6)]


def month_iso(year, month_num):
    return f"{year}-{month_num:02d}-01"


def num(v):
    if v is None:
        return None
    s = str(v).strip().replace(",", "").rstrip("%")
    if s == "" or s == "-":
        return None
    return float(s)


def fetch_json(page, url, retries=3):
    last_status = None
    for attempt in range(retries):
        resp = page.goto(url, wait_until="load", timeout=30000)
        last_status = resp.status if resp else None
        if resp is not None and resp.status == 200:
            try:
                return json.loads(page.inner_text("body")), resp.status
            except json.JSONDecodeError:
                pass
        if attempt < retries - 1:
            page.wait_for_timeout(2000 * (attempt + 1))
    return None, last_status


def fetch_all_pages(page, url_builder, page_size=100):
    all_rows = []
    page_no = 1
    while True:
        data, status = fetch_json(page, url_builder(page_no, page_size))
        if data is None or data.get("status") != 200:
            if page_no == 1:
                return None, status
            break
        payload = data["data"]
        rows = payload.get("results") or []
        all_rows.extend(rows)
        total = payload.get("totalCount", len(all_rows))
        if len(all_rows) >= total or not rows:
            break
        page_no += 1
    return all_rows, 200


def fetch_statewise_for_month(page, year, month_abbr_val):
    def url_for(pn, sz):
        return (
            f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
            f"?product_name=UPI&tab_name=statewise-statistic&year={year}&month={month_abbr_val}"
            f"&page_no={pn}&sort_by=asc&size={sz}&locale=en"
        )

    raw_rows, status = fetch_all_pages(page, url_for, page_size=100)
    if raw_rows is None:
        return None, status

    month_val = month_iso(year, MONTH_ABBR.index(month_abbr_val) + 1)

    parsed = []
    for r in raw_rows:
        state = re.sub(r"\s*#\s*$", "", (r["state_union_territory"] or "")).strip()
        # March 2026's response appended " Total" to the state name itself instead of
        # using district="-" for its per-state summary row - strip it so the state
        # name is clean regardless of which convention a given month used.
        state = re.sub(r"\s+Total$", "", state, flags=re.IGNORECASE).strip()
        district = (r["district"] or "").strip()
        is_unclassified = state.lower().startswith("unclassified")
        parsed.append(
            {
                "state": state,
                "district": district,
                "is_unclassified": is_unclassified,
                "volume_mn": num(r["volume_in_mn"]),
                "value_cr": num(r["value_in_cr"]),
            }
        )

    # A blank district means two different things depending on the month: in a
    # district-granularity month it's NPCI's redundant per-state "Total" row (real
    # district rows for that state already cover the total - drop it). In a
    # state-only month, EVERY row is blank-district by nature since no district
    # breakdown was published at all - there it's the only data for that state, and
    # per the app's established convention (see useStatewiseAll/GeoRow) a
    # state-level row's "district" is set equal to its state, not left blank.
    has_real_districts = any(p["district"] not in ("", "-") and not p["is_unclassified"] for p in parsed)

    out = []
    for p in parsed:
        if p["is_unclassified"]:
            district = "Unclassified"
        elif p["district"] in ("", "-"):
            if has_real_districts:
                continue
            district = p["state"]
        else:
            district = p["district"]
        out.append(
            {
                "state": p["state"],
                "district": district,
                "month": month_val,
                "volume_mn": p["volume_mn"],
                "value_cr": p["value_cr"],
            }
        )

    # NPCI's own volume_contribution/value_contribution fields are unreliable - March
    # 2026's came back exactly 100x too small (0.44% instead of 43.74%) while
    # volume_mn/value_cr were fine, confirmed by cross-checking against April/May/June
    # (whose stored contribution % does match a from-scratch computation there).
    # Recompute the share ourselves from the raw mn/cr figures instead of trusting a
    # field that's already proven wrong once on this exact endpoint.
    total_vol = sum(o["volume_mn"] or 0 for o in out)
    total_val = sum(o["value_cr"] or 0 for o in out)
    for o in out:
        o["volume_share_pct"] = round((o["volume_mn"] or 0) / total_vol * 100, 2) if total_vol else None
        o["value_share_pct"] = round((o["value_cr"] or 0) / total_val * 100, 2) if total_val else None

    return out, status


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
        )

        results = []
        for year, month_num in TARGET_MONTHS:
            month_abbr_val = MONTH_ABBR[month_num - 1]
            label = month_iso(year, month_num)
            out_path = OUT_DIR / f"{label}.json"
            if out_path.exists():
                print(f"{label}: already fetched, skipping ({out_path.relative_to(PROJECT_DIR)})")
                results.append((label, "cached"))
                continue

            print(f"Fetching statewise for {label}...", end=" ", flush=True)

            rows, status = fetch_statewise_for_month(page, year, month_abbr_val)
            if rows is None:
                print(f"SKIPPED (HTTP {status} / no data)")
                results.append((label, None))
                continue

            with open(out_path, "w") as f:
                json.dump(rows, f, indent=2)
            n_states = len({r["state"] for r in rows if r["district"] != "Unclassified"})
            print(f"{len(rows)} rows ({n_states} states/UTs) -> {out_path.relative_to(PROJECT_DIR)}")
            results.append((label, len(rows)))

            page.wait_for_timeout(1500)  # be polite to NPCI's origin across 17 back-to-back requests

        browser.close()

    print("\nSummary:")
    for label, n in results:
        print(f"  {label}: {n if n is not None else 'FAILED'}")
    failed = [label for label, n in results if n is None]
    if failed:
        print(f"\n{len(failed)} month(s) failed - re-run this script to retry (already-written months are untouched).")
        sys.exit(1)


if __name__ == "__main__":
    main()

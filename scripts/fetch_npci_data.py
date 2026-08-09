"""
Fetches UPI and AutoPay statistics directly from npci.org.in - the NPCI half of the
"fetch from source, not hand-entry" pipeline (see scripts/fetch_rbi_data.py for the
RBI half). NPCI's stats pages call a clean JSON API under the hood, but that API is
behind Akamai bot protection that rejects plain HTTP requests (confirmed: curl gets
a 403 even with a normal browser User-Agent). A real browser passes straight through
with no extra work - no cookies/session priming needed - so this uses Playwright
(headless Chromium) to fetch each endpoint instead of urllib.

NOT covered: P2P/P2M Transactions. NPCI's own site currently 500s on that tab for
every month tested (confirmed via both the live UI and the raw API endpoint,
independent of any request details this script controls) - a live bug on their end,
not something fixable here. There's no automated source for it until NPCI fixes
this; hand-edit public/data/p2p_p2m.json directly when new figures are available.

Writes straight to the static JSON files under public/data/ that the live site
reads (see src/lib/queries.ts and scripts/json_store.py) - no Airtable or Supabase
involved anywhere in this pipeline. Statewise is the one exception even within
JSON: its per-month payload is large enough (up to ~780 rows) that it gets its own
per-month file plus an index.json manifest under public/statewise-historical/,
rather than one big array like every other table (see write_statewise_json and
useStatewiseAll). Single-row-per-month tables (Monthly Trend) are found-and-updated
like fetch_rbi_data.py. Multi-row-per-month tables (App Stats, Merchant Categories,
Statewise, PSP Member Performance, AutoPay Registrations/Executions) use
delete-then-recreate for that month instead of per-row matching - simpler and safer
than trying to match entity identity row-by-row across runs.

Usage:
    python3 scripts/fetch_npci_data.py [--dry-run] [--only monthly_trend,app_stats,...]

Requires: pip install playwright && playwright install chromium
"""

import json
import re
import sys
from datetime import date
from pathlib import Path

from playwright.sync_api import sync_playwright

import json_store

PROJECT_DIR = Path(__file__).resolve().parent.parent
MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
STATEWISE_JSON_DIR = PROJECT_DIR / "public" / "statewise-historical"


def month_iso(year, month_abbr_val):
    return f"{year}-{MONTH_ABBR.index(month_abbr_val) + 1:02d}-01"


def num(v):
    if v is None:
        return None
    s = str(v).strip().replace(",", "").rstrip("%")
    if s == "" or s == "-":
        return None
    return float(s)


# ---------------- Fetching (Playwright, bypasses Akamai) ----------------
def fetch_json(page, url, retries=3):
    """NPCI's origin is occasionally flaky under repeated requests (seen: a
    transient 503 mid-session that would otherwise have silently looked like "no
    circulars exist" instead of "the fetch failed") - retry transient failures
    instead of treating them as empty results."""
    last_status = None
    for attempt in range(retries):
        resp = page.goto(url, wait_until="load", timeout=30000)
        last_status = resp.status if resp else None
        if resp is not None and resp.status == 200:
            try:
                return json.loads(page.inner_text("body")), resp.status
            except json.JSONDecodeError:
                pass  # fall through to retry
        if attempt < retries - 1:
            page.wait_for_timeout(2000 * (attempt + 1))
    return None, last_status


def fetch_all_pages(page, url_builder, page_size=100):
    """Follows totalCount/pageNum pagination, returns the flattened `results` (or
    `data.files` for the circulars endpoint) list across all pages."""
    all_rows = []
    page_no = 1
    while True:
        data, status = fetch_json(page, url_builder(page_no, page_size))
        if data is None or data.get("status") != 200:
            if page_no == 1:
                sys.exit(f"Fetch failed for page 1 (HTTP {status}) - aborting rather than treating this as 'no data'")
            break
        payload = data["data"]
        rows = payload.get("results")
        if rows is None:
            rows = payload.get("files", [])
        if isinstance(rows, dict):  # mcc's shape: {"tableDetail": [...]}
            rows = rows.get("tableDetail", [])
        all_rows.extend(rows)
        total = payload.get("totalCount", len(all_rows))
        if len(all_rows) >= total or not rows:
            break
        page_no += 1
    return all_rows


def find_latest_month(page, url_for_month, months_back=6):
    """Walks backward from the current month until one returns real data. NPCI's
    ecosystem-statistics tabs (app stats, categories, geography, member performance)
    consistently lag ~1 month behind the headline monthly-trend figure."""
    today = date.today()
    y, m = today.year, today.month
    for _ in range(months_back):
        month_abbr_val = MONTH_ABBR[m - 1]
        data, status = fetch_json(page, url_for_month(y, month_abbr_val))
        if data and data.get("status") == 200:
            payload = data["data"]
            rows = payload.get("results")
            if isinstance(rows, dict):
                rows = rows.get("tableDetail", [])
            if rows:
                return y, month_abbr_val, data
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    sys.exit(f"No data found for the last {months_back} months - NPCI page layout may have changed")


# ---------------- Domain fetchers ----------------
def fetch_monthly_trend(page):
    url = (
        "https://www.npci.org.in/api/product-statistic/tab/detail"
        "?product_name=upi&tab_name=product-statistics-upi&year_range=2026-27"
        "&excel_type=monthly&page_no=1&page_size=1&locale=en"
    )
    data, status = fetch_json(page, url)
    if not data or data.get("status") != 200 or not data["data"]["results"]:
        sys.exit("Could not fetch Monthly Trend - page layout may have changed")
    r = data["data"]["results"][0]
    m, y = r["month"].split("-")  # e.g. "July-2026"
    return {
        "Month": month_iso(int(y), m[:3]),
        "Banks Live": num(r["no_of_banks_live_on_upi"]),
        "Total Volume (Mn)": num(r["volume_in_mn"]),
        "Total Value (Cr)": num(r["value_in_cr"]),
    }


def fetch_app_stats(page):
    def url_for(y, m):
        return (
            f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
            f"?product_name=UPI&tab_name=upi-apps&year={y}&month={m}&page_no=1&sort_by=asc&size=1&locale=en"
        )

    y, m, _ = find_latest_month(page, url_for)
    rows = fetch_all_pages(
        page,
        lambda pn, sz: (
            f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
            f"?product_name=UPI&tab_name=upi-apps&year={y}&month={m}&page_no={pn}&sort_by=asc&size={sz}&locale=en"
        ),
    )
    out = []
    for r in rows:
        name = re.sub(r"\s*#\s*$", "", r["application_name"]).strip()  # strip TPAP marker
        out.append(
            {
                "App Name": name,
                "Month": month_iso(y, m),
                "Volume (Mn)": num(r["total_volume_mn"]),
                "Value (Cr)": num(r["total_value_cr"]),
            }
        )
    return out


def fetch_merchant_categories(page):
    def url_for(y, m):
        return (
            f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
            f"?product_name=UPI&tab_name=mcc&year={y}&month={m}&page_no=1&sort_by=asc&size=1&locale=en"
        )

    y, m, _ = find_latest_month(page, url_for)
    rows = fetch_all_pages(
        page,
        lambda pn, sz: (
            f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
            f"?product_name=UPI&tab_name=mcc&year={y}&month={m}&page_no={pn}&sort_by=asc&size={sz}&locale=en"
        ),
    )
    out = []
    for r in rows:
        description = (r["description"] or "").strip()
        # NPCI's mcc tab includes a grand-total footer row ("Total") alongside the
        # real "Others" catch-all category - both have a blank MCC, and if "Total"
        # isn't dropped it has the single largest volume/value of any row, so it'd
        # show up on the site as the #1 "top merchant category", which is nonsense.
        if description.lower() == "total":
            continue
        out.append(
            {
                "Description": description,
                # '' not None: Supabase's upsert matches on_conflict(mcc, month), and
                # SQL NULL never equals NULL for that purpose, so a null MCC (real for
                # "Others") would insert a fresh duplicate row on every single run
                # instead of updating the existing one. Confirmed the hard way: three
                # duplicate "Others" rows had piled up in Supabase before this fix.
                "MCC": r["mcc"] or "",
                # Airtable's Type select field only has the short-form options
                # ("High Transacting" etc.) - NPCI's site now labels them with a
                # trailing " Categories" that isn't a valid existing option, and
                # this token lacks permission to add new ones.
                "Type": re.sub(r"\s+Categories$", "", r["type"] or "").strip(),
                "Month": month_iso(y, m),
                "Volume (Mn)": num(r["volume_in_mn"]),
                "Value (Cr)": num(r["value_in_cr"]),
            }
        )
    return out


def fetch_statewise(page):
    def url_for(y, m):
        return (
            f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
            f"?product_name=UPI&tab_name=statewise-statistic&year={y}&month={m}&page_no=1&sort_by=asc&size=1&locale=en"
        )

    y, m, _ = find_latest_month(page, url_for)
    rows = fetch_all_pages(
        page,
        lambda pn, sz: (
            f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
            f"?product_name=UPI&tab_name=statewise-statistic&year={y}&month={m}&page_no={pn}&sort_by=asc&size={sz}&locale=en"
        ),
        page_size=100,
    )
    month_val = month_iso(y, m)
    parsed = []
    for r in rows:
        state = re.sub(r"\s*#\s*$", "", (r["state_union_territory"] or "")).strip()
        # Some months append " Total" to the state name itself instead of using
        # district="-" for the per-state summary row (confirmed: March 2026's
        # response used this convention) - strip it so the state name is clean
        # either way.
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

    # NPCI's response nests a per-state "Total" summary row above that state's own
    # district rows in district-granularity months - confirmed the district rows
    # already sum back to the same total, so keeping both would double: a "Total"
    # row with no district name would rank at the top of any volume-sorted table.
    # But in a state-only month EVERY row is blank-district by nature (no district
    # breakdown was published at all) - there it's the only data for that state, so
    # per the app's convention (see useStatewiseAll/GeoRow) set district = state
    # rather than dropping it. Keep "Unclassified" as its own entry either way,
    # rather than silently losing that share of the total.
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
                "State": p["state"],
                "District": district,
                "Month": month_val,
                "Volume (Mn)": p["volume_mn"],
                "Value (Cr)": p["value_cr"],
            }
        )

    # NPCI's own volume_contribution/value_contribution fields are unreliable -
    # confirmed one month came back with every value exactly 100x too small - so
    # compute the share ourselves from volume_mn/value_cr instead of trusting a
    # field that's already proven wrong once on this exact endpoint.
    total_vol = sum(o["Volume (Mn)"] or 0 for o in out)
    total_val = sum(o["Value (Cr)"] or 0 for o in out)
    for o in out:
        o["Volume Share %"] = round((o["Volume (Mn)"] or 0) / total_vol * 100, 2) if total_vol else None
        o["Value Share %"] = round((o["Value (Cr)"] or 0) / total_val * 100, 2) if total_val else None

    return out


def fetch_psp_member_performance(page):
    def url_for_direction(direction):
        def url_for(y, m):
            return (
                f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
                f"?product_name=UPI&tab_name=top50-member&type_name={direction}&year={y}&month={m}"
                f"&page_no=1&sort_by=asc&size=1&locale=en"
            )

        return url_for

    out = []
    for direction, label in [("remitter", "Remitter"), ("beneficiary", "Beneficiary")]:
        y, m, _ = find_latest_month(page, url_for_direction(direction))
        rows = fetch_all_pages(
            page,
            lambda pn, sz, direction=direction, y=y, m=m: (
                f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
                f"?product_name=UPI&tab_name=top50-member&type_name={direction}&year={y}&month={m}"
                f"&page_no={pn}&sort_by=asc&size={sz}&locale=en"
            ),
        )
        entity_key = "upi_remitter_banks" if direction == "remitter" else "upi_beneficiary_banks"
        for r in rows:
            entity_name = r.get(entity_key) or r.get("upi_remitter_banks") or r.get("upi_beneficiary_banks")
            out.append(
                {
                    "Entity Name": entity_name,
                    "Direction": label,
                    "Month": month_iso(y, m),
                    "Volume (Mn)": num(r["total_volume_in_mn"]),
                    "Approved %": num(r["approved_percent"]),
                    "BD %": num(r["bd_percent"]),
                    "TD %": num(r["td_percent"]),
                }
            )
    return out


def fetch_autopay_registrations(page):
    def url_for(y, m):
        return (
            f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
            f"?product_name=Autopay&tab_name=psp-reg&type_name=payer&year={y}&month={m}"
            f"&page_no=1&sort_by=asc&size=1&locale=en"
        )

    y, m, _ = find_latest_month(page, url_for)
    rows = fetch_all_pages(
        page,
        lambda pn, sz: (
            f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
            f"?product_name=Autopay&tab_name=psp-reg&type_name=payer&year={y}&month={m}"
            f"&page_no={pn}&sort_by=asc&size={sz}&locale=en"
        ),
    )
    return [
        {
            "PSP": r["payer_psp"],
            "Month": month_iso(y, m),
            "Registrations (Mn)": num(r["total_volume"]),
            "Approved %": num(r["approved_percent"]),
            "BD %": num(r["bd_percent"]),
            "TD %": num(r["td_percent"]),
        }
        for r in rows
    ]


def fetch_autopay_executions(page):
    def url_for(y, m):
        return (
            f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
            f"?product_name=Autopay&tab_name=top50-remitter&type_name=execution&year={y}&month={m}"
            f"&page_no=1&sort_by=asc&size=1&locale=en"
        )

    y, m, _ = find_latest_month(page, url_for)
    rows = fetch_all_pages(
        page,
        lambda pn, sz: (
            f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
            f"?product_name=Autopay&tab_name=top50-remitter&type_name=execution&year={y}&month={m}"
            f"&page_no={pn}&sort_by=asc&size={sz}&locale=en"
        ),
    )
    return [
        {
            "Bank": r["remitter_bank"],
            "Month": month_iso(y, m),
            "Executions (Mn)": num(r["total_volume"]),
            "Approved %": num(r["approved_percent"]),
            "BD %": num(r["bd_percent"]),
            "TD %": num(r["td_percent"]),
        }
        for r in rows
    ]


def fetch_autopay_registrations_by_bank(page):
    """Same 'Top 50 Remitter Banks' tab as fetch_autopay_executions, but
    type_name=reg instead of execution - NPCI's Mandate Registration view of
    that tab, broken down by remitter bank rather than by payer PSP."""

    def url_for(y, m):
        return (
            f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
            f"?product_name=Autopay&tab_name=top50-remitter&type_name=reg&year={y}&month={m}"
            f"&page_no=1&sort_by=asc&size=1&locale=en"
        )

    y, m, _ = find_latest_month(page, url_for)
    rows = fetch_all_pages(
        page,
        lambda pn, sz: (
            f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
            f"?product_name=Autopay&tab_name=top50-remitter&type_name=reg&year={y}&month={m}"
            f"&page_no={pn}&sort_by=asc&size={sz}&locale=en"
        ),
    )
    return [
        {
            "Remitter Bank": r["remitter_bank"],
            "Month": month_iso(y, m),
            "Registrations (Mn)": num(r["total_volume"]),
            "Approved %": num(r["approved_percent"]),
            "BD %": num(r["bd_percent"]),
            "TD %": num(r["td_percent"]),
        }
        for r in rows
    ]


def fetch_autopay_executions_by_psp(page):
    """NPCI's 'PSP Wise execution' tab - the payer-PSP-level counterpart to
    fetch_autopay_executions (which is remitter-bank-level)."""

    def url_for(y, m):
        return (
            f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
            f"?product_name=Autopay&tab_name=psp-wise-execution&type_name=payer&year={y}&month={m}"
            f"&page_no=1&sort_by=asc&size=1&locale=en"
        )

    y, m, _ = find_latest_month(page, url_for)
    rows = fetch_all_pages(
        page,
        lambda pn, sz: (
            f"https://www.npci.org.in/api/ecosystem-statistics/get-statistics"
            f"?product_name=Autopay&tab_name=psp-wise-execution&type_name=payer&year={y}&month={m}"
            f"&page_no={pn}&sort_by=asc&size={sz}&locale=en"
        ),
    )
    return [
        {
            "PSP": r["payer_psp"],
            "Month": month_iso(y, m),
            "Executions (Mn)": num(r["total_volume"]),
            "Approved %": num(r["approved_percent"]),
            "BD %": num(r["bd_percent"]),
            "TD %": num(r["td_percent"]),
        }
        for r in rows
    ]


def parse_circular(r):
    """NPCI's fileName freetext is wildly inconsistent (en-dashes vs pipes, missing
    separators, non-'UPI' categories like 'Product Compliance'/'PCOMP Portal'). Only
    reliable structured field is yearLabel ("FY 26-27") - use that for FY instead of
    parsing it out of the filename. Ref/Title come from splitting on '|': segment 0
    is the category (discarded), segment 1 is the ref, everything after is the
    title (with a leading 'FY ...-..' token stripped if present, since it's usually
    repeated redundantly in segment 2)."""
    name = r["fileName"].strip()
    year_match = re.search(r"(\d{2,4})\s*[-–]\s*(\d{2})", r.get("yearLabel") or "")
    if not year_match:
        return None
    fy_start, fy_end = year_match.groups()
    fy = (fy_start if len(fy_start) == 4 else f"20{fy_start}") + "-" + fy_end

    parts = [p.strip() for p in name.split("|")]
    if len(parts) < 2:
        return None
    ref = re.sub(r"\s+", " ", parts[1])
    rest = " | ".join(parts[2:]) if len(parts) > 2 else ""
    rest = re.sub(r"^FY\s*\d{2,4}\s*[-–]\s*\d{2}\s*[|–-]*\s*", "", rest, flags=re.IGNORECASE)
    title = re.sub(r"\s+", " ", rest).strip(" |-–") or name
    return ref, fy, title


def fetch_circulars(page, years):
    out = []
    for year in years:
        rows = fetch_all_pages(
            page,
            lambda pn, sz, year=year: (
                f"https://www.npci.org.in/api/circulars/upi?pageNum={pn}&year={year}&sort=desc&size={sz}&locale=en"
            ),
        )
        for r in rows:
            parsed = parse_circular(r)
            if not parsed:
                print(f"  WARNING: could not parse circular, skipping: {r['fileName']!r}")
                continue
            ref, fy, title = parsed
            pdf_url = f"https://www.npci.org.in{r['media']['url']}" if r.get("media") else None
            out.append({"Ref": ref, "FY": fy, "Title": title, "PDF URL": pdf_url})
    return out


def normalize_key(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def normalize_names(rows, field, known_names):
    """NPCI's raw app_name spelling isn't stable month to month - confirmed live:
    PhonePe (17 months) became "Phone Pe" (with a space) for one month, silently
    splitting an 18-month entity into two, which broke the App Trend line chart (it
    plots by name, so "PhonePe" showed a flat historical line with nothing for the
    latest month, and "Phone Pe" showed a single new point with no history - neither
    looked like a top-ranked app's real trend). Snap any incoming name back to the
    already-established spelling when they match case/whitespace-insensitively, so
    a genuinely new entity ("FamApp by Trio" vs "FamApp") still gets its own row,
    but a pure formatting drift doesn't fork the time series."""
    known_by_key = {}
    for n in known_names:
        known_by_key.setdefault(normalize_key(n), n)
    renamed = 0
    for row in rows:
        key = normalize_key(row[field])
        established = known_by_key.get(key)
        if established and established != row[field]:
            row[field] = established
            renamed += 1
    if renamed:
        print(f"  Normalized {renamed} name(s) back to their established spelling")
    return rows


def snake(label):
    # Must match supabase/schema.sql's original generator (scratchpad gen_schema.mjs)
    # exactly, including replacing % with "pct" before the generic collapse -
    # otherwise "Volume Share %" becomes "volume_share" instead of the real column
    # "volume_share_pct" and every upsert 400s on "column not found".
    label = label.replace("%", "pct")
    return re.sub(r"^_+|_+$", "", re.sub(r"[^a-z0-9]+", "_", label.lower()))


def write_statewise_json(rows, dry_run):
    """Geography is served entirely from static JSON, not Supabase (see
    useStatewiseAll in src/lib/queries.ts) - write this month's file directly instead
    of upserting to a statewise table, and refresh index.json, the manifest the app
    reads to discover which months exist."""
    if not rows:
        return
    month = rows[0]["month"]
    if dry_run:
        print(f"  [dry-run] Geography: would write {len(rows)} row(s) to statewise-historical/{month}.json")
        return
    STATEWISE_JSON_DIR.mkdir(parents=True, exist_ok=True)
    with open(STATEWISE_JSON_DIR / f"{month}.json", "w") as f:
        json.dump(rows, f, indent=2)
    months = sorted(p.stem for p in STATEWISE_JSON_DIR.glob("*.json") if p.stem != "index")
    with open(STATEWISE_JSON_DIR / "index.json", "w") as f:
        json.dump(months, f, indent=2)
    print(f"  Geography: wrote {len(rows)} row(s) to public/statewise-historical/{month}.json")


def to_pg_rows(field_rows):
    return [{("month" if k == "Month" else snake(k)): v for k, v in row.items()} for row in field_rows]


# ---------------- Main ----------------
DOMAINS = {
    "monthly_trend": ("Monthly Trend", "monthly_trend", ["month"], fetch_monthly_trend, "single"),
    "app_stats": ("App Stats", "app_stats", ["app_name", "month"], fetch_app_stats, "multi"),
    "merchant_categories": ("Merchant Categories", "merchant_categories", ["mcc", "month"], fetch_merchant_categories, "multi"),
    "statewise": ("Statewise", "statewise", ["state", "district", "month"], fetch_statewise, "multi"),
    "psp_member_performance": ("PSP Member Performance", "psp_member_performance", ["entity_name", "direction", "month"], fetch_psp_member_performance, "multi"),
    "autopay_registrations": ("AutoPay Registrations", "autopay_registrations", ["psp", "month"], fetch_autopay_registrations, "multi"),
    "autopay_executions": ("AutoPay Executions", "autopay_executions", ["bank", "month"], fetch_autopay_executions, "multi"),
    "autopay_registrations_by_bank": ("AutoPay Registrations by Bank", "autopay_registrations_by_bank", ["remitter_bank", "month"], fetch_autopay_registrations_by_bank, "multi"),
    "autopay_executions_by_psp": ("AutoPay Executions by PSP", "autopay_executions_by_psp", ["psp", "month"], fetch_autopay_executions_by_psp, "multi"),
    "circulars": ("Circulars", "circulars", ["fy", "ref"], None, "circulars"),
}

# Domains with a free-text entity name prone to NPCI's spelling drift ("PhonePe" vs
# "Phone Pe") that would otherwise fork a time series. Not applied to Merchant
# Categories (MCC is a stable numeric code, not a name) or Statewise (state/district
# names don't drift).
NAME_FIELDS = {
    "app_stats": "App Name",
    "psp_member_performance": "Entity Name",
    "autopay_registrations": "PSP",
    "autopay_executions": "Bank",
    "autopay_registrations_by_bank": "Remitter Bank",
    "autopay_executions_by_psp": "PSP",
}


def main():
    dry_run = "--dry-run" in sys.argv
    only = None
    for arg in sys.argv:
        if arg.startswith("--only"):
            only = set(arg.split("=", 1)[1].split(",")) if "=" in arg else None
    domains = {k: v for k, v in DOMAINS.items() if only is None or k in only}

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")

        for key, (label, pg_table, unique_cols, fetch_fn, kind) in domains.items():
            print(f"Fetching {label}...")

            if kind == "single":
                fields = fetch_fn(page)
                print(f"  Found {fields['Month']}")
                json_store.upsert_single(pg_table, unique_cols, to_pg_rows([fields])[0], dry_run)

            elif kind == "multi":
                rows = fetch_fn(page)
                if not rows:
                    print("  No rows found, skipping")
                    continue
                name_field = NAME_FIELDS.get(key)
                if name_field:
                    target_month = rows[0]["Month"]
                    known_names = json_store.distinct_values(pg_table, unique_cols[0], "month", target_month)
                    rows = normalize_names(rows, name_field, known_names)
                print(f"  Found {len(rows)} row(s) for {rows[0]['Month']}")
                if key == "statewise":
                    write_statewise_json(to_pg_rows(rows), dry_run)
                else:
                    json_store.replace_for_key(pg_table, "month", rows[0]["Month"], to_pg_rows(rows), dry_run)

            elif kind == "circulars":
                rows = fetch_circulars(page, years=[2025, 2026])
                print(f"  Found {len(rows)} circular(s)")
                json_store.upsert_many(pg_table, unique_cols, to_pg_rows(rows), dry_run)

        browser.close()

    print("Done. (P2P/P2M Transactions not included - NPCI's own site currently errors on that tab; hand-edit public/data/p2p_p2m.json when new figures are available.)")


if __name__ == "__main__":
    main()

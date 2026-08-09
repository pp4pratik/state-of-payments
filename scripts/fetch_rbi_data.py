"""
Fetches the latest RBI Bank-wise ATM/POS/Card Statistics and RBI Payment System
Indicators directly from rbi.org.in - the "fetch from source, not hand-entry" half
of the pipeline (see fetch_npci_data.py for the NPCI half). RBI's site has no bot
protection, so a plain HTTP request works.

Writes straight to the static JSON files under public/data/ that the live site
reads - see src/lib/queries.ts and scripts/json_store.py.

Usage:
    python3 scripts/fetch_rbi_data.py [--dry-run]
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

import json_store

PROJECT_DIR = Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
MONTH_NUM = {
    "January": "01", "February": "02", "March": "03", "April": "04",
    "May": "05", "June": "06", "July": "07", "August": "08",
    "September": "09", "October": "10", "November": "11", "December": "12",
}


def fetch_url(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def parse_table_rows(html):
    """Every <tr>, cells stripped of tags/&nbsp; and blanks dropped. Loses column
    alignment for rows with genuinely-empty cells, but none of the rows we read
    here have meaningful empty cells - RBI's Total row's blank Sr.No. cell is the
    only one, and it's dropped intentionally (handled by only using label+numbers)."""
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL)
    out = []
    for r in rows:
        cells = re.findall(r"<td[^>]*>(.*?)</td>", r, re.DOTALL)
        cleaned = [re.sub(r"<[^>]+>", "", c).replace("&nbsp;", " ").strip() for c in cells]
        cleaned = [c for c in cleaned if c != ""]
        if cleaned:
            out.append(cleaned)
    return out


def month_label_to_iso(month_name, year):
    return f"{year}-{MONTH_NUM[month_name]}-01"


# ---------------- RBI Cards (Bank-wise ATM/POS/Card Statistics) ----------------
# Airtable field names in the EXACT order they appear in the "Total" row (verified
# against the live page: 26 numbers after the label + blank Sr.No. cell).
RBI_CARDS_FIELDS = [
    "ATMs Onsite", "ATMs Offsite", "PoS Terminals", "Micro ATMs", "Bharat QR Codes", "UPI QR Codes",
    "Credit Cards Outstanding", "Debit Cards Outstanding",
    "Credit PoS Volume", "Credit PoS Value", "Credit Online Volume", "Credit Online Value",
    "Credit Others Volume", "Credit Others Value", "Credit ATM Withdrawal Volume", "Credit ATM Withdrawal Value",
    "Debit PoS Volume", "Debit PoS Value", "Debit Online Volume", "Debit Online Value",
    "Debit Others Volume", "Debit Others Value", "Debit ATM Withdrawal Volume", "Debit ATM Withdrawal Value",
    "Debit PoS Withdrawal Volume", "Debit PoS Withdrawal Value",
]


def fetch_rbi_cards():
    listing = fetch_url("https://rbi.org.in/Scripts/ATMView.aspx")
    ids = [int(m) for m in re.findall(r"ATMView\.aspx\?atmid=(\d+)", listing)]
    if not ids:
        sys.exit("Could not find any atmid links on the ATM statistics listing page")
    latest_id = max(ids)

    html = fetch_url(f"https://rbi.org.in/Scripts/ATMView.aspx?atmid={latest_id}")
    m = re.search(r"for the Month of ([A-Za-z]+) (\d{4})", html)
    if not m:
        sys.exit("Could not find the month heading on the RBI Cards detail page - page layout may have changed")
    month_iso = month_label_to_iso(m.group(1), m.group(2))

    rows = parse_table_rows(html)
    total_rows = [r for r in rows if r[0] == "Total"]
    if not total_rows:
        sys.exit("Could not find a 'Total' row on the RBI Cards detail page - page layout may have changed")
    total_row = total_rows[0]
    numbers = [c for c in total_row[1:] if re.match(r"^-?[\d,.]+$", c)]
    if len(numbers) != len(RBI_CARDS_FIELDS):
        sys.exit(
            f"RBI Cards Total row has {len(numbers)} numeric cells, expected {len(RBI_CARDS_FIELDS)} "
            f"- page layout may have changed. Row: {total_row}"
        )

    fields = {"Month": month_iso}
    for name, value in zip(RBI_CARDS_FIELDS, numbers):
        fields[name] = float(value.replace(",", ""))
    return fields


# ---------------- RBI Payments (Payment System Indicators) ----------------
# (match substring, Airtable field base name) in the exact order rows appear on
# the page. Rows are matched as a subsequence - i.e. any RBI row not in this list
# (like "2.6.1 of which USSD" or "6.2 Others") is simply skipped rather than
# breaking the match, so long as the rows we DO care about stay in this order.
RBIP_VOLVAL_ROWS = [
    ("CCIL Operated Systems", "CCIL Total"),
    ("Govt. Securities Clearing", "CCIL Govt Securities"),
    ("Outright", "CCIL Govt Outright"),
    ("Repo", "CCIL Govt Repo"),
    ("Tri-party Repo", "CCIL Govt Tri-party Repo"),
    ("Forex Clearing", "CCIL Forex"),
    ("Rupee Derivatives", "CCIL Rupee Derivatives"),
    ("Credit Transfers - RTGS", "RTGS Total"),
    ("Customer Transactions", "RTGS Customer"),
    ("Interbank Transactions", "RTGS Interbank"),
    ("Credit Transfers - Retail", "Retail Credit Transfers"),
    ("AePS (Fund Transfers)", "AePS Fund Transfers"),
    ("APBS", "APBS"),
    ("IMPS", "IMPS"),
    ("NACH Cr", "NACH Credit"),
    ("NEFT", "NEFT"),
    ("UPI", "UPI"),
    ("Debit Transfers and Direct Debits", "Debit Transfers"),
    ("BHIM Aadhaar Pay", "BHIM Aadhaar Pay"),
    ("NACH Dr", "NACH Debit"),
    ("NETC (linked to bank account)", "NETC Linked Account"),
    ("Card Payments", "Card Payments"),
    ("Credit Cards", "Credit Cards"),
    ("PoS based", "Credit Cards PoS"),
    ("Others", "Credit Cards Other"),
    ("Debit Cards", "Debit Cards"),
    ("PoS based", "Debit Cards PoS"),
    ("Others", "Debit Cards Other"),
    ("Prepaid Payment Instruments", "PPI Total"),
    ("Wallets", "PPI Wallets"),
    ("Cards", "PPI Cards"),
    ("PoS based", "PPI Cards PoS"),
    ("Others", "PPI Cards Other"),
    ("Paper-based Instruments", "Paper Instruments"),
    ("CTS (NPCI Managed)", "Paper CTS"),
    ("Total Retail Payments", "Total Retail Payments"),
    ("Total Payments", "Total Payments"),
    ("Total Digital Payments", "Total Digital Payments"),
    ("Mobile Payments (mobile app based)", "Mobile Payments"),
    ("Intra-bank", "Mobile Intrabank"),
    ("Inter-bank", "Mobile Interbank"),
    ("Internet Payments", "Internet Payments"),
    ("Intra-bank", "Internet Intrabank"),
    ("Inter-bank", "Internet Interbank"),
    ("Cash Withdrawal at ATMs", "ATM Cash Withdrawal"),
    ("Using Credit Cards", "ATM Withdrawal Credit Card"),
    ("Using Debit Cards", "ATM Withdrawal Debit Card"),
    ("Using Pre-paid Cards", "ATM Withdrawal Prepaid Card"),
    ("Cash Withdrawal at PoS", "PoS Cash Withdrawal"),
    ("Using Debit Cards", "PoS Withdrawal Debit Card"),
    ("Using Pre-paid Cards", "PoS Withdrawal Prepaid Card"),
    ("Cash Withdrawal at Micro ATMs", "Micro ATM Withdrawal"),
    ("AePS", "Micro ATM AePS"),
]
RBIP_COUNT_ROWS = [
    ("Number of Cards", "Cards Total Count"),
    ("Credit Cards", "Credit Cards Count"),
    ("Debit Cards", "Debit Cards Count"),
    ("Number of PPIs", "PPI Total Count"),
    ("Wallets", "PPI Wallets Count"),
    ("Cards", "PPI Cards Count"),
    ("Number of ATMs and CRMs", "ATMs and CRMs Count"),
    ("Bank owned ATMs", "Bank Owned ATMs Count"),
    ("White Label ATMs", "White Label ATMs Count"),
    ("Number of Micro ATMs", "Micro ATMs Count"),
    ("Number of PoS Terminals", "PoS Terminals Count"),
    ("Bharat QR", "Bharat QR Count"),
    ("UPI QR", "UPI QR Count"),
]


def strip_row_number(label):
    # "2.6 UPI @" -> "UPI @"; "3. Cash Withdrawal at ATMs $" -> "Cash Withdrawal at ATMs $"
    label = re.sub(r"^[\d.]+\.?\s*", "", label)
    return re.sub(r"[@$#*]", "", label).strip()


def match_rows(rows, expected, numbers_per_row):
    """Subsequence match: walk `rows` once, consuming `expected` entries in order.
    Rows not matching the next expected label are skipped (section headers, rows
    outside our schema like footnoted sub-rows). Raises if any expected row is
    never found, since that means RBI's page structure changed under us."""
    results = {}
    expected_iter = iter(expected)
    current = next(expected_iter, None)
    for row in rows:
        if current is None:
            break
        label = strip_row_number(row[0])
        numbers = [c for c in row[1:] if re.match(r"^-?[\d,.]+$", c)]
        if len(numbers) != numbers_per_row:
            continue
        match_substr, field_name = current
        if match_substr.lower() in label.lower():
            results[field_name] = numbers
            current = next(expected_iter, None)
    if current is not None:
        sys.exit(f"RBI Payments page structure changed - could not find row for '{current[1]}' ({current[0]})")
    return results


def fetch_rbi_payments():
    listing = fetch_url("https://rbi.org.in/Scripts/PSIUserView.aspx")
    ids = [int(m) for m in re.findall(r"PSIUserView\.aspx\?Id=(\d+)", listing)]
    if not ids:
        sys.exit("Could not find any Id links on the Payment System Indicators listing page")
    latest_id = max(ids)

    html = fetch_url(f"https://rbi.org.in/Scripts/PSIUserView.aspx?Id={latest_id}")
    m = re.search(r"Payment System Indicators - ([A-Za-z]+) (\d{4})", html)
    if not m:
        sys.exit("Could not find the month heading on the RBI Payments detail page - page layout may have changed")
    month_iso = month_label_to_iso(m.group(1), m.group(2))

    rows = parse_table_rows(html)
    volval = match_rows(rows, RBIP_VOLVAL_ROWS, numbers_per_row=8)
    counts = match_rows(rows, RBIP_COUNT_ROWS, numbers_per_row=4)

    fields = {"Month": month_iso}
    for base, numbers in volval.items():
        # 4 volume periods then 4 value periods; last of each block is the latest month.
        fields[f"{base} Volume"] = float(numbers[3].replace(",", ""))
        fields[f"{base} Value"] = float(numbers[7].replace(",", ""))
    for base, numbers in counts.items():
        fields[base] = float(numbers[3].replace(",", ""))
    return fields


def snake(label):
    return re.sub(r"^_+|_+$", "", re.sub(r"[^a-z0-9]+", "_", label.lower()))


def main():
    dry_run = "--dry-run" in sys.argv

    print("Fetching RBI Cards (Bank-wise ATM/POS/Card Statistics)...")
    cards_fields = fetch_rbi_cards()
    print(f"  Found {cards_fields['Month']} ({len(cards_fields) - 1} metrics)")
    cards_row = {snake(k) if k != "Month" else "month": v for k, v in cards_fields.items()}
    json_store.upsert_single("rbi_cards", ["month"], cards_row, dry_run)

    print("Fetching RBI Payments (Payment System Indicators)...")
    payments_fields = fetch_rbi_payments()
    print(f"  Found {payments_fields['Month']} ({len(payments_fields) - 1} metrics)")
    payments_row = {snake(k) if k != "Month" else "month": v for k, v in payments_fields.items()}
    json_store.upsert_single("rbi_payments", ["month"], payments_row, dry_run)

    print("Done.")


if __name__ == "__main__":
    main()

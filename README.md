# UPI Pulse — State of Payments

A single-page dashboard tracking India's UPI/AutoPay ecosystem and RBI payment-systems data (UPI / UPI AutoPay / RBI Cards / RBI Payments / Circulars), reading straight from static JSON files.

## Architecture

- **Data store**: static JSON under `public/data/` (one file per table) and `public/statewise-historical/` (Geography, one file per month plus an `index.json` manifest — its per-month payload can run to ~780 districts, too big to lump into one array like every other table). No database, no backend — see `scripts/json_store.py` for the shared read/write helpers every fetcher script uses.
- **Ingestion**: two scripts fetch straight from the original government sources and write directly to those JSON files:
  - **RBI data** (RBI Cards, RBI Payments) — `scripts/fetch_rbi_data.py`. No bot protection on RBI's side, so a plain HTTP request + HTML table parse works.
  - **NPCI data** (UPI monthly trend, app stats, merchant categories, geography, AutoPay, PSP member performance, circulars) — `scripts/fetch_npci_data.py`. NPCI's stats pages call a clean JSON API under the hood, but it's behind Akamai bot protection that blocks plain HTTP requests (`curl` gets a 403); a real (headless) browser passes straight through with no extra work, so this uses [Playwright](https://playwright.dev) instead of `urllib`.
  - **Not yet automated**: P2P/P2M Transactions. NPCI's own ecosystem-statistics page currently 500s on that specific tab for every month tested — confirmed via both the live UI and the raw API endpoint, so it's a bug on NPCI's end, not something fixable client-side. Hand-edit `public/data/p2p_p2m.json` directly when new figures are available until they fix it.
- **Frontend**: Vite + React + TypeScript, single page (`src/routes/index.tsx`) with a view switcher rather than separate routes — one dropdown swapping between UPI/AutoPay/RBI Cards/RBI Payments/Circulars, plus a shared Volume/Value toggle and Year/Month selector. [TanStack Query](https://tanstack.com/query) fetches each JSON file once and caches it (see `src/lib/queries.ts`); [Chart.js](https://www.chartjs.org/) (via `react-chartjs-2`) renders the bar+line, donut, and line charts. Numbers are normalized to a single **Crore** unit throughout (see `src/lib/format.ts`).
- **Hosting**: GitHub Pages, deployed via GitHub Actions on every push to `main` — the JSON files ship as part of the static build, so there's nothing else to deploy or provision.

## Local development

```bash
npm install
npm run dev
```

No `.env` needed for the app itself — everything it reads is static JSON already committed under `public/`.

To pull the latest RBI Cards / RBI Payments month straight from rbi.org.in:

```bash
python3 scripts/fetch_rbi_data.py           # run for real
python3 scripts/fetch_rbi_data.py --dry-run # parse and print without writing anything
```

To pull the latest NPCI data (monthly trend, app stats, merchant categories, geography, AutoPay, PSP member performance, circulars) straight from npci.org.in:

```bash
pip install playwright && playwright install chromium   # one-time setup

python3 scripts/fetch_npci_data.py                              # everything
python3 scripts/fetch_npci_data.py --dry-run                    # preview without writing
python3 scripts/fetch_npci_data.py --only=circulars,app_stats   # just specific domains
```

Multi-row-per-month tables (app stats, merchant categories, geography, PSP member performance, AutoPay) replace that month's rows wholesale in their JSON file (`json_store.replace_for_key`) rather than trying to match individual entities row-by-row across runs — a renamed or dropped entity's stale row for that month doesn't linger. Entity names prone to spelling drift across months (app names, PSP/bank names) get snapped back to their already-established spelling via `normalize_names`, checked against every *other* month already in the file.

Neither script needs any `.env` — both scrape their source directly and write to `public/data/`. Run manually once a new month is published — nothing is scheduled yet.

## Deployment

Pushing to `main` builds via `npm run build` and publishes `dist/` to GitHub Pages through `.github/workflows/deploy.yml`. The site currently lives at the GitHub Pages project URL (`base: '/state-of-payments/'` in `vite.config.ts`); if a custom domain is attached later, change that to `'/'` and redeploy.

## Known gaps

- No combined "download all data" export yet — every section has its own CSV button, but there's no single per-view export.
- AutoPay's weighted approval/business-decline/technical-decline rates are computed live from `psp_member_performance` (volume-weighted average) rather than reproduced as a frozen snapshot.

## Disclaimer

All figures ultimately come from NPCI's and RBI's official statistics and circulars pages. This project is not affiliated with or endorsed by NPCI or RBI.

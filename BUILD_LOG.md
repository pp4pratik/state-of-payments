# UPI Pulse — Build Log

A running record of how this project got built, the tools involved, and the
lessons learned along the way. Update this file as work continues — add a
dated entry under **Timeline** for anything non-trivial, and add to
**Learnings** whenever something costs real time to figure out, so the next
project doesn't pay for it twice.

## What this project is

`state-of-payments` (branded **UPI Pulse**) is a single-page dashboard
tracking India's UPI/AutoPay ecosystem and RBI payment-systems data, reading
from static JSON files scraped directly from NPCI/RBI. Deployed to GitHub
Pages.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vite + React 19 + TypeScript |
| Routing | TanStack Router (single route; view-switching is client state, not real routes) |
| Data fetching / cache | TanStack Query |
| Charts | Chart.js via `react-chartjs-2` |
| Icons | `lucide-react` |
| Analytics | PostHog (`posthog-js`, gated behind `VITE_POSTHOG_KEY`) |
| Data store | Static JSON under `public/data/` and `public/statewise-historical/` - no backend |
| Data pipelines | Python scripts (`scripts/*.py`), scraping NPCI/RBI directly, writing straight to JSON |
| Scraping | Playwright (headless Chromium) for NPCI — plain HTTP is blocked by Akamai |
| Lint | `oxlint` |
| CI/CD | GitHub Actions → GitHub Pages, triggered on push to `main` |
| Styling | Plain CSS (`src/index.css`), no Tailwind/component library |

## Timeline

- **2026-08-03 — Scaffold and first data wiring.** Vite+React+TS app shell,
  GitHub Actions deploy to Pages, Postgres schema mirroring the 11 Airtable
  tables, Airtable→Supabase sync script, initial routed pages (Overview, All
  Apps, Spending, Geography, AutoPay, RBI, Circulars).
- **2026-08-03 — Rebuilt as single-page dashboard.** Scrapped the routed
  multi-page structure for one page with a view-switcher dropdown, Chart.js
  instead of Recharts, Crore-only number formatting. Added Lucide icons
  throughout.
- **2026-08-04 — PostHog analytics.**
- **2026-08-08 — Direct-fetch pipelines, bypassing Airtable as the source of
  truth.** Built `fetch_rbi_data.py` (RBI Cards/Payments, plain HTTP) and
  `fetch_npci_data.py` (UPI/AutoPay ecosystem stats, Playwright — NPCI blocks
  plain requests). Both write to Airtable *and* Supabase, Airtable kept as a
  human-editable audit trail rather than the primary source.
- **2026-08-08 — Data-quality bug fixes.** Fixed Supabase stale-row
  accumulation on renamed/dropped entities, Statewise double-counting from
  redundant state-total rows, App Trend chart forking a line because NPCI
  spells "PhonePe" inconsistently month to month, Geography table showing
  hundreds of unranked districts instead of a clean top 10.
- **2026-08-08 — AutoPay rebuilt around Total-vs-Final volume.** NPCI's
  Approved %/BD %/TD % fields were being fetched but never surfaced;
  restructured AutoPay's KPI tiles and charts around "Total Volume
  (attempts)" vs "Final Volume (Total × Approved %)," then discovered NPCI
  actually publishes AutoPay broken down *two* ways (by PSP and by remitter
  bank, for both Registration and Execution) and added a toggle plus two new
  Airtable/Supabase tables to cover the missing pair.
- **2026-08-08 — Visual polish pass, then a full redesign.** First pass:
  hover states, shadows, entrance animations, count-up KPI numbers, table
  row hover, icon accents — additive, no layout changes. Second pass (this
  session, on request): frosted-glass sticky header, gradient card/KPI
  surfaces, bumped type scale, gradient-fill charts. Kept the existing
  marigold/teal brand palette rather than swapping to a generic SaaS color.
- **2026-08-08 — Removed the non-functional "Download all data" CSV
  button** — it had been wired to a permanent no-op since the single-page
  rebuild; every section already has its own working CSV export.

*(Append new entries above this line, newest at the bottom, dated
`YYYY-MM-DD`.)*

## Learnings (read before starting the next site)

### Data pipeline / backend

- **Upsert never deletes.** Postgres `on_conflict` upsert only adds/updates
  rows present in the new batch — it will never remove a row that dropped
  out (renamed entity, delisted bank, etc.). Any "replace this month's data"
  flow needs an explicit second pass: upsert first, then delete whatever's
  left over for that period whose natural key isn't in the fresh batch.
- **Create before delete, always.** For any destructial "replace" write
  (Airtable *or* Supabase), create the new rows first and only delete the
  old ones after the create succeeds. Deleting first and creating second
  means a single validation error mid-batch leaves the table empty until
  someone notices and re-runs it by hand.
- **Upstream data is not stable.** NPCI's own entity-name spelling drifts
  month to month ("PhonePe" → "Phone Pe"). If a chart/table is keyed by raw
  name, treat the incoming name as untrusted and normalize it against
  already-established spellings (case/whitespace-insensitive match) before
  keying anything by it — otherwise one spelling hiccup silently forks a
  time series into two.
  - When building the "known good" reference set for that normalization,
    **exclude the month you're currently writing** from the query — otherwise
    a bad spelling written in a previous buggy run becomes the "established"
    name and self-perpetuates.
- **No DDL over PostgREST.** Supabase's REST API can do row CRUD but not
  `ALTER TABLE`/`CREATE TABLE`. Any schema change means writing the SQL and
  asking the human to run it in the Supabase SQL Editor — budget for that
  round-trip, don't assume it's scriptable end-to-end.
- **Airtable's Meta API *can* create tables and fields programmatically**
  (`POST /v0/meta/bases/{base}/tables`, `.../fields`) — confirmed working
  with a standard API token. Useful to know before assuming schema changes
  need manual Airtable UI work.
- **Field-name → column-name derivation must be exact and centralized.**
  This project auto-derives Postgres column names from Airtable field labels
  via a `snake()` helper (lowercase, spaces→underscores, `%`→`pct` handled
  *before* the generic non-alnum collapse). If a new field's derived name
  doesn't match what you hand-wrote in `table_map.json` / migration SQL
  (e.g. "Remitter Bank" → `remitter_bank`, not `bank`), every upsert 400s on
  "column not found." Always compute the derived name and check it before
  wiring a new field through, don't guess.
- **A scraping target with bot protection may just need a real browser.**
  NPCI's Akamai protection blocks plain `curl`/`urllib` (403) but a headless
  Playwright Chromium session passes straight through with zero extra
  cookie/session/header work. Try the expensive-looking option before
  building a workaround for the cheap one.
- **Undocumented API params are discoverable by watching the network tab
  live**, not by guessing. NPCI's stats API has `tab_name`/`type_name`
  query params with non-obvious values (`psp-wise-execution`,
  `top50-remitter` + `type_name=reg`) that only surfaced by driving the real
  site in a browser and reading the actual requests it made.
- **Don't assume a metric exists just because a sibling metric does.**
  AutoPay has no "Value (₹)" figure anywhere in NPCI's published data — only
  Volume/counts. Confirmed by checking the raw API response shape and the
  site's own stats-page nav, not by assumption. Building a Volume/Value
  toggle for a dataset that has no Value dimension would have been building
  UI around data that doesn't exist.

### Frontend / TypeScript

- **`Array.prototype.reduce` overload resolution gotcha:** if the array's
  element type is a union like `(number | null)[]` and you pass a literal
  initial value like `0`, TypeScript can silently pick the non-generic
  overload (accumulator typed as the *array's* element type) instead of
  inferring the generic from your initial value — producing `'s' is
  possibly null` even though the initial value is clearly a number. Fix:
  force it with an explicit generic, `arr.reduce<number>((s, v) => ..., 0)`.
  This passed a plain `tsc --noEmit` locally but only surfaced under the
  project's real build (`tsc -b --noEmit`, project-references mode) — always
  run the actual `npm run build` before calling something verified, not just
  a loose type-check.
- **Hooks must run in the same order on every render — including custom
  hooks that wrap `useState`/`useEffect` (like a `useCountUp` animation
  hook).** If a component has an early `return` for loading/error state
  before the hook call, the hook simply won't run until data loads, and
  React throws "rendered more/fewer hooks than previous render" the moment
  it does. Fix: hoist the *value* the hook depends on above the early
  return (compute it from `query.data?.rows ?? []` so it's safe pre-load),
  call the hook unconditionally, and only branch on loading/error in the
  JSX return itself.
- **Chart.js gradient fills need the `Filler` plugin registered explicitly**
  (`Chart.register(Filler, ...)`) — a dataset with `fill: true` silently
  does nothing without it, no error, no warning.
- Scriptable Chart.js options (`backgroundColor: (ctx) => ...` for
  per-pixel gradients) need an explicit `ScriptableContext<'bar' | 'line'>`
  type import from `chart.js` inside a mixed bar+line dataset array — bare
  arrow functions don't get contextual typing there and TS flags the param
  as implicit `any`.

### Environment / tooling

- A project directory path containing an `&` character broke the browser
  preview tool's separate launcher subprocess (`getcwd: Operation not
  permitted`) even though the same `npm run dev` worked fine invoked
  directly via the shell. Workaround: start the dev server via the shell
  directly, then point the browser preview at the resulting `localhost` URL
  instead of letting the preview tool spawn the process itself.
- Vite serves under the same base path as the production deploy
  (`/state-of-payments/`, from `vite.config`) — remember to navigate to that
  path locally too, not bare `localhost:5173/`.
- When asking the user to scope a fuzzy request ("make it better," "redesign
  this"), keep clarifying questions to one short round — answers tend to
  come back terse/minimal ("no preference"), so default to a sensible,
  conservative interpretation rather than asking repeatedly.

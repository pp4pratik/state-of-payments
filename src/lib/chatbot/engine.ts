// Rule-based question-answering over the dashboard's own static JSON data - no AI
// model, no API key, no backend. Parses a question into (domain, operation, month(s),
// entity/entities), computes real numbers from whatever's already been fetched by
// the dashboard's TanStack Query hooks, and formats a plain-English answer. Scoped
// deliberately to this site's own dataset (see CLAUDE.md) - it will say so rather
// than guess when a question falls outside what's actually in public/data/.
import { mnToCr, rbiCountToCr, rbiValueToCr, lakhToCr } from '../format'
import type {
  MonthlyTrendRow,
  AppStatsAll,
  P2pRow,
  CategoryRow,
  GeoRow,
  AutoPayRegistrationRow,
  AutoPayExecutionRow,
  AutoPayRegistrationByBankRow,
  AutoPayExecutionByPspRow,
  PspPerformanceRow,
  RbiCardsRow,
  CircularRow,
} from '../queries'
import {
  resolveMonths,
  findEntityMentions,
  detectOperation,
  detectN,
  detectDirection,
  mentions,
} from './nlp'

export type ChatbotData = {
  monthlyTrend: MonthlyTrendRow[]
  appStats: AppStatsAll
  p2p: P2pRow[]
  merchantCategories: Record<string, CategoryRow[]>
  statewise: { byMonth: Record<string, GeoRow[]>; granularityByMonth: Record<string, 'State' | 'District'> }
  autoPayRegistrations: { month: string; rows: AutoPayRegistrationRow[] }
  autoPayExecutions: { month: string; rows: AutoPayExecutionRow[] }
  autoPayRegistrationsByBank: { month: string; rows: AutoPayRegistrationByBankRow[] }
  autoPayExecutionsByPsp: { month: string; rows: AutoPayExecutionByPspRow[] }
  pspMemberPerformance: { month: string; rows: PspPerformanceRow[] }
  rbiCards: RbiCardsRow[]
  rbiPayments: Record<string, number | string>[]
  circulars: CircularRow[]
}

export type ChatAnswer = {
  text: string
  table?: { headers: string[]; rows: (string | number)[][] }
}

const FALLBACK_HELP =
  "I can only answer questions about the data on this site - UPI headline stats, app-wise UPI stats, AutoPay, RBI Cards, RBI Payments, Geography, and Circulars. Try naming a month, an app/bank/state, or asking to compare or rank something."

// ---------------- Shared formatting ----------------
function fmtMonth(iso: string): string {
  const [y, m] = iso.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
function fmtCrTxns(v: number | null): string {
  return v == null || !isFinite(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: v < 1 ? 3 : 2 }) + ' Cr transactions'
}
function fmtRupeesCr(v: number | null): string {
  return v == null || !isFinite(v) ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' Cr'
}
function fmtCount(v: number | null, suffix = ''): string {
  return v == null || !isFinite(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + (suffix ? ` ${suffix}` : '')
}
function fmtPercent(v: number | null): string {
  return v == null || !isFinite(v) ? '—' : v.toFixed(2) + '%'
}
function fmtShare(v: number | null): string {
  return v == null || !isFinite(v) ? '—' : v.toFixed(2) + '% of the national total'
}

function fmtDelta(current: number, previous: number): string {
  if (!previous) return 'n/a'
  const pct = ((current - previous) / Math.abs(previous)) * 100
  return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'
}

// ---------------- Generic compare/rank/growth builders ----------------
function buildCompareAnswer(
  label: string,
  monthLabel: string,
  a: { name: string; value: number | null },
  b: { name: string; value: number | null },
  fmt: (v: number | null) => string,
): ChatAnswer {
  if (a.value == null && b.value == null) {
    return { text: `I couldn't find ${label.toLowerCase()} data for ${a.name} or ${b.name} in ${monthLabel}.` }
  }
  const aVal = a.value ?? 0
  const bVal = b.value ?? 0
  const leader = aVal >= bVal ? a : b
  const trailer = aVal >= bVal ? b : a
  const leaderVal = aVal >= bVal ? aVal : bVal
  const trailerVal = aVal >= bVal ? bVal : aVal
  const delta = fmtDelta(leaderVal, trailerVal)
  return {
    text: `${label} in ${monthLabel} — ${a.name}: ${fmt(a.value)}, ${b.name}: ${fmt(b.value)}. ${leader.name} is ahead of ${trailer.name} by ${delta}.`,
    table: { headers: ['Entity', 'Value'], rows: [[a.name, fmt(a.value)], [b.name, fmt(b.value)]] },
  }
}

function buildGrowthAnswer(
  label: string,
  name: string,
  earlier: { month: string; value: number | null },
  later: { month: string; value: number | null },
  fmt: (v: number | null) => string,
): ChatAnswer {
  if (earlier.value == null || later.value == null) {
    return { text: `I don't have both months of ${label.toLowerCase()} data for ${name} to compare.` }
  }
  const dir = later.value >= earlier.value ? 'up' : 'down'
  return {
    text: `${label} for ${name}: ${fmt(earlier.value)} in ${fmtMonth(earlier.month)} → ${fmt(later.value)} in ${fmtMonth(later.month)} (${dir} ${fmtDelta(later.value, earlier.value)}).`,
  }
}

function buildRankAnswer(
  label: string,
  monthLabel: string,
  ranked: { name: string; value: number | null }[],
  n: number,
  direction: 'asc' | 'desc',
  fmt: (v: number | null) => string,
): ChatAnswer {
  const sorted = ranked
    .filter((r) => r.value != null)
    .sort((a, b) => (direction === 'desc' ? b.value! - a.value! : a.value! - b.value!))
    .slice(0, n)
  if (!sorted.length) return { text: `I couldn't find ranked data for ${monthLabel}.` }
  const lines = sorted.map((r, i) => `${i + 1}. ${r.name} — ${fmt(r.value)}`)
  return {
    text: `${label} (${monthLabel}):\n${lines.join('\n')}`,
    table: { headers: ['Rank', 'Name', 'Value'], rows: sorted.map((r, i) => [i + 1, r.name, fmt(r.value)]) },
  }
}

// Shared branching for every entity-based domain (app_stats, statewise,
// psp_member_performance, autopay x4, merchant_categories, p2p): rank -> compare
// two entities -> growth of one entity across two months -> plain lookup.
function runEntityQuery(params: {
  text: string
  monthsAsc: string[]
  entityCandidates: string[]
  valueAt: (entity: string, monthIso: string) => number | null
  fmt: (v: number | null) => string
  label: string
  rankAll: (monthIso: string) => { name: string; value: number | null }[]
  noEntityPrompt: string
}): ChatAnswer {
  const { text, monthsAsc, entityCandidates, valueAt, fmt, label, rankAll, noEntityPrompt } = params
  if (!monthsAsc.length) return { text: "I don't have data for that yet." }
  const op = detectOperation(text)
  const resolvedMonths = resolveMonths(text, monthsAsc)
  const latestMonth = monthsAsc[monthsAsc.length - 1]

  if (op === 'rank') {
    const n = detectN(text)
    const dir = detectDirection(text)
    const monthIso = resolvedMonths[0] ?? latestMonth
    return buildRankAnswer(label, fmtMonth(monthIso), rankAll(monthIso), n, dir, fmt)
  }

  const entities = findEntityMentions(text, entityCandidates, 2)
  if (entities.length >= 2) {
    const monthIso = resolvedMonths[0] ?? latestMonth
    return buildCompareAnswer(
      label,
      fmtMonth(monthIso),
      { name: entities[0], value: valueAt(entities[0], monthIso) },
      { name: entities[1], value: valueAt(entities[1], monthIso) },
      fmt,
    )
  }

  const entityName = entities[0]
  if (!entityName) return { text: noEntityPrompt }

  if (resolvedMonths.length >= 2) {
    const [m1, m2] = resolvedMonths
    return buildGrowthAnswer(label, entityName, { month: m1, value: valueAt(entityName, m1) }, { month: m2, value: valueAt(entityName, m2) }, fmt)
  }

  const monthIso = resolvedMonths[0] ?? latestMonth
  return { text: `${entityName}'s ${label.toLowerCase()} in ${fmtMonth(monthIso)}: ${fmt(valueAt(entityName, monthIso))}.` }
}

// ---------------- Domain: Monthly Trend (UPI headline) ----------------
function handleMonthlyTrend(text: string, rows: MonthlyTrendRow[]): ChatAnswer {
  if (!rows.length) return { text: "I don't have UPI headline data yet." }
  const months = rows.map((r) => r.month)
  const wantsBanks = /\bbank/i.test(text)
  const wantsValue = !wantsBanks && /\b(value|worth|amount|rupees|₹)\b/i.test(text)
  const label = wantsBanks ? 'Banks live on UPI' : wantsValue ? 'UPI transaction value' : 'UPI transaction volume'
  const fmt = (v: number | null) => (wantsBanks ? fmtCount(v, 'banks') : wantsValue ? fmtRupeesCr(v) : fmtCrTxns(v))
  const getValue = (row: MonthlyTrendRow) => (wantsBanks ? row.banks_live : wantsValue ? row.total_value_cr : mnToCr(row.total_volume_mn))

  const resolvedMonths = resolveMonths(text, months)
  const op = detectOperation(text)

  if (op === 'trend' || resolvedMonths.length >= 2) {
    const m1 = resolvedMonths[0] ?? months[Math.max(0, months.length - 13)]
    const m2 = resolvedMonths[1] ?? months[months.length - 1]
    const r1 = rows.find((r) => r.month === m1)
    const r2 = rows.find((r) => r.month === m2)
    return buildGrowthAnswer(label, 'UPI', { month: m1, value: r1 ? getValue(r1) : null }, { month: m2, value: r2 ? getValue(r2) : null }, fmt)
  }

  const monthIso = resolvedMonths[0] ?? months[months.length - 1]
  const row = rows.find((r) => r.month === monthIso)
  if (!row) return { text: `I don't have UPI data for ${fmtMonth(monthIso)}.` }
  return { text: `${label} in ${fmtMonth(monthIso)}: ${fmt(getValue(row))}.` }
}

// ---------------- Domain: App Stats ----------------
function handleAppStats(text: string, appStats: AppStatsAll): ChatAnswer {
  const { months, byApp } = appStats
  const wantsValue = /\b(value|worth|amount|revenue|₹)\b/i.test(text)
  const fmt = wantsValue ? fmtRupeesCr : fmtCrTxns
  const getValue = (app: string, monthIso: string): number | null => {
    const series = byApp[app]
    if (!series) return null
    const idx = months.indexOf(monthIso)
    if (idx === -1) return null
    return wantsValue ? series.val[idx] ?? null : mnToCr(series.vol[idx])
  }
  return runEntityQuery({
    text,
    monthsAsc: months,
    entityCandidates: Object.keys(byApp),
    valueAt: getValue,
    fmt,
    label: `UPI ${wantsValue ? 'value' : 'volume'}`,
    rankAll: (monthIso) => Object.keys(byApp).map((name) => ({ name, value: getValue(name, monthIso) })),
    noEntityPrompt: 'Which app did you mean? Try naming it directly, e.g. "PhonePe volume in June" or "compare PhonePe and Paytm".',
  })
}

// ---------------- Domain: Merchant Categories ----------------
function handleMerchantCategories(text: string, byMonth: Record<string, CategoryRow[]>): ChatAnswer {
  const months = Object.keys(byMonth).sort()
  const wantsValue = /\b(value|worth|amount|₹)\b/i.test(text)
  const fmt = wantsValue ? fmtRupeesCr : fmtCrTxns
  const allNames = [...new Set(months.flatMap((m) => byMonth[m].map((r) => r.name)))]
  const getValue = (name: string, monthIso: string): number | null => {
    const row = byMonth[monthIso]?.find((r) => r.name === name)
    if (!row) return null
    return wantsValue ? row.val : mnToCr(row.vol)
  }
  return runEntityQuery({
    text,
    monthsAsc: months,
    entityCandidates: allNames,
    valueAt: getValue,
    fmt,
    label: `Merchant category ${wantsValue ? 'value' : 'volume'}`,
    rankAll: (monthIso) => (byMonth[monthIso] ?? []).map((r) => ({ name: r.name, value: wantsValue ? r.val : mnToCr(r.vol) })),
    noEntityPrompt: 'Which merchant category did you mean? Try "top 5 merchant categories in June" or naming one directly.',
  })
}

// ---------------- Domain: Statewise / Geography ----------------
function handleStatewise(text: string, statewise: ChatbotData['statewise']): ChatAnswer {
  const months = Object.keys(statewise.byMonth).sort()
  const wantsValue = /\b(value|worth|amount|₹)\b/i.test(text)
  const allStates = [...new Set(months.flatMap((m) => statewise.byMonth[m].map((r) => r.state)))]
  const allDistricts = [...new Set(months.flatMap((m) => statewise.byMonth[m].map((r) => r.name)))]
  const candidates = [...new Set([...allStates, ...allDistricts])]

  const stateOrDistrictValue = (name: string, monthIso: string): number | null => {
    const rows = statewise.byMonth[monthIso] ?? []
    const stateMatch = rows.filter((r) => r.state.toLowerCase() === name.toLowerCase())
    if (stateMatch.length) {
      const sum = stateMatch.reduce((s, r) => s + (wantsValue ? r.val : r.vol), 0)
      return sum
    }
    const districtMatch = rows.find((r) => r.name.toLowerCase() === name.toLowerCase())
    return districtMatch ? (wantsValue ? districtMatch.val : districtMatch.vol) : null
  }

  const rankAllStates = (monthIso: string) => {
    const rows = statewise.byMonth[monthIso] ?? []
    const byState = new Map<string, number>()
    for (const r of rows) {
      // NPCI's own "Unclassified" catch-all (transactions it couldn't attribute to
      // a state) is real data and stays queryable by name, but it isn't a state -
      // topping a "top states" ranking with it would be misleading, not useful.
      if (r.state.trim().toLowerCase() === 'unclassified') continue
      byState.set(r.state, (byState.get(r.state) ?? 0) + (wantsValue ? r.val : r.vol))
    }
    return [...byState.entries()].map(([name, value]) => ({ name, value }))
  }

  return runEntityQuery({
    text,
    monthsAsc: months,
    entityCandidates: candidates,
    valueAt: stateOrDistrictValue,
    fmt: fmtShare,
    label: `UPI ${wantsValue ? 'value' : 'volume'} share`,
    rankAll: rankAllStates,
    noEntityPrompt: 'Which state or district did you mean? Try "top 5 states in June" or naming one directly, e.g. "Maharashtra\'s UPI share in June".',
  })
}

// ---------------- Domain: PSP Member Performance ----------------
function handlePspPerformance(text: string, data: { month: string; rows: PspPerformanceRow[] }): ChatAnswer {
  const months = data.month ? [data.month] : []
  const direction: 'Remitter' | 'Beneficiary' = /\bbeneficiary|receiv/i.test(text) ? 'Beneficiary' : 'Remitter'
  const rows = data.rows.filter((r) => r.direction === direction)
  const metric: 'approved_pct' | 'bd_pct' | 'td_pct' | 'volume' = /\bapprov/i.test(text)
    ? 'approved_pct'
    : /\bbd\b|business decline/i.test(text)
      ? 'bd_pct'
      : /\btd\b|technical decline/i.test(text)
        ? 'td_pct'
        : 'volume'
  const fmt = metric === 'volume' ? fmtCrTxns : fmtPercent
  const getValue = (name: string): number | null => {
    const row = rows.find((r) => r.entity_name === name)
    if (!row) return null
    return metric === 'volume' ? mnToCr(row.volume_mn) : row[metric]
  }
  return runEntityQuery({
    text,
    monthsAsc: months,
    entityCandidates: rows.map((r) => r.entity_name),
    valueAt: getValue,
    fmt,
    label: `${direction} UPI ${metric === 'volume' ? 'volume' : metric === 'approved_pct' ? 'approval rate' : metric === 'bd_pct' ? 'business decline rate' : 'technical decline rate'}`,
    rankAll: () => rows.map((r) => ({ name: r.entity_name, value: metric === 'volume' ? mnToCr(r.volume_mn) : r[metric] })),
    noEntityPrompt: 'Which bank or PSP did you mean? Try "top 5 banks by approval rate" or naming one directly.',
  })
}

// ---------------- Domain: AutoPay (4 tables) ----------------
function handleAutoPay(text: string, data: ChatbotData): ChatAnswer {
  const isExecution = /\bexecut/i.test(text) && !/\bregist|mandate/i.test(text)
  const byBank = /\bby bank|remitter bank/i.test(text)
  const byPsp = /\bby psp\b/i.test(text)

  let source: { month: string; rows: Record<string, unknown>[] }
  let entityField: string
  let opLabel: string
  if (isExecution) {
    if (byPsp) {
      source = data.autoPayExecutionsByPsp as unknown as typeof source
      entityField = 'psp'
    } else {
      source = data.autoPayExecutions as unknown as typeof source
      entityField = 'bank'
    }
    opLabel = 'AutoPay executions'
  } else {
    if (byBank) {
      source = data.autoPayRegistrationsByBank as unknown as typeof source
      entityField = 'remitter_bank'
    } else {
      source = data.autoPayRegistrations as unknown as typeof source
      entityField = 'psp'
    }
    opLabel = 'AutoPay registrations'
  }

  const months = source.month ? [source.month] : []
  const metric: 'approved_pct' | 'bd_pct' | 'td_pct' | 'count' = /\bapprov/i.test(text)
    ? 'approved_pct'
    : /\bbd\b|business decline/i.test(text)
      ? 'bd_pct'
      : /\btd\b|technical decline/i.test(text)
        ? 'td_pct'
        : 'count'
  const countKey = isExecution ? 'executions_mn' : 'registrations_mn'
  const fmt = metric === 'count' ? fmtCrTxns : fmtPercent
  const getValue = (name: string): number | null => {
    const row = source.rows.find((r) => (r[entityField] as string) === name)
    if (!row) return null
    return metric === 'count' ? mnToCr(row[countKey] as number) : ((row[metric] as number | null) ?? null)
  }
  const label = `${opLabel} ${metric === 'count' ? '' : metric === 'approved_pct' ? 'approval rate' : metric === 'bd_pct' ? 'business decline rate' : 'technical decline rate'}`.trim()

  return runEntityQuery({
    text,
    monthsAsc: months,
    entityCandidates: source.rows.map((r) => r[entityField] as string),
    valueAt: getValue,
    fmt,
    label,
    rankAll: () => source.rows.map((r) => ({ name: r[entityField] as string, value: getValue(r[entityField] as string) })),
    noEntityPrompt: `Which bank or PSP did you mean? Try "top 5 by ${opLabel.toLowerCase()}" or naming one directly.`,
  })
}

// ---------------- Domain: P2P vs P2M ----------------
function handleP2p(text: string, rows: P2pRow[]): ChatAnswer {
  const months = rows.map((r) => r.month)
  const wantsValue = /\b(value|worth|amount|₹)\b/i.test(text)
  const fmt = wantsValue ? fmtRupeesCr : fmtCrTxns
  const getValue = (kind: string, monthIso: string): number | null => {
    const row = rows.find((r) => r.month === monthIso)
    if (!row) return null
    if (kind === 'P2P') return wantsValue ? row.p2p_value_cr : mnToCr(row.p2p_volume_mn)
    return wantsValue ? row.p2m_value_cr : mnToCr(row.p2m_volume_mn)
  }
  return runEntityQuery({
    text,
    monthsAsc: months,
    entityCandidates: ['P2P', 'P2M', 'person to person', 'person to merchant'],
    valueAt: (name, m) => getValue(name.toUpperCase().startsWith('P2P') || /person to person/i.test(name) ? 'P2P' : 'P2M', m),
    fmt,
    label: `P2P/P2M ${wantsValue ? 'value' : 'volume'}`,
    rankAll: (monthIso) => [
      { name: 'P2P', value: getValue('P2P', monthIso) },
      { name: 'P2M', value: getValue('P2M', monthIso) },
    ],
    noEntityPrompt: 'Ask about P2P (person-to-person) or P2M (person-to-merchant) transactions, e.g. "compare P2P and P2M in June".',
  })
}

// ---------------- Domain: RBI Cards ----------------
type RbiCardsAlias = { labels: string[]; display: string; compute: (row: RbiCardsRow) => number | null; unit: 'count' | 'value' }
const RBI_CARDS_ALIASES: RbiCardsAlias[] = [
  { labels: ['atms', 'atm network', 'number of atms'], display: 'ATMs', compute: (r) => rbiCountToCr(r.atms_onsite + r.atms_offsite), unit: 'count' },
  { labels: ['pos terminal', 'pos terminals', 'point of sale'], display: 'PoS Terminals', compute: (r) => rbiCountToCr(r.pos_terminals), unit: 'count' },
  { labels: ['micro atm', 'micro atms'], display: 'Micro ATMs', compute: (r) => rbiCountToCr(r.micro_atms), unit: 'count' },
  { labels: ['credit card outstanding', 'credit cards outstanding', 'credit cards'], display: 'Credit Cards Outstanding', compute: (r) => rbiCountToCr(r.credit_cards_outstanding), unit: 'count' },
  { labels: ['debit card outstanding', 'debit cards outstanding', 'debit cards'], display: 'Debit Cards Outstanding', compute: (r) => rbiCountToCr(r.debit_cards_outstanding), unit: 'count' },
  { labels: ['credit card pos spend', 'credit card pos'], display: 'Credit Card — PoS', compute: (r) => rbiValueToCr((r as unknown as Record<string, number>).credit_pos_value), unit: 'value' },
  { labels: ['debit card pos spend', 'debit card pos'], display: 'Debit Card — PoS', compute: (r) => rbiValueToCr((r as unknown as Record<string, number>).debit_pos_value), unit: 'value' },
  { labels: ['credit card online', 'credit card ecom'], display: 'Credit Card — Online', compute: (r) => rbiValueToCr((r as unknown as Record<string, number>).credit_online_value), unit: 'value' },
  { labels: ['debit card online', 'debit card ecom'], display: 'Debit Card — Online', compute: (r) => rbiValueToCr((r as unknown as Record<string, number>).debit_online_value), unit: 'value' },
  { labels: ['credit card atm withdrawal'], display: 'Credit Card — ATM Withdrawal', compute: (r) => rbiValueToCr((r as unknown as Record<string, number>).credit_atm_withdrawal_value), unit: 'value' },
  { labels: ['debit card atm withdrawal'], display: 'Debit Card — ATM Withdrawal', compute: (r) => rbiValueToCr((r as unknown as Record<string, number>).debit_atm_withdrawal_value), unit: 'value' },
]

function findAlias<T extends { labels: string[] }>(text: string, aliases: T[], max = 2): T[] {
  const t = text.toLowerCase()
  const hits = aliases
    .map((a) => ({ a, longest: Math.max(...a.labels.filter((l) => t.includes(l)).map((l) => l.length), 0) }))
    .filter((h) => h.longest > 0)
    .sort((a, b) => b.longest - a.longest)
  const picked: T[] = []
  for (const { a } of hits) {
    if (picked.length >= max) break
    if (!picked.includes(a)) picked.push(a)
  }
  return picked
}

function handleRbiCards(text: string, rows: RbiCardsRow[]): ChatAnswer {
  if (!rows.length) return { text: "I don't have RBI Cards data yet." }
  const months = rows.map((r) => r.month)
  const matched = findAlias(text, RBI_CARDS_ALIASES, 2)
  const fmt = (v: number | null) => fmtCount(v, 'Cr')
  const resolvedMonths = resolveMonths(text, months)
  const op = detectOperation(text)

  if (matched.length >= 2) {
    const monthIso = resolvedMonths[0] ?? months[months.length - 1]
    const row = rows.find((r) => r.month === monthIso)
    if (!row) return { text: `I don't have RBI Cards data for ${fmtMonth(monthIso)}.` }
    return buildCompareAnswer(
      'RBI Cards',
      fmtMonth(monthIso),
      { name: matched[0].display, value: matched[0].compute(row) },
      { name: matched[1].display, value: matched[1].compute(row) },
      fmt,
    )
  }

  const alias = matched[0] ?? RBI_CARDS_ALIASES[0]
  if (op === 'trend' || resolvedMonths.length >= 2) {
    const m1 = resolvedMonths[0] ?? months[Math.max(0, months.length - 13)]
    const m2 = resolvedMonths[1] ?? months[months.length - 1]
    const r1 = rows.find((r) => r.month === m1)
    const r2 = rows.find((r) => r.month === m2)
    return buildGrowthAnswer(alias.display, 'RBI Cards', { month: m1, value: r1 ? alias.compute(r1) : null }, { month: m2, value: r2 ? alias.compute(r2) : null }, fmt)
  }
  const monthIso = resolvedMonths[0] ?? months[months.length - 1]
  const row = rows.find((r) => r.month === monthIso)
  if (!row) return { text: `I don't have RBI Cards data for ${fmtMonth(monthIso)}.` }
  return { text: `${alias.display} in ${fmtMonth(monthIso)}: ${fmt(alias.compute(row))}.` }
}

// ---------------- Domain: RBI Payments ----------------
type RbiPaymentsAlias = { labels: string[]; display: string; base: string; single?: boolean }
const RBI_PAYMENTS_ALIASES: RbiPaymentsAlias[] = [
  { labels: ['upi'], display: 'UPI', base: 'upi' },
  { labels: ['rtgs customer'], display: 'RTGS — Customer', base: 'rtgs_customer' },
  { labels: ['rtgs interbank'], display: 'RTGS — Interbank', base: 'rtgs_interbank' },
  { labels: ['rtgs'], display: 'RTGS', base: 'rtgs_total' },
  { labels: ['neft'], display: 'NEFT', base: 'neft' },
  { labels: ['imps'], display: 'IMPS', base: 'imps' },
  { labels: ['nach credit'], display: 'NACH Credit', base: 'nach_credit' },
  { labels: ['nach debit'], display: 'NACH Debit', base: 'nach_debit' },
  { labels: ['bhim aadhaar pay', 'bhim aadhaar'], display: 'BHIM Aadhaar Pay', base: 'bhim_aadhaar_pay' },
  { labels: ['aeps'], display: 'AePS Fund Transfers', base: 'aeps_fund_transfers' },
  { labels: ['card payments', 'card payment'], display: 'Card Payments', base: 'card_payments' },
  { labels: ['credit card payments', 'credit card payment'], display: 'Credit Cards (RBI Payments)', base: 'credit_cards' },
  { labels: ['debit card payments', 'debit card payment'], display: 'Debit Cards (RBI Payments)', base: 'debit_cards' },
  { labels: ['wallets', 'wallet', 'ppi wallets'], display: 'PPI Wallets', base: 'ppi_wallets' },
  { labels: ['prepaid payment instruments', 'ppi'], display: 'Prepaid Payment Instruments', base: 'ppi_total' },
  { labels: ['mobile payments', 'mobile app payments'], display: 'Mobile Payments', base: 'mobile_payments' },
  { labels: ['internet payments', 'netbanking'], display: 'Internet Payments', base: 'internet_payments' },
  { labels: ['atm cash withdrawal', 'atm withdrawal'], display: 'ATM Cash Withdrawal', base: 'atm_cash_withdrawal' },
  { labels: ['pos cash withdrawal'], display: 'PoS Cash Withdrawal', base: 'pos_cash_withdrawal' },
  { labels: ['total digital payments', 'digital payments'], display: 'Total Digital Payments', base: 'total_digital_payments' },
  { labels: ['total retail payments'], display: 'Total Retail Payments', base: 'total_retail_payments' },
  { labels: ['total payments', 'all payments'], display: 'Total Payments', base: 'total_payments' },
  { labels: ['number of atms', 'atms and crms'], display: 'ATMs & CRMs (count)', base: 'atms_and_crms_count', single: true },
  { labels: ['micro atms'], display: 'Micro ATMs (count)', base: 'micro_atms_count', single: true },
  { labels: ['pos terminals'], display: 'PoS Terminals (count)', base: 'pos_terminals_count', single: true },
]

// 'upi' is deliberately excluded from routing detection (though still usable for
// field lookup once already routed here) - nearly every question on a UPI
// dashboard mentions "UPI", so treating it as a routing trigger would hijack
// domain detection for statewise/app_stats/etc. questions before they ever run.
const RBI_PAYMENTS_ROUTE_ALIASES = RBI_PAYMENTS_ALIASES.filter((a) => a.base !== 'upi')

function rbiPaymentsFieldValue(row: Record<string, number | string>, alias: RbiPaymentsAlias, wantsValue: boolean): number | null {
  if (alias.single) {
    const v = row[`${alias.base}`] as number | undefined
    return v == null ? null : lakhToCr(v)
  }
  if (wantsValue) return (row[`${alias.base}_value`] as number | undefined) ?? null
  return lakhToCr((row[`${alias.base}_volume`] as number | undefined) ?? null)
}

function handleRbiPayments(text: string, rows: Record<string, number | string>[]): ChatAnswer {
  if (!rows.length) return { text: "I don't have RBI Payments data yet." }
  const months = rows.map((r) => String(r.month))
  const matched = findAlias(text, RBI_PAYMENTS_ALIASES, 2)
  const wantsValue = !mentions(text, ['volume', 'transactions', 'count']) // default to value (₹), the more commonly asked headline
  const fmt = (v: number | null) => (wantsValue ? fmtRupeesCr(v) : fmtCrTxns(v))
  const resolvedMonths = resolveMonths(text, months)
  const op = detectOperation(text)

  if (matched.length >= 2) {
    const monthIso = resolvedMonths[0] ?? months[months.length - 1]
    const row = rows.find((r) => String(r.month) === monthIso)
    if (!row) return { text: `I don't have RBI Payments data for ${fmtMonth(monthIso)}.` }
    return buildCompareAnswer(
      'RBI Payments',
      fmtMonth(monthIso),
      { name: matched[0].display, value: rbiPaymentsFieldValue(row, matched[0], wantsValue) },
      { name: matched[1].display, value: rbiPaymentsFieldValue(row, matched[1], wantsValue) },
      fmt,
    )
  }

  const alias = matched[0] ?? RBI_PAYMENTS_ALIASES.find((a) => a.base === 'upi')!
  if (op === 'trend' || resolvedMonths.length >= 2) {
    const m1 = resolvedMonths[0] ?? months[Math.max(0, months.length - 13)]
    const m2 = resolvedMonths[1] ?? months[months.length - 1]
    const r1 = rows.find((r) => String(r.month) === m1)
    const r2 = rows.find((r) => String(r.month) === m2)
    return buildGrowthAnswer(
      alias.display,
      'RBI Payments',
      { month: m1, value: r1 ? rbiPaymentsFieldValue(r1, alias, wantsValue) : null },
      { month: m2, value: r2 ? rbiPaymentsFieldValue(r2, alias, wantsValue) : null },
      fmt,
    )
  }
  const monthIso = resolvedMonths[0] ?? months[months.length - 1]
  const row = rows.find((r) => String(r.month) === monthIso)
  if (!row) return { text: `I don't have RBI Payments data for ${fmtMonth(monthIso)}.` }
  return { text: `${alias.display} in ${fmtMonth(monthIso)}: ${fmt(rbiPaymentsFieldValue(row, alias, wantsValue))}.` }
}

// ---------------- Domain: Circulars ----------------
function handleCirculars(text: string, circulars: CircularRow[]): ChatAnswer {
  const stopwords = new Set(['any', 'circulars', 'circular', 'about', 'on', 'regarding', 'related', 'to', 'the', 'a', 'an', 'is', 'there', 'are', 'find', 'show', 'me'])
  const terms = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopwords.has(w))
  if (!terms.length) {
    return { text: `There are ${circulars.length} circulars on file. Try asking about a topic, e.g. "circulars about GSTIN".` }
  }
  const matches = circulars
    .map((c) => ({ c, score: terms.filter((t) => c.title.toLowerCase().includes(t) || c.ref.toLowerCase().includes(t)).length }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((m) => m.c)
  if (!matches.length) return { text: `I couldn't find any circulars matching that. There are ${circulars.length} circulars on file in total.` }
  const lines = matches.map((c) => `- ${c.ref} (FY ${c.fy}): ${c.title}`)
  return {
    text: `Found ${matches.length} matching circular(s):\n${lines.join('\n')}`,
    table: { headers: ['Ref', 'FY', 'Title'], rows: matches.map((c) => [c.ref, c.fy, c.title]) },
  }
}

// ---------------- Domain routing ----------------
export function answerQuestion(question: string, data: ChatbotData): ChatAnswer {
  const text = question.trim()
  if (!text) return { text: FALLBACK_HELP }

  if (mentions(text, ['circular'])) return handleCirculars(text, data.circulars)

  if (mentions(text, ['autopay', 'auto-pay', 'auto pay', 'mandate'])) return handleAutoPay(text, data)

  if (findAlias(text, RBI_PAYMENTS_ROUTE_ALIASES, 1).length) return handleRbiPayments(text, data.rbiPayments)

  if (mentions(text, ['atm', 'pos terminal', 'point of sale', 'micro atm', 'credit card outstanding', 'debit card outstanding', 'credit cards outstanding', 'debit cards outstanding'])) {
    return handleRbiCards(text, data.rbiCards)
  }

  const allStates = [...new Set(Object.values(data.statewise.byMonth).flat().map((r) => r.state))]
  const allDistricts = [...new Set(Object.values(data.statewise.byMonth).flat().map((r) => r.name))]
  if (mentions(text, ['state', 'district', 'geograph']) || findEntityMentions(text, [...allStates, ...allDistricts], 1).length) {
    return handleStatewise(text, data.statewise)
  }

  const allCategories = [...new Set(Object.values(data.merchantCategories).flat().map((r) => r.name))]
  if (mentions(text, ['merchant', 'category', 'categories', 'mcc']) || findEntityMentions(text, allCategories, 1).length) {
    return handleMerchantCategories(text, data.merchantCategories)
  }

  if (
    (mentions(text, ['approval rate', 'approved', 'member performance', 'remitter', 'beneficiary']) ||
      findEntityMentions(text, data.pspMemberPerformance.rows.map((r) => r.entity_name), 1).length) &&
    !mentions(text, ['app'])
  ) {
    return handlePspPerformance(text, data.pspMemberPerformance)
  }

  if (mentions(text, ['app', 'apps']) || findEntityMentions(text, Object.keys(data.appStats.byApp), 1).length) {
    return handleAppStats(text, data.appStats)
  }

  if (mentions(text, ['p2p', 'p2m', 'person to person', 'person to merchant', 'peer to peer', 'peer to merchant'])) {
    return handleP2p(text, data.p2p)
  }

  if (mentions(text, ['upi', 'volume', 'value', 'transaction', 'bank', 'trend'])) {
    return handleMonthlyTrend(text, data.monthlyTrend)
  }

  return { text: FALLBACK_HELP }
}

export const EXAMPLE_QUESTIONS = [
  'What was UPI volume last month?',
  'Compare PhonePe and Paytm volume in July',
  'Top 5 states by UPI value share',
  'How many ATMs are there right now?',
  "What was NEFT's value in June?",
  'Any circulars about GSTIN?',
]

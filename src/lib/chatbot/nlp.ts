// Lightweight natural-language parsing for the chatbot - month/year extraction,
// fuzzy entity-name matching, and operation detection. No domain knowledge lives
// here (see engine.ts for that); this file only understands English phrasing.

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

export type MonthToken =
  | { kind: 'named'; monthIdx: number; year?: number; index: number }
  | { kind: 'iso'; year: number; monthIdx: number; index: number }
  | { kind: 'year'; year: number; index: number }
  | { kind: 'relative'; which: 'latest' | 'previous' | 'yearAgo'; index: number }

// Matches "June", "Jun", "Jun'26", "Jun 2026", "June-26" etc. Deliberately loose -
// this is chat input, not a date picker.
const MONTH_NAME_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b(?:[\s'’-]*([0-9]{2,4}))?/g
const ISO_MONTH_RE = /\b(20\d{2})-(0[1-9]|1[0-2])\b/g
const BARE_YEAR_RE = /\b20\d{2}\b/g
const RELATIVE_PATTERNS: [RegExp, 'latest' | 'previous' | 'yearAgo'][] = [
  [/\b(latest|current|this month|right now|as of now|today|currently)\b/g, 'latest'],
  [/\b(last month|previous month|prior month)\b/g, 'previous'],
  [/\b(last year|a year ago|one year ago|12 months ago)\b/g, 'yearAgo'],
]

function monthIndexFromAbbr(abbr: string): number {
  const a = abbr.toLowerCase()
  return MONTHS.findIndex((full) => full.startsWith(a.slice(0, 3)))
}

export function extractMonthTokens(rawText: string): MonthToken[] {
  const text = rawText.toLowerCase()
  const tokens: MonthToken[] = []

  for (const m of text.matchAll(MONTH_NAME_RE)) {
    const monthIdx = monthIndexFromAbbr(m[1])
    if (monthIdx === -1) continue
    let year: number | undefined
    if (m[2]) {
      const yNum = Number(m[2])
      year = yNum < 100 ? 2000 + yNum : yNum
    }
    tokens.push({ kind: 'named', monthIdx, year, index: m.index ?? 0 })
  }

  for (const m of text.matchAll(ISO_MONTH_RE)) {
    tokens.push({ kind: 'iso', year: Number(m[1]), monthIdx: Number(m[2]) - 1, index: m.index ?? 0 })
  }

  for (const m of text.matchAll(BARE_YEAR_RE)) {
    const idx = m.index ?? 0
    const overlapping = tokens.some((t) => (t.kind === 'named' || t.kind === 'iso') && Math.abs(t.index - idx) <= 6)
    if (!overlapping) tokens.push({ kind: 'year', year: Number(m[0]), index: idx })
  }

  for (const [re, which] of RELATIVE_PATTERNS) {
    for (const m of text.matchAll(re)) tokens.push({ kind: 'relative', which, index: m.index ?? 0 })
  }

  tokens.sort((a, b) => a.index - b.index)
  return tokens
}

// Resolves one token against a specific domain's own ascending ISO month list -
// "latest"/"June" mean different things to app_stats vs monthly_trend since NPCI
// publishes some tabs ~1 month behind the headline figure (see CLAUDE.md).
export function resolveMonthToken(token: MonthToken, availableMonthsAsc: string[]): string | null {
  if (!availableMonthsAsc.length) return null
  if (token.kind === 'year') return null // aggregate, not a single month - see resolveYearMonths
  if (token.kind === 'relative') {
    const idx =
      token.which === 'latest' ? availableMonthsAsc.length - 1
      : token.which === 'previous' ? availableMonthsAsc.length - 2
      : availableMonthsAsc.length - 13
    return availableMonthsAsc[idx] ?? null
  }
  if (token.year != null) {
    const iso = `${token.year}-${String(token.monthIdx + 1).padStart(2, '0')}-01`
    return availableMonthsAsc.includes(iso) ? iso : null
  }
  // Month name with no year - most recent available month with that calendar month.
  const matches = availableMonthsAsc.filter((m) => Number(m.slice(5, 7)) - 1 === token.monthIdx)
  return matches.length ? matches[matches.length - 1] : null
}

export function resolveYearMonths(year: number, availableMonthsAsc: string[]): string[] {
  return availableMonthsAsc.filter((m) => m.startsWith(String(year)))
}

// Convenience: resolve every month-ish token in the text against one domain's
// month list, in order of appearance, dropping tokens that didn't resolve (e.g. a
// year-only token, or a month the domain genuinely has no data for).
export function resolveMonths(text: string, availableMonthsAsc: string[]): string[] {
  const tokens = extractMonthTokens(text)
  const out: string[] = []
  for (const t of tokens) {
    const resolved = resolveMonthToken(t, availableMonthsAsc)
    if (resolved && !out.includes(resolved)) out.push(resolved)
  }
  return out
}

export function hasYearOnlyMention(text: string): number | null {
  const tokens = extractMonthTokens(text)
  const yearToken = tokens.find((t) => t.kind === 'year')
  return yearToken && yearToken.kind === 'year' ? yearToken.year : null
}

// ---------------- Entity fuzzy matching ----------------
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = new Array(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[n]
}

function ngrams(words: string[], n: number): string[] {
  const out: string[] = []
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(' '))
  return out
}

// Finds up to `maxResults` candidate names that appear to be mentioned in `text`.
// Exact/substring matches first (the common case - people type real names), then
// a light typo-tolerant fallback over word n-grams for near-misses. Candidates are
// whatever's actually in the current dataset (app names, state names, bank/PSP
// names) - never a hardcoded list, since these drift month to month.
export function findEntityMentions(text: string, candidates: string[], maxResults = 2): string[] {
  const normText = normalize(text)
  if (!normText) return []
  const uniqueCandidates = [...new Set(candidates)]

  const substringHits = uniqueCandidates
    .map((c) => ({ c, norm: normalize(c) }))
    .filter(({ norm }) => norm.length > 1 && normText.includes(norm))
    .sort((a, b) => b.norm.length - a.norm.length)

  const picked: string[] = []
  for (const { c, norm } of substringHits) {
    if (picked.length >= maxResults) break
    if (picked.some((p) => normalize(p).includes(norm) || norm.includes(normalize(p)))) continue
    picked.push(c)
  }
  if (picked.length >= maxResults) return picked

  // Typo-tolerant fallback over 1-3 word windows of the question text.
  const words = normText.split(' ').filter(Boolean)
  const grams = [...ngrams(words, 1), ...ngrams(words, 2), ...ngrams(words, 3)]
  const fallbackScored = uniqueCandidates
    .filter((c) => !picked.includes(c))
    .map((c) => {
      const nc = normalize(c)
      let best = 0
      for (const g of grams) {
        const dist = levenshtein(nc, g)
        const sim = 1 - dist / Math.max(nc.length, g.length, 1)
        if (sim > best) best = sim
      }
      return { c, best }
    })
    .filter((s) => s.best >= 0.74)
    .sort((a, b) => b.best - a.best)

  for (const { c } of fallbackScored) {
    if (picked.length >= maxResults) break
    picked.push(c)
  }
  return picked
}

// ---------------- Operation / count detection ----------------
export type Operation = 'compare' | 'rank' | 'trend' | 'lookup'

export function detectOperation(text: string): Operation {
  const t = text.toLowerCase()
  if (/\b(compare|vs\.?|versus|difference between|which (is|was) (bigger|higher|more))\b/.test(t)) return 'compare'
  if (/\b(top\s*\d*|highest|lowest|best|worst|rank(ed|ing)?|leading|which (app|state|district|bank|psp))\b/.test(t)) return 'rank'
  if (/\b(grow(th)?|trend|increase[d]?|decrease[d]?|change|mom\b|yoy\b|year.over.year|month.over.month)\b/.test(t)) return 'trend'
  return 'lookup'
}

export function detectN(text: string, fallback = 5): number {
  const m = text.match(/\btop\s*(\d{1,2})\b/i)
  if (m) return Math.max(1, Math.min(50, Number(m[1])))
  if (/\b(highest|lowest|best|worst)\b/i.test(text) && !/\btop\b/i.test(text)) return 1
  return fallback
}

export function detectDirection(text: string): 'desc' | 'asc' {
  return /\b(lowest|worst|least|smallest|bottom)\b/i.test(text) ? 'asc' : 'desc'
}

export function mentions(text: string, patterns: string[]): boolean {
  const t = text.toLowerCase()
  return patterns.some((p) => t.includes(p))
}

// Every figure on this dashboard is normalized to Crore (1 Crore = 10 Million = 1e7), so
// numbers read the same across UPI/AutoPay/RBI Cards/RBI Payments.
export function mnToCr(mn: number | null | undefined): number | null {
  return mn == null ? null : mn / 10
}

// RBI Cards ships raw stock counts (ATMs/PoS/cards outstanding) and raw transaction counts
// (channel volume) - both need /1e7 to reach Crore (1 Cr = 1e7).
export function rbiCountToCr(raw: number | null | undefined): number | null {
  return raw == null ? null : raw / 1e7
}

// RBI Cards channel Value fields are raw Rs'000-equivalent; /1e4 reaches Crore.
export function rbiValueToCr(raw: number | null | undefined): number | null {
  return raw == null ? null : raw / 1e4
}

// RBI Payments publishes Volume/Count fields in lakh; /100 reaches Crore (1 Cr = 100 lakh).
// Value fields are already published in Rs crore, so they need no conversion at all.
export function lakhToCr(raw: number | null | undefined): number | null {
  return raw == null ? null : raw / 100
}

export function crNum(cr: number | null | undefined, maximumFractionDigits = 2): string {
  return cr == null ? '—' : cr.toLocaleString('en-IN', { maximumFractionDigits })
}

export function fmtPct(v: number | null): string {
  if (v == null || !isFinite(v)) return 'N/A'
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%'
}

export function pctChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || !previous) return null
  return ((current - previous) / previous) * 100
}

export function mom(arr: (number | null)[], i: number): number | null {
  return pctChange(arr[i], arr[i - 1])
}

export function yoy(arr: (number | null)[], i: number): number | null {
  if (i < 12) return null
  return pctChange(arr[i], arr[i - 12])
}

// "Jun 23" - used on the 3-year monthly trend chart's x-axis
export function shortLabel(iso: string): string {
  const [y, m] = iso.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-US', { month: 'short' }) + ' ' + y.slice(2)
}

// "Jun'26" - used on the Jan25-Jun26 app/RBI selector charts
export function aposLabel(iso: string): string {
  const [y, m] = iso.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-US', { month: 'short' }) + "'" + y.slice(2)
}

// "June 2026" - used in section notes once a month is selected
export function fullLabel(iso: string): string {
  const [y, m] = iso.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function rupees(v: number): string {
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

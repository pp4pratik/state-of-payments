import { useQuery } from '@tanstack/react-query'

// Every table is a static JSON file under public/data/, written by the Python
// fetchers (see scripts/json_store.py) - no backend, no pagination cap to work
// around, just a fetch per table.
async function fetchJson<T>(name: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/${name}.json`)
  if (!res.ok) throw new Error(`Failed to load data/${name}.json: ${res.status}`)
  return res.json()
}

// ---------- Monthly trend (Jun 2021 - present), drives the top trend chart ----------
export type MonthlyTrendRow = {
  month: string
  total_volume_mn: number
  total_value_cr: number
  banks_live: number | null
}

export function useMonthlyTrend() {
  return useQuery({
    queryKey: ['monthly_trend'],
    queryFn: async (): Promise<MonthlyTrendRow[]> => {
      const data = await fetchJson<MonthlyTrendRow[]>('monthly_trend')
      return [...data].sort((a, b) => a.month.localeCompare(b.month))
    },
  })
}

// ---------- App stats, all months present (Jan 2025 onward) ----------
export type AppStatsAll = {
  months: string[] // ISO month strings, ascending
  byApp: Record<string, { vol: number[]; val: number[] }>
  monthTotalVol: number[]
  monthTotalVal: number[]
}

export function useAppStatsAll() {
  return useQuery({
    queryKey: ['app_stats', 'all'],
    queryFn: async (): Promise<AppStatsAll> => {
      const data = await fetchJson<{ app_name: string; month: string; volume_mn: number; value_cr: number }[]>('app_stats')

      const months = [...new Set(data.map((r) => r.month))].sort()
      const monthIdx = new Map(months.map((m, i) => [m, i]))
      const byApp: AppStatsAll['byApp'] = {}
      const monthTotalVol = months.map(() => 0)
      const monthTotalVal = months.map(() => 0)

      for (const row of data) {
        const i = monthIdx.get(row.month)!
        if (!byApp[row.app_name]) {
          byApp[row.app_name] = { vol: months.map(() => 0), val: months.map(() => 0) }
        }
        byApp[row.app_name].vol[i] = row.volume_mn
        byApp[row.app_name].val[i] = row.value_cr
        monthTotalVol[i] += row.volume_mn
        monthTotalVal[i] += row.value_cr
      }

      return { months, byApp, monthTotalVol, monthTotalVal }
    },
  })
}

// ---------- P2P / P2M split, all months ----------
export type P2pRow = {
  month: string
  p2p_volume_mn: number
  p2p_value_cr: number
  p2m_volume_mn: number
  p2m_value_cr: number
}

export function useP2pAll() {
  return useQuery({
    queryKey: ['p2p_p2m', 'all'],
    queryFn: async (): Promise<P2pRow[]> => {
      const data = await fetchJson<P2pRow[]>('p2p_p2m')
      return [...data].sort((a, b) => a.month.localeCompare(b.month))
    },
  })
}

// ---------- Merchant categories, all months (grouped client-side) ----------
export type CategoryRow = { name: string; vol: number; val: number }

export function useMerchantCategoriesAll() {
  return useQuery({
    queryKey: ['merchant_categories', 'all'],
    queryFn: async (): Promise<Record<string, CategoryRow[]>> => {
      const data = await fetchJson<{ description: string; month: string; volume_mn: number; value_cr: number }[]>('merchant_categories')

      const byMonth: Record<string, CategoryRow[]> = {}
      for (const row of data) {
        if (row.description === 'Others') continue
        ;(byMonth[row.month] ??= []).push({ name: row.description, vol: row.volume_mn, val: row.value_cr })
      }
      // Rank each month's own categories by volume client-side.
      for (const month in byMonth) {
        byMonth[month] = byMonth[month].sort((a, b) => b.vol - a.vol).slice(0, 5)
      }
      return byMonth
    },
  })
}

// ---------- Statewise/district geography, all months ----------
// `state` is retained even for district-level months so the choropleth map
// (which only has state-level polygons) can aggregate districts back up to
// their parent state, independent of what granularity NPCI published that month.
export type GeoRow = { name: string; state: string; vol: number; val: number }
type StatewiseSourceRow = { state: string; district: string; month: string; volume_share_pct: number; value_share_pct: number }

// Geography is served entirely from static JSON, not one file per table - NPCI's
// statewise endpoint is scraped directly (bot-protected, needs Playwright) rather
// than fetched live per page load, and one month's payload (up to ~780 districts)
// is too big to lump into a single all-months array like every other table. So it
// gets its own per-month file plus an index.json manifest instead. See
// scripts/fetch_statewise_historical.py and scripts/export_statewise_to_json.py for
// how the existing months were produced, and fetch_npci_data.py's write_statewise_json
// for how new months get appended.
async function fetchStatewiseIndex(): Promise<string[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}statewise-historical/index.json`)
  if (!res.ok) throw new Error(`Failed to load statewise-historical/index.json: ${res.status}`)
  return res.json()
}

async function fetchStatewiseMonth(month: string): Promise<StatewiseSourceRow[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}statewise-historical/${month}.json`)
  if (!res.ok) throw new Error(`Failed to load statewise-historical/${month}.json: ${res.status}`)
  return res.json()
}

export function useStatewiseAll() {
  return useQuery({
    queryKey: ['statewise', 'all'],
    queryFn: async (): Promise<{
      byMonth: Record<string, GeoRow[]>
      granularityByMonth: Record<string, 'State' | 'District'>
    }> => {
      const months = await fetchStatewiseIndex()
      const perMonth = await Promise.all(months.map(fetchStatewiseMonth))

      const byMonth: Record<string, GeoRow[]> = {}
      const isStateLevel: Record<string, boolean> = {}
      for (const row of perMonth.flat()) {
        const list = (byMonth[row.month] ??= [])
        list.push({ name: row.district, state: row.state, vol: row.volume_share_pct, val: row.value_share_pct })
        if (!(row.month in isStateLevel)) {
          isStateLevel[row.month] = true
        }
        if (row.district.trim().toUpperCase() !== row.state.trim().toUpperCase()) {
          isStateLevel[row.month] = false
        }
      }
      const granularityByMonth = Object.fromEntries(
        Object.entries(isStateLevel).map(([m, isState]) => [m, isState ? 'State' : 'District']),
      ) as Record<string, 'State' | 'District'>
      return { byMonth, granularityByMonth }
    },
  })
}

// ---------- AutoPay: latest month registrations/executions ----------
// Each of these 5 tables' JSON file only ever holds the latest fetched month's rows
// (see json_store.replace_for_key) - the app has only ever shown "latest month" for
// these, so the month is just whatever the (non-empty) file's rows agree on.
export type AutoPayRegistrationRow = { psp: string; registrations_mn: number; approved_pct: number | null }
export type AutoPayExecutionRow = { bank: string; executions_mn: number; approved_pct: number | null; bd_pct: number | null; td_pct: number | null }

export function useAutoPayRegistrations() {
  return useQuery({
    queryKey: ['autopay_registrations', 'latest'],
    queryFn: async (): Promise<{ month: string; rows: AutoPayRegistrationRow[] }> => {
      const data = await fetchJson<(AutoPayRegistrationRow & { month: string })[]>('autopay_registrations')
      const month = data[0]?.month ?? ''
      const rows = [...data].sort((a, b) => b.registrations_mn - a.registrations_mn)
      return { month, rows }
    },
  })
}

export function useAutoPayExecutions() {
  return useQuery({
    queryKey: ['autopay_executions', 'latest'],
    queryFn: async (): Promise<{ month: string; rows: AutoPayExecutionRow[] }> => {
      const data = await fetchJson<(AutoPayExecutionRow & { month: string })[]>('autopay_executions')
      const month = data[0]?.month ?? ''
      const rows = [...data].sort((a, b) => b.executions_mn - a.executions_mn)
      return { month, rows }
    },
  })
}

// ---------- AutoPay: the same two flows, broken down the other way - registrations
// by remitter bank (NPCI's "Top 50 Remitter Banks / Mandate Registration" tab) and
// executions by payer PSP (NPCI's "PSP Wise execution" tab) ----------
export type AutoPayRegistrationByBankRow = { remitter_bank: string; registrations_mn: number; approved_pct: number | null }
export type AutoPayExecutionByPspRow = { psp: string; executions_mn: number; approved_pct: number | null }

export function useAutoPayRegistrationsByBank() {
  return useQuery({
    queryKey: ['autopay_registrations_by_bank', 'latest'],
    queryFn: async (): Promise<{ month: string; rows: AutoPayRegistrationByBankRow[] }> => {
      const data = await fetchJson<(AutoPayRegistrationByBankRow & { month: string })[]>('autopay_registrations_by_bank')
      const month = data[0]?.month ?? ''
      const rows = [...data].sort((a, b) => b.registrations_mn - a.registrations_mn)
      return { month, rows }
    },
  })
}

export function useAutoPayExecutionsByPsp() {
  return useQuery({
    queryKey: ['autopay_executions_by_psp', 'latest'],
    queryFn: async (): Promise<{ month: string; rows: AutoPayExecutionByPspRow[] }> => {
      const data = await fetchJson<(AutoPayExecutionByPspRow & { month: string })[]>('autopay_executions_by_psp')
      const month = data[0]?.month ?? ''
      const rows = [...data].sort((a, b) => b.executions_mn - a.executions_mn)
      return { month, rows }
    },
  })
}

// ---------- PSP member performance, latest month - drives AutoPay's weighted KPI cards ----------
export type PspPerformanceRow = {
  entity_name: string
  direction: string
  volume_mn: number
  approved_pct: number
  bd_pct: number
  td_pct: number
}

export function usePspMemberPerformance() {
  return useQuery({
    queryKey: ['psp_member_performance', 'latest'],
    queryFn: async (): Promise<{ month: string; rows: PspPerformanceRow[] }> => {
      const data = await fetchJson<(PspPerformanceRow & { month: string })[]>('psp_member_performance')
      const month = data[0]?.month ?? ''
      const rows = [...data].sort((a, b) => b.volume_mn - a.volume_mn)
      return { month, rows }
    },
  })
}

// ---------- RBI Cards, all months ----------
export type RbiCardsRow = {
  month: string
  atms_onsite: number
  atms_offsite: number
  pos_terminals: number
  micro_atms: number
  credit_cards_outstanding: number
  debit_cards_outstanding: number
  credit_pos_volume: number
  credit_pos_value: number
  credit_online_volume: number
  credit_online_value: number
  credit_others_volume: number
  credit_others_value: number
  credit_atm_withdrawal_volume: number
  credit_atm_withdrawal_value: number
  debit_pos_volume: number
  debit_pos_value: number
  debit_online_volume: number
  debit_online_value: number
  debit_others_volume: number
  debit_others_value: number
  debit_atm_withdrawal_volume: number
  debit_atm_withdrawal_value: number
  debit_pos_withdrawal_volume: number
  debit_pos_withdrawal_value: number
}

export function useRbiCardsAll() {
  return useQuery({
    queryKey: ['rbi_cards', 'all'],
    queryFn: async (): Promise<RbiCardsRow[]> => {
      const data = await fetchJson<RbiCardsRow[]>('rbi_cards')
      return [...data].sort((a, b) => a.month.localeCompare(b.month))
    },
  })
}

// ---------- RBI Payments, all months, all columns ----------
export function useRbiPaymentsAll() {
  return useQuery({
    queryKey: ['rbi_payments', 'all'],
    queryFn: async (): Promise<Record<string, number | string>[]> => {
      const data = await fetchJson<Record<string, number | string>[]>('rbi_payments')
      return [...data].sort((a, b) => String(a.month).localeCompare(String(b.month)))
    },
  })
}

// ---------- Circulars ----------
export type CircularRow = {
  ref: string
  fy: string
  title: string
  date_added: string | null
  pdf_url: string | null
}

export function useCirculars() {
  return useQuery({
    queryKey: ['circulars'],
    queryFn: async (): Promise<CircularRow[]> => {
      const data = await fetchJson<CircularRow[]>('circulars')
      return [...data].sort((a, b) => {
        const fyEnd = (fy: string) => Number(fy?.split('-').pop()) || 0
        const refNum = (ref: string) => Number(ref?.match(/\d+/)?.[0]) || 0
        return fyEnd(b.fy) - fyEnd(a.fy) || refNum(b.ref) - refNum(a.ref)
      })
    },
  })
}

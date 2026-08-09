import { useQuery } from '@tanstack/react-query'
import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from './supabase'

const PAGE_SIZE = 1000

// PostgREST caps a single response at 1000 rows by default - tables that
// accumulate one (or more) row per month grow past that eventually, and an
// unpaginated .select() silently truncates rather than erroring. Any query
// meant to fetch every row of a table must page through with .range() instead.
// Requires a fully deterministic .order() (a unique key, or a tie-broken one)
// so page boundaries can't skip or duplicate a row.
async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
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
      return fetchAllRows<MonthlyTrendRow>((from, to) =>
        supabase
          .from('monthly_trend')
          .select('month, total_volume_mn, total_value_cr, banks_live')
          .order('month', { ascending: true })
          .range(from, to),
      )
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
      const data = await fetchAllRows<{ app_name: string; month: string; volume_mn: number; value_cr: number }>((from, to) =>
        supabase
          .from('app_stats')
          .select('app_name, month, volume_mn, value_cr')
          .order('month', { ascending: true })
          .order('app_name', { ascending: true })
          .range(from, to),
      )

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
      return fetchAllRows<P2pRow>((from, to) =>
        supabase
          .from('p2p_p2m')
          .select('month, p2p_volume_mn, p2p_value_cr, p2m_volume_mn, p2m_value_cr')
          .order('month', { ascending: true })
          .range(from, to),
      )
    },
  })
}

// ---------- Merchant categories, all months (grouped client-side) ----------
export type CategoryRow = { name: string; vol: number; val: number }

export function useMerchantCategoriesAll() {
  return useQuery({
    queryKey: ['merchant_categories', 'all'],
    queryFn: async (): Promise<Record<string, CategoryRow[]>> => {
      const data = await fetchAllRows<{ description: string; month: string; volume_mn: number; value_cr: number }>((from, to) =>
        supabase
          .from('merchant_categories')
          .select('description, month, volume_mn, value_cr')
          .neq('description', 'Others')
          .order('month', { ascending: true })
          .order('mcc', { ascending: true })
          .range(from, to),
      )

      const byMonth: Record<string, CategoryRow[]> = {}
      for (const row of data) {
        ;(byMonth[row.month] ??= []).push({ name: row.description, vol: row.volume_mn, val: row.value_cr })
      }
      // Rank each month's own categories by volume client-side, now that fetching
      // is paginated (an .order('volume_mn') couldn't paginate reliably - volume
      // isn't a unique/stable key, so rows could shift between page boundaries).
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

export function useStatewiseAll() {
  return useQuery({
    queryKey: ['statewise', 'all'],
    queryFn: async (): Promise<{
      byMonth: Record<string, GeoRow[]>
      granularityByMonth: Record<string, 'State' | 'District'>
    }> => {
      const data = await fetchAllRows<{ state: string; district: string; month: string; volume_share_pct: number; value_share_pct: number }>((from, to) =>
        supabase
          .from('statewise')
          .select('state, district, month, volume_share_pct, value_share_pct')
          .order('month', { ascending: true })
          .order('state', { ascending: true })
          .order('district', { ascending: true })
          .range(from, to),
      )

      const byMonth: Record<string, GeoRow[]> = {}
      const isStateLevel: Record<string, boolean> = {}
      for (const row of data) {
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
export type AutoPayRegistrationRow = { psp: string; registrations_mn: number; approved_pct: number | null }
export type AutoPayExecutionRow = { bank: string; executions_mn: number; approved_pct: number | null; bd_pct: number | null; td_pct: number | null }

async function latestMonthOf(table: string): Promise<string> {
  const { data, error } = await supabase
    .from(table)
    .select('month')
    .order('month', { ascending: false })
    .limit(1)
    .single()
  if (error) throw error
  return data.month
}

export function useAutoPayRegistrations() {
  return useQuery({
    queryKey: ['autopay_registrations', 'latest'],
    queryFn: async (): Promise<{ month: string; rows: AutoPayRegistrationRow[] }> => {
      const month = await latestMonthOf('autopay_registrations')
      const { data, error } = await supabase
        .from('autopay_registrations')
        .select('psp, registrations_mn, approved_pct')
        .eq('month', month)
        .order('registrations_mn', { ascending: false })
      if (error) throw error
      return { month, rows: data }
    },
  })
}

export function useAutoPayExecutions() {
  return useQuery({
    queryKey: ['autopay_executions', 'latest'],
    queryFn: async (): Promise<{ month: string; rows: AutoPayExecutionRow[] }> => {
      const month = await latestMonthOf('autopay_executions')
      const { data, error } = await supabase
        .from('autopay_executions')
        .select('bank, executions_mn, approved_pct, bd_pct, td_pct')
        .eq('month', month)
        .order('executions_mn', { ascending: false })
      if (error) throw error
      return { month, rows: data }
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
      const month = await latestMonthOf('autopay_registrations_by_bank')
      const { data, error } = await supabase
        .from('autopay_registrations_by_bank')
        .select('remitter_bank, registrations_mn, approved_pct')
        .eq('month', month)
        .order('registrations_mn', { ascending: false })
      if (error) throw error
      return { month, rows: data }
    },
  })
}

export function useAutoPayExecutionsByPsp() {
  return useQuery({
    queryKey: ['autopay_executions_by_psp', 'latest'],
    queryFn: async (): Promise<{ month: string; rows: AutoPayExecutionByPspRow[] }> => {
      const month = await latestMonthOf('autopay_executions_by_psp')
      const { data, error } = await supabase
        .from('autopay_executions_by_psp')
        .select('psp, executions_mn, approved_pct')
        .eq('month', month)
        .order('executions_mn', { ascending: false })
      if (error) throw error
      return { month, rows: data }
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
      const month = await latestMonthOf('psp_member_performance')
      const { data, error } = await supabase
        .from('psp_member_performance')
        .select('entity_name, direction, volume_mn, approved_pct, bd_pct, td_pct')
        .eq('month', month)
        .order('volume_mn', { ascending: false })
      if (error) throw error
      return { month, rows: data }
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
      return fetchAllRows<RbiCardsRow>((from, to) =>
        supabase.from('rbi_cards').select('*').order('month', { ascending: true }).range(from, to),
      )
    },
  })
}

// ---------- RBI Payments, all months, all columns ----------
export function useRbiPaymentsAll() {
  return useQuery({
    queryKey: ['rbi_payments', 'all'],
    queryFn: async (): Promise<Record<string, number | string>[]> => {
      return fetchAllRows<Record<string, number | string>>((from, to) =>
        supabase.from('rbi_payments').select('*').order('month', { ascending: true }).range(from, to),
      )
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
      const data = await fetchAllRows<CircularRow>((from, to) =>
        supabase
          .from('circulars')
          .select('ref, fy, title, date_added, pdf_url')
          .order('fy', { ascending: true })
          .order('ref', { ascending: true })
          .range(from, to),
      )

      return [...data].sort((a, b) => {
        const fyEnd = (fy: string) => Number(fy?.split('-').pop()) || 0
        const refNum = (ref: string) => Number(ref?.match(/\d+/)?.[0]) || 0
        return fyEnd(b.fy) - fyEnd(a.fy) || refNum(b.ref) - refNum(a.ref)
      })
    },
  })
}

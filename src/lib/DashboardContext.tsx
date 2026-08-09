import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { trackEvent } from './analytics'
import type { Theme } from './useTheme'

export type ViewKey = 'upi' | 'autopay' | 'rbi' | 'rbipayments' | 'circulars'
export type Metric = 'volume' | 'value'
export type { Theme }

type DashboardState = {
  view: ViewKey
  setView: (v: ViewKey) => void
  metric: Metric
  setMetric: (m: Metric) => void
  months: string[] // ISO month strings, ascending - the Jan'25-Jun'26 selectable range
  selectedMonth: string | null
  setSelectedMonth: (m: string) => void
  theme: Theme
  toggleTheme: () => void
}

const DashboardCtx = createContext<DashboardState | null>(null)

export function DashboardProvider({
  months,
  theme,
  toggleTheme,
  children,
}: {
  months: string[]
  theme: Theme
  toggleTheme: () => void
  children: ReactNode
}) {
  const [view, setViewState] = useState<ViewKey>('upi')
  const [metric, setMetric] = useState<Metric>('volume')
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)

  const setView = (v: ViewKey) => {
    setViewState(v)
    trackEvent('view_changed', { view: v })
  }

  const effectiveMonth = selectedMonth ?? months[months.length - 1] ?? null

  const value = useMemo(
    () => ({
      view,
      setView,
      metric,
      setMetric,
      months,
      selectedMonth: effectiveMonth,
      setSelectedMonth,
      theme,
      toggleTheme,
    }),
    [view, metric, months, effectiveMonth, theme],
  )

  return <DashboardCtx.Provider value={value}>{children}</DashboardCtx.Provider>
}

export function useDashboard() {
  const ctx = useContext(DashboardCtx)
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider')
  return ctx
}

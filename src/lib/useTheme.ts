import { useEffect, useState } from 'react'
import { Chart } from 'chart.js'

export type Theme = 'light' | 'dark'

const TEXT_COLOR: Record<Theme, string> = { dark: '#9AA8BC', light: '#5C5648' }

function readStoredTheme(storageKey: string, fallback: Theme): Theme {
  const stored = localStorage.getItem(storageKey)
  return stored === 'light' || stored === 'dark' ? stored : fallback
}

// Standalone (not tied to any provider) so the toggle works everywhere, including
// before data has loaded. `storageKey`/`defaultTheme` let separate areas of the app
// (the light-first landing/explainer vs. the dark-first dashboard) keep their own
// default identity while still persisting each area's choice independently.
export function useTheme(storageKey = 'pp-dashboard-theme', defaultTheme: Theme = 'dark'): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme(storageKey, defaultTheme))

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(storageKey, theme)
    // Chart.js reads this default at chart creation/update time - keeping it in sync
    // is what makes existing charts' axis/legend text repaint on theme toggle.
    Chart.defaults.color = TEXT_COLOR[theme]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, storageKey])

  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))]
}

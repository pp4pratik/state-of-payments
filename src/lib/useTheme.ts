import { useEffect, useState } from 'react'
import { Chart } from 'chart.js'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'pp-dashboard-theme'
const TEXT_COLOR: Record<Theme, string> = { dark: '#9AA8BC', light: '#5C5648' }

function readStoredTheme(): Theme {
  return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
}

// Standalone (not tied to DashboardProvider) so the theme toggle also works on the
// loading/error Shell, which renders before appStats resolves and DashboardProvider mounts.
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(STORAGE_KEY, theme)
    // Chart.js reads this default at chart creation/update time - keeping it in sync
    // is what makes existing charts' axis/legend text repaint on theme toggle.
    Chart.defaults.color = TEXT_COLOR[theme]
  }, [theme])

  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))]
}

import type { Theme } from './DashboardContext'

export function chartGridColor(theme: Theme): string {
  return theme === 'light' ? 'rgba(22,19,15,0.08)' : 'rgba(255,255,255,0.06)'
}

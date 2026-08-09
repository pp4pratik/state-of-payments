import { useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, Moon, Sun } from 'lucide-react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { DashboardProvider, useDashboard } from '../lib/DashboardContext'
import { useTheme, type Theme } from '../lib/useTheme'
import { useCardTilt } from '../lib/useCardTilt'
import { useAppStatsAll } from '../lib/queries'
import { Controls } from '../components/Controls'
import { LandingView } from '../components/LandingView'
import { UpiView } from '../components/UpiView'
import { AutoPayView } from '../components/AutoPayView'
import { RbiCardsView } from '../components/RbiCardsView'
import { RbiPaymentsView } from '../components/RbiPaymentsView'
import { CircularsView } from '../components/CircularsView'

export const Route = createFileRoute('/')({
  component: Landing,
})

function Landing() {
  const [entered, setEntered] = useState(false)
  if (!entered) return <LandingView onEnter={() => setEntered(true)} />
  return <Dashboard onBack={() => setEntered(false)} />
}

function Dashboard({ onBack }: { onBack: () => void }) {
  const [theme, toggleTheme] = useTheme()
  const appStats = useAppStatsAll()

  if (appStats.isPending) return <Shell theme={theme} onToggleTheme={toggleTheme} onBack={onBack}>Loading…</Shell>
  if (appStats.error) return <Shell theme={theme} onToggleTheme={toggleTheme} onBack={onBack}>Failed to load: {appStats.error.message}</Shell>

  return (
    <DashboardProvider months={appStats.data.months} theme={theme} toggleTheme={toggleTheme}>
      <Header theme={theme} onToggleTheme={toggleTheme} onBack={onBack} />
      <ActiveView />
    </DashboardProvider>
  )
}

function Shell({
  children,
  theme,
  onToggleTheme,
  onBack,
}: {
  children: React.ReactNode
  theme: Theme
  onToggleTheme: () => void
  onBack: () => void
}) {
  return (
    <>
      <Header theme={theme} onToggleTheme={onToggleTheme} onBack={onBack} />
      <p className="section-note">{children}</p>
    </>
  )
}

function Header({ theme, onToggleTheme, onBack }: { theme: Theme; onToggleTheme: () => void; onBack: () => void }) {
  const titleRef = useRef<HTMLHeadingElement>(null)

  useGSAP(() => {
    if (!titleRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    gsap.from(titleRef.current, {
      opacity: 0,
      y: 30,
      rotationX: -50,
      transformOrigin: '50% 100%',
      duration: 0.8,
      ease: 'power3.out',
    })
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
      <div style={{ perspective: 800 }}>
        <h1 ref={titleRef}>Payments Pulse</h1>
        <p className="subtitle">India's UPI &amp; RBI payments data, live from NPCI and RBI.</p>
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button type="button" className="mini-btn" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={13} />
          Inception
        </button>
        <button
          type="button"
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>
      </div>
    </div>
  )
}

function ActiveView() {
  const { view } = useDashboard()
  const containerRef = useRef<HTMLDivElement>(null)
  useCardTilt(containerRef)

  return (
    <div ref={containerRef}>
      <Controls />
      {view === 'upi' && <UpiView />}
      {view === 'autopay' && <AutoPayView />}
      {view === 'rbi' && <RbiCardsView />}
      {view === 'rbipayments' && <RbiPaymentsView />}
      {view === 'circulars' && <CircularsView />}
    </div>
  )
}

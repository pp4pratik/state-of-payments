import { useRef, useState } from 'react'
import { ArrowRight, Moon, Play, Sun } from 'lucide-react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { useMonthlyTrend } from '../lib/queries'
import { useLiveCounter } from '../lib/useLiveCounter'
import { useTheme } from '../lib/useTheme'
import { crNum } from '../lib/format'
import '../lib/gsapSetup'
import '../landing.css'

const TICKER_ITEMS = ['UPI', 'AUTOPAY', 'RTGS', 'NEFT', 'IMPS', 'RBI CARDS', 'CIRCULARS', 'GEOGRAPHY']

function secondsInMonth(monthIso: string): number {
  const [y, m] = monthIso.split('-').map(Number)
  return new Date(y, m, 0).getDate() * 86400
}

// Tilts `el` toward the pointer in 3D (rotateX/Y) and springs back to flat on
// leave - needs `perspective` set on the element's parent to read as depth.
function attachTilt(el: HTMLElement): () => void {
  const rotX = gsap.quickTo(el, 'rotationX', { duration: 0.5, ease: 'power3.out' })
  const rotY = gsap.quickTo(el, 'rotationY', { duration: 0.5, ease: 'power3.out' })
  const lift = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3.out' })

  const onMove = (e: MouseEvent) => {
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    rotY(px * 14)
    rotX(py * -14)
    lift(-4)
  }
  const onLeave = () => {
    rotX(0)
    rotY(0)
    lift(0)
  }

  el.addEventListener('mousemove', onMove)
  el.addEventListener('mouseleave', onLeave)
  return () => {
    el.removeEventListener('mousemove', onMove)
    el.removeEventListener('mouseleave', onLeave)
  }
}

export function LandingView({ onEnter, onExplore }: { onEnter: () => void; onExplore: () => void }) {
  const [theme, toggleTheme] = useTheme('pp-landing-theme', 'light')
  const [startedAt] = useState(() => Date.now())
  const trend = useMonthlyTrend()
  const containerRef = useRef<HTMLDivElement>(null)
  const heroContentRef = useRef<HTMLDivElement>(null)
  const heroTitleRef = useRef<HTMLHeadingElement>(null)
  const heroGridRef = useRef<HTMLDivElement>(null)
  const statsGridRef = useRef<HTMLDivElement>(null)

  const latest = trend.data && trend.data.length > 0 ? trend.data[trend.data.length - 1] : null
  const secs = latest ? secondsInMonth(latest.month) : 0
  const volRate = latest ? (latest.total_volume_mn * 1_000_000) / secs : 0
  const valRateCr = latest ? latest.total_value_cr / secs : 0

  const vol = useLiveCounter(volRate, startedAt)
  const val = useLiveCounter(valRateCr, startedAt)

  useGSAP(
    () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

      // Hero entrance: the headline gets a 3D flip up (rotationX), everything
      // else around it fades and rises in behind it.
      if (heroTitleRef.current) {
        gsap.from(heroTitleRef.current, {
          opacity: 0,
          y: 46,
          rotationX: -55,
          transformOrigin: '50% 100%',
          duration: 0.9,
          ease: 'power3.out',
        })
      }
      if (heroContentRef.current) {
        const rest = heroContentRef.current.querySelectorAll(':scope > *:not(h1)')
        gsap.from(rest, { opacity: 0, y: 22, duration: 0.6, stagger: 0.09, ease: 'power2.out', delay: 0.25 })
      }

      // Hairline grid drifts slower than the page scrolls, reading as a background layer.
      if (heroGridRef.current) {
        gsap.to(heroGridRef.current, {
          yPercent: 18,
          ease: 'none',
          scrollTrigger: { trigger: heroGridRef.current, scrub: true },
        })
      }

      // Stat cards rise in as a group once scrolled into view.
      if (statsGridRef.current) {
        gsap.from(statsGridRef.current.children, {
          opacity: 0,
          y: 28,
          duration: 0.55,
          stagger: 0.08,
          ease: 'power2.out',
          scrollTrigger: { trigger: statsGridRef.current, start: 'top 85%' },
        })
      }
    },
    { scope: containerRef },
  )

  // Per-card mouse-tilt: imperative DOM listeners, so cleaned up separately from
  // the declarative tweens above (useGSAP's context revert doesn't remove these).
  useGSAP(() => {
    if (!statsGridRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const cards = [...statsGridRef.current.querySelectorAll<HTMLElement>('.landing-stat-card')]
    const cleanups = cards.map(attachTilt)
    return () => cleanups.forEach((fn) => fn())
  })

  return (
    <div className="landing" data-theme={theme} ref={containerRef}>
      <nav className="landing-nav">
        <span className="landing-wordmark">
          <span className="dot" />
          PAYMENTS PULSE
        </span>
        <div className="landing-nav-actions">
          <button
            type="button"
            className="landing-icon-btn"
            aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            onClick={toggleTheme}
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <button type="button" className="landing-btn" onClick={onEnter}>
            Enter dashboard
            <ArrowRight size={14} />
          </button>
        </div>
      </nav>

      <header className="landing-hero">
        <div className="landing-hero-grid" aria-hidden="true" ref={heroGridRef} />
        <div className="landing-hero-content" ref={heroContentRef}>
          <p className="landing-eyebrow">
            <span className="dot" />
            Live · straight from NPCI &amp; RBI
          </p>
          <h1 className="landing-h1" ref={heroTitleRef}>
            Every rupee,
            <span className="accent">tracked live.</span>
          </h1>
          <p className="landing-sub">
            UPI, AutoPay, RTGS, NEFT, IMPS — <strong>the rails moving India's money</strong>, pulled straight from
            NPCI and RBI's own published numbers. No paywall, no spin, updated every month.
          </p>
          <div className="landing-cta-row">
            <button type="button" className="landing-btn" onClick={onEnter}>
              <Play size={13} />
              Enter the dashboard
            </button>
            <a href="#landing-stats" className="landing-btn ghost">
              See today's numbers
              <ArrowRight size={14} style={{ transform: 'rotate(90deg)' }} />
            </a>
          </div>
          <p className="landing-hint">
            Prefer to jump straight in? <button type="button" onClick={onEnter}>Skip to the data →</button>
          </p>
        </div>
      </header>

      <div className="landing-ticker" aria-hidden="true">
        <div className="landing-ticker-track">
          {[...TICKER_ITEMS, ...TICKER_ITEMS, ...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
            <span className="landing-ticker-item" key={`${item}-${i}`}>
              <span className="sep">•</span>
              {item}
            </span>
          ))}
        </div>
      </div>

      <section className="landing-stats" id="landing-stats">
        <div className="landing-stats-head">
          <p className="landing-eyebrow">
            <span className="dot" />
            Right now, while you're here
          </p>
          <h2 className="landing-h2">The rails never sleep.</h2>
        </div>
        <div className="landing-stats-grid" ref={statsGridRef}>
          <div className="landing-stat-card">
            <p className="landing-stat-label">UPI payments since you opened this page</p>
            <p className="landing-stat-value">{Math.floor(vol.count).toLocaleString('en-IN')}</p>
          </div>
          <div className="landing-stat-card">
            <p className="landing-stat-label">Value moved since you opened this page</p>
            <p className="landing-stat-value">
              {crNum(val.count, 2)}
              <span className="unit">₹ Cr</span>
            </p>
          </div>
          <div className="landing-stat-card">
            <p className="landing-stat-label">Estimated UPI throughput, right now</p>
            <p className="landing-stat-value">
              {Math.round(volRate).toLocaleString('en-IN')}
              <span className="unit">txns / sec</span>
            </p>
          </div>
          <div className="landing-stat-card">
            <p className="landing-stat-label">Latest month covered</p>
            <p className="landing-stat-value" style={{ fontSize: 'clamp(20px, 2.4vw, 28px)' }}>
              {latest ? new Date(`${latest.month}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : '—'}
            </p>
          </div>
        </div>
        <p className="landing-disclaimer">
          These counters spread NPCI's latest published monthly total evenly across a second — a directional feel
          for scale, not a real-time feed or an accounting figure.
        </p>
      </section>

      <section className="landing-explore">
        <div className="landing-explore-inner">
          <div>
            <p className="landing-eyebrow">
              <span className="dot" />
              Curious how it works?
            </p>
            <h2 className="landing-h2">Watch the money move, one hop at a time.</h2>
          </div>
          <button type="button" className="landing-btn" onClick={onExplore}>
            Explore the rails
            <ArrowRight size={14} />
          </button>
        </div>
      </section>

      <div className="landing-footer-cta">
        <button type="button" className="landing-btn" onClick={onEnter}>
          Enter the dashboard
          <ArrowRight size={16} />
        </button>
        <p className="landing-footer-note">Sourced from NPCI &amp; RBI's official statistics.</p>
      </div>
    </div>
  )
}

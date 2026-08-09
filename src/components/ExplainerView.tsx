import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react'
import { JOURNEYS } from '../lib/journeys'
import { useTheme } from '../lib/useTheme'
import '../lib/gsapSetup'
import '../landing.css'

export function ExplainerView({ onBack }: { onBack: () => void }) {
  const [theme, toggleTheme] = useTheme('pp-landing-theme', 'light')
  const [activeKey, setActiveKey] = useState(JOURNEYS[0].key)
  const [stepIndex, setStepIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const active = JOURNEYS.find((j) => j.key === activeKey) ?? JOURNEYS[0]
  const step = active.steps[stepIndex] ?? active.steps[0]
  const isLast = stepIndex === active.steps.length - 1
  const stageRef = useRef<HTMLButtonElement>(null)
  const Icon = step.icon

  function selectJourney(key: string) {
    setActiveKey(key)
    setStepIndex(0)
    setRevealed(false)
  }
  function goTo(i: number) {
    setStepIndex(Math.max(0, Math.min(active.steps.length - 1, i)))
    setRevealed(false)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') goTo(stepIndex + 1)
      if (e.key === 'ArrowLeft') goTo(stepIndex - 1)
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setRevealed((r) => !r)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, active])

  useGSAP(
    () => {
      if (!stageRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      gsap.from(stageRef.current, { opacity: 0, y: 12, duration: 0.3, ease: 'power2.out' })
    },
    { dependencies: [activeKey, stepIndex, revealed], scope: stageRef },
  )

  return (
    <div className="landing" data-theme={theme}>
      <nav className="landing-nav">
        <button type="button" className="landing-btn ghost" onClick={onBack}>
          <ArrowLeft size={14} />
          Landing
        </button>
        <button
          type="button"
          className="landing-icon-btn"
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          onClick={toggleTheme}
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>
      </nav>

      <div className="explainer-wrap">
        <p className="landing-eyebrow" style={{ justifyContent: 'center' }}>
          <span className="dot" />
          Pick a rail
        </p>

        <div className="explainer-tabs">
          {JOURNEYS.map((j) => (
            <button
              key={j.key}
              type="button"
              className={`landing-journey-tab${j.key === activeKey ? ' active' : ''}`}
              onClick={() => selectJourney(j.key)}
            >
              {j.label}
            </button>
          ))}
        </div>

        <button type="button" className="explainer-stage" onClick={() => setRevealed((r) => !r)} ref={stageRef}>
          <p className="explainer-stage-step">
            Step {stepIndex + 1} / {active.steps.length}
          </p>
          <Icon size={34} />
          <p className="explainer-stage-title">{step.title}</p>

          {!revealed ? (
            <>
              <p className="explainer-stage-detail">{step.detail}</p>
              <span className="explainer-tap-hint">Tap for how this hop works</span>
            </>
          ) : (
            <>
              <p className="explainer-stage-expanded">{step.expanded}</p>
              <span className="journey-stat">
                <span className="journey-stat-label">{step.stat.label}</span>
                <span className="journey-stat-value">{step.stat.value}</span>
              </span>
              <div className="journey-hop">
                <span className="journey-hop-box">{step.hop.from}</span>
                <span className="journey-hop-arrow">
                  <ArrowRight size={16} />
                  <span className="journey-hop-arrow-label">{step.hop.label}</span>
                </span>
                <span className="journey-hop-box">{step.hop.to}</span>
              </div>
              <span className="explainer-tap-hint">Tap to close</span>
            </>
          )}
        </button>

        <div className="explainer-controls">
          <button type="button" className="explainer-nav-btn" onClick={() => goTo(stepIndex - 1)} disabled={stepIndex === 0} aria-label="Previous step">
            <ChevronLeft size={18} />
          </button>
          <div className="explainer-dots">
            {active.steps.map((s, i) => (
              <button
                key={s.title}
                type="button"
                className={`explainer-dot${i === stepIndex ? ' active' : ''}`}
                onClick={() => goTo(i)}
                aria-label={`Go to step ${i + 1}: ${s.title}`}
                aria-current={i === stepIndex}
              />
            ))}
          </div>
          <button type="button" className="explainer-nav-btn" onClick={() => goTo(stepIndex + 1)} disabled={isLast} aria-label="Next step">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}

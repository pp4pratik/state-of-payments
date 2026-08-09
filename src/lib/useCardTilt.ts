import { useEffect, type RefObject } from 'react'
import { gsap } from 'gsap'

const SELECTOR = '.kpi, .card'

type Ctrl = { rotX: (v: number) => void; rotY: (v: number) => void; lift: (v: number) => void }

// Delegates one mousemove/mouseleave listener on `containerRef` to tilt whichever
// .kpi/.card the pointer is over, in 3D (rotateX/Y + a slight lift), springing back
// flat on leave. Delegated (not per-card) so it keeps working as React swaps entire
// view trees in and out - no per-view wiring needed. transformPerspective is baked
// into each element's own transform, so it doesn't depend on an ancestor's CSS
// `perspective` reaching through however many nested grids/sections sit in between.
export function useCardTilt(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = containerRef.current
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const ctrls = new WeakMap<Element, Ctrl>()
    let active: HTMLElement | null = null

    const ctrlFor = (el: HTMLElement): Ctrl => {
      let c = ctrls.get(el)
      if (!c) {
        gsap.set(el, { transformPerspective: 800, transformOrigin: 'center' })
        c = {
          rotX: gsap.quickTo(el, 'rotationX', { duration: 0.5, ease: 'power3.out' }),
          rotY: gsap.quickTo(el, 'rotationY', { duration: 0.5, ease: 'power3.out' }),
          lift: gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3.out' }),
        }
        ctrls.set(el, c)
      }
      return c
    }

    const reset = (el: HTMLElement) => {
      const c = ctrlFor(el)
      c.rotX(0)
      c.rotY(0)
      c.lift(0)
    }

    const onMove = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(SELECTOR)
      if (target !== active) {
        if (active) reset(active)
        active = target
      }
      if (!target) return
      const r = target.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width - 0.5
      const py = (e.clientY - r.top) / r.height - 0.5
      const c = ctrlFor(target)
      c.rotY(px * 10)
      c.rotX(py * -10)
      c.lift(-3)
    }
    const onLeave = () => {
      if (active) reset(active)
      active = null
    }

    root.addEventListener('mousemove', onMove)
    root.addEventListener('mouseleave', onLeave)
    return () => {
      root.removeEventListener('mousemove', onMove)
      root.removeEventListener('mouseleave', onLeave)
    }
  }, [containerRef])
}

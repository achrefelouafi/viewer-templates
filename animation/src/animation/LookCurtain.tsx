import { useEffect, useRef, useState } from 'react'
import { useNoirWanted } from './BuildAnimator'
import { useAnimationStore } from './store'

/**
 * The transition between the viewer's own look and a template's (Blueprint's Noir). The scene can't
 * blend two looks (the lights, the sky and every surface change at once), so the switch happens
 * behind a curtain: a circle of the Noir background grows from the middle of the stage until it
 * covers it, the look switches (the new shaders build unseen), and the curtain fades away. Plain
 * CSS over the canvas: it costs the 3D nothing.
 */

const COVER_MS = 420
/** Held covered after the switch: the new look's first frames (and its shaders) draw unseen. */
const SETTLE_MS = 160
const REVEAL_MS = 420

type Phase = 'open' | 'closing' | 'closed' | 'opening'

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function LookCurtain() {
  const wanted = useNoirWanted() ? 'noir' : 'default'
  const applied = useAnimationStore((state) => state.appliedLook)
  const [phase, setPhase] = useState<Phase>('open')
  const token = useRef(0)

  useEffect(() => {
    if (wanted === applied) return
    const mine = ++token.current
    if (reducedMotion()) {
      useAnimationStore.setState({ appliedLook: wanted })
      return
    }
    const later = (ms: number, run: () => void) => window.setTimeout(() => token.current === mine && run(), ms)
    setPhase('closing')
    later(COVER_MS, () => {
      setPhase('closed')
      useAnimationStore.setState({ appliedLook: wanted })
      later(SETTLE_MS, () => {
        setPhase('opening')
        later(REVEAL_MS, () => setPhase('open'))
      })
    })
    // No cleanup: switching the look re-runs this effect, and the curtain must still open. A newer
    // switch takes over through `token` (the old timers then do nothing).
  }, [wanted, applied])

  if (phase === 'open') return null
  const covered = phase === 'closed' || phase === 'opening'
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        zIndex: 5,
        background: 'radial-gradient(circle at 50% 50%, #3a3e44 0%, #16181b 45%, #08090a 85%)',
        clipPath: covered || phase === 'closing' ? undefined : 'circle(0% at 50% 50%)',
        animation: phase === 'closing'
          ? `look-curtain-close ${COVER_MS}ms cubic-bezier(0.55, 0, 0.75, 0.4) both`
          : phase === 'opening'
            ? `look-curtain-open ${REVEAL_MS}ms ease-out both`
            : undefined,
      }}
    >
      <style>{`
        @keyframes look-curtain-close { from { clip-path: circle(0% at 50% 50%) } to { clip-path: circle(75% at 50% 50%) } }
        @keyframes look-curtain-open { from { opacity: 1 } to { opacity: 0 } }
      `}</style>
    </div>
  )
}

import { useEffect, useState } from 'react'

const IDLE_MS = 4000

/**
 * Fades viewer chrome gently back after 4s of pointer stillness over the 3D scene so the
 * architecture takes centre stage. Never activates while a popover/sheet/dialog is open, while
 * the pointer or keyboard focus is inside the chrome, on touch-only devices, or under reduced motion.
 */
export function useImmersive({ blocked }: { blocked: boolean }): boolean {
  const [immersive, setImmersive] = useState(false)

  useEffect(() => {
    if (blocked) {
      setImmersive(false)
      return
    }
    const fineHover = matchMedia('(hover: hover) and (pointer: fine)').matches
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fineHover || reduced) {
      setImmersive(false)
      return
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        // Stay awake if focus sits inside any chrome surface.
        if (document.activeElement?.closest('[data-chrome-surface]')) return
        setImmersive(true)
      }, IDLE_MS)
    }

    const wake = (event?: Event) => {
      setImmersive(false)
      const target = event?.target as Element | null
      if (target?.closest?.('[data-chrome-surface]')) {
        clearTimeout(timer)
        return
      }
      schedule()
    }

    const onPointerMove = (event: PointerEvent) => {
      setImmersive(false)
      const target = event.target as Element | null
      if (target?.closest?.('[data-chrome-surface]')) {
        clearTimeout(timer)
        return
      }
      schedule()
    }

    schedule()
    addEventListener('pointermove', onPointerMove, { passive: true })
    addEventListener('pointerdown', wake, { passive: true })
    addEventListener('keydown', wake)
    addEventListener('wheel', wake, { passive: true })
    addEventListener('touchstart', wake, { passive: true })
    document.addEventListener('focusin', wake)
    return () => {
      clearTimeout(timer)
      removeEventListener('pointermove', onPointerMove)
      removeEventListener('pointerdown', wake)
      removeEventListener('keydown', wake)
      removeEventListener('wheel', wake)
      removeEventListener('touchstart', wake)
      document.removeEventListener('focusin', wake)
    }
  }, [blocked])

  return blocked ? false : immersive
}

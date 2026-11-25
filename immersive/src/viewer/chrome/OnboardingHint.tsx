import { Route, X } from 'lucide-react'
import { useEffect } from 'react'

const STORAGE_KEY = 'pascal-viewer-onboarded'

export function readOnboardingDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function saveOnboardingDismissed() {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // Storage may be unavailable in private iframes; dismissal still holds for this visit.
  }
}

function OrbitGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-foreground/75" viewBox="0 0 18 18">
      <ellipse cx="9" cy="10" fill="none" rx="6.5" ry="3.2" stroke="currentColor" strokeDasharray="16 5" strokeWidth="1.2" />
      <path d="M13.5 7.4 L15.5 9.2 L12.9 10.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.2" />
      <circle cx="9" cy="6.2" fill="currentColor" r="1.4" />
    </svg>
  )
}

function ZoomGlyph() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-foreground/75" viewBox="0 0 18 18">
      <rect fill="none" height="12" rx="4" stroke="currentColor" strokeWidth="1.2" width="8" x="5" y="3" />
      <line stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" x1="9" x2="9" y1="5.8" y2="8.4" />
    </svg>
  )
}

function TourGlyph() {
  // The same route icon as the guided tour button in the controls bar.
  return <Route aria-hidden="true" className="h-4 w-4 shrink-0 text-foreground/75" />
}

/**
 * Quiet architectural onboarding toast with three mini illustrated gesture glyphs.
 * Remembered in localStorage and auto-dismissed on first canvas interaction or tour start.
 */
export function OnboardingHint({ visible, compact, onDismiss }: {
  visible: boolean
  compact: boolean
  onDismiss: () => void
}) {
  useEffect(() => {
    if (!visible) return
    const onCanvasInteract = (event: Event) => {
      if ((event.target as Element | null)?.tagName === 'CANVAS') onDismiss()
    }
    document.addEventListener('pointerdown', onCanvasInteract, true)
    document.addEventListener('wheel', onCanvasInteract, { capture: true, passive: true })
    return () => {
      document.removeEventListener('pointerdown', onCanvasInteract, true)
      document.removeEventListener('wheel', onCanvasInteract, true)
    }
  }, [visible, onDismiss])

  if (!visible) return null

  return (
    <div
      className={`ui-enter-up ui-immersive-transition pointer-events-none absolute z-20 flex justify-center ${
        compact
          ? 'inset-x-3 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.5rem)]'
          : 'inset-x-4 bottom-[6.25rem]'
      }`}
      data-chrome-edge="bottom"
      data-chrome-surface=""
      data-onboarding-hint=""
    >
      <div className="ui-glass relative pointer-events-auto flex items-center gap-2.5 rounded-full py-1.5 pr-1.5 pl-3.5 text-foreground text-xs">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
          <OrbitGlyph />
          <span>Drag to orbit</span>
        </span>
        <span aria-hidden="true" className="h-3.5 w-px bg-foreground/14" />
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
          <ZoomGlyph />
          <span>{compact ? 'Pinch' : 'Scroll'}</span>
        </span>
        {!compact ? (
          <>
            <span aria-hidden="true" className="h-3.5 w-px bg-foreground/14" />
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
              <TourGlyph />
              <span>
                Press <kbd className="mx-0.5 rounded-full border border-foreground/18 px-1.5 py-px font-mono text-[10px] text-foreground">T</kbd> for tour
              </span>
            </span>
          </>
        ) : null}
        <button
          aria-label="Dismiss hint"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          onClick={onDismiss}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

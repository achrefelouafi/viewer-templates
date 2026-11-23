import { Ruler, Trash2, X } from 'lucide-react'
import { playOrbTap } from '../chrome/orbSounds'
import { useMeasureStore } from './store'

/**
 * Compact frosted-glass bar shown above the controls while measure mode is active:
 * step hint, Shift axis-lock tip on desktop, Clear action, and a quick Done/exit button.
 */
export function MeasureHud({ compact }: { compact: boolean }) {
  const pendingA = useMeasureStore((s) => s.pendingA)
  const count = useMeasureStore((s) => s.measurements.length)
  const hasAnything = count > 0 || pendingA !== null

  return (
    <div
      className={`ui-enter-up pointer-events-none absolute z-20 flex justify-center ${
        compact
          ? 'inset-x-3 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.5rem)]'
          : 'inset-x-4 bottom-[6.25rem]'
      }`}
      data-chrome-edge="bottom"
      data-chrome-surface=""
      data-measure-hud=""
    >
      <div className="ui-glass relative pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-3.5 text-foreground text-xs">
        <Ruler aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-foreground/80" />
        <span className="whitespace-nowrap text-muted-foreground">
          {pendingA
            ? compact
              ? 'Tap end point'
              : 'Click end point'
            : compact
              ? 'Tap start point'
              : 'Click a point to start'}
        </span>

        {!compact && pendingA ? (
          <>
            <span aria-hidden="true" className="h-3.5 w-px bg-foreground/14" />
            <span className="whitespace-nowrap text-muted-foreground">
              Hold{' '}
              <kbd className="mx-0.5 rounded-full border border-foreground/18 px-1.5 py-px font-mono text-[10px] text-foreground">
                Shift
              </kbd>{' '}
              for axis
            </span>
          </>
        ) : null}

        {count > 0 ? (
          <span
            aria-label={`${count} ${count === 1 ? 'measurement' : 'measurements'}`}
            className="rounded-full bg-foreground/[0.08] px-2 py-0.5 font-mono text-[10px] text-foreground tabular-nums"
          >
            {count}
          </span>
        ) : null}

        {hasAnything ? (
          <button
            className="inline-flex h-7 items-center gap-1 rounded-full border border-foreground/12 px-2.5 font-medium text-[11px] text-foreground transition-colors hover:bg-foreground/[0.08] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            onClick={() => {
              playOrbTap('close')
              useMeasureStore.getState().clearMeasurements()
            }}
            type="button"
          >
            <Trash2 aria-hidden="true" className="h-3 w-3" />
            <span>Clear</span>
          </button>
        ) : null}

        <button
          aria-label="Exit measure"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          onClick={() => {
            playOrbTap('close')
            useMeasureStore.getState().exit()
          }}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

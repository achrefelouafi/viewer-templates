import { useLocale } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { formatRoomArea } from '@pascal-app/viewer/ui'
import { useEffect, useRef, useState } from 'react'
import type { TourStop } from './stops'
import { type GuidedTour, INTRO_MS } from './useGuidedTour'

const pad = (n: number) => String(n).padStart(2, '0')
const EXIT_MS = 180

/** Brief opening slate when the tour begins; steps out of the way before the first room arrives. */
export function TourIntro({ projectName, roomCount, visible }: {
  projectName: string | null
  roomCount: number
  visible: boolean
}) {
  if (!visible) return null
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-6 top-1/2 z-20 flex -translate-y-1/2 justify-center"
      data-guided-tour-intro=""
    >
      <div
        className="tour-intro-slate tour-title-halo flex max-w-lg flex-col items-center text-center text-foreground"
        style={{ animationDuration: `${INTRO_MS}ms` }}
      >
        <p className="font-mono text-[10px] text-foreground/75 uppercase tracking-[0.22em] sm:text-[11px]">
          Guided tour
        </p>
        <p className="mt-2 font-light text-3xl text-foreground leading-[1.05] tracking-[-0.03em] sm:text-5xl">
          {projectName || 'Architectural tour'}
        </p>
        <div className="mt-4 h-px w-14 bg-foreground/30" />
        <p className="mt-3 font-mono text-[11px] text-foreground/75 tabular-nums sm:text-xs">
          {roomCount} {roomCount === 1 ? 'room' : 'rooms'}
        </p>
      </div>
    </div>
  )
}

/**
 * Editorial lower-left room title card: arrives with a staggered fade and rise when the camera
 * reaches a room, settles out on departure, and names the next room quietly while travelling.
 */
export function TourTitleCard({ tour }: { tour: GuidedTour }) {
  const unit = useViewer((state) => state.unit)
  const locale = useLocale()
  const stop = tour.stops[tour.index]
  const lastArrived = useRef<{ stop: TourStop; index: number } | null>(null)
  const [exiting, setExiting] = useState<{ stop: TourStop; index: number } | null>(null)

  useEffect(() => {
    if (tour.phase === 'arrived' && stop) {
      lastArrived.current = { stop, index: tour.index }
      setExiting(null)
      return
    }
    if (tour.phase === 'travelling' && lastArrived.current) {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
      const departing = lastArrived.current
      lastArrived.current = null
      if (reduced) return
      setExiting(departing)
      const timer = setTimeout(() => setExiting(null), EXIT_MS)
      return () => clearTimeout(timer)
    }
  }, [tour.phase, tour.index, stop])

  const total = pad(tour.stops.length)

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="pointer-events-none absolute right-[5.25rem] bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] left-4 z-20 sm:right-auto sm:bottom-24 sm:left-6 sm:max-w-[min(30rem,calc(100vw-22rem))]"
      data-guided-tour-title=""
    >
      {!tour.intro && stop ? (
        <div className="relative">
          {exiting && tour.phase === 'travelling' ? (
            <div aria-hidden="true" className="tour-card-out tour-glass pointer-events-none absolute bottom-0 left-0 w-fit max-w-full rounded-[20px] px-5 py-4">
              <p className="flex items-center gap-2 font-mono text-[10px] text-foreground/75 uppercase tracking-[0.16em] tabular-nums sm:text-[11px]">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: exiting.stop.color }} />
                <span className="truncate">
                  {pad(exiting.index + 1)} / {total}
                  {exiting.stop.floorName ? ` · ${exiting.stop.floorName}` : ''}
                </span>
              </p>
              <p className="mt-1.5 font-light text-2xl text-foreground leading-[1.06] tracking-[-0.03em] sm:text-[2.75rem]">
                {exiting.stop.label}
              </p>
            </div>
          ) : null}

          {tour.phase === 'arrived' ? (
            <div className="tour-glass relative w-fit max-w-full rounded-[20px] px-5 py-4" key={stop.zoneId}>
              <p className="tour-rise flex items-center gap-2 font-mono text-[10px] text-foreground/75 uppercase tracking-[0.16em] tabular-nums sm:text-[11px]">
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: stop.color }} />
                <span className="truncate">
                  {pad(tour.index + 1)} / {total}
                  {stop.floorName ? ` · ${stop.floorName}` : ''}
                </span>
              </p>
              <h2
                className="tour-rise mt-1.5 font-light text-2xl text-foreground leading-[1.06] tracking-[-0.03em] sm:text-[2.75rem]"
                style={{ animationDelay: '60ms' }}
              >
                {stop.label}
              </h2>
              <div
                aria-hidden="true"
                className="tour-rule-draw mt-2.5 h-px w-16 origin-left bg-foreground/25 sm:mt-3 sm:w-28"
                style={{ animationDelay: '120ms' }}
              />
              <p
                className="tour-rise mt-2 font-mono text-[11px] text-foreground/75 tabular-nums sm:text-xs"
                style={{ animationDelay: '160ms' }}
              >
                {formatRoomArea(stop.areaM2, unit, locale)}
                {!tour.playing ? ' · Paused' : ''}
              </p>
            </div>
          ) : (
            <div
              className="tour-rise tour-glass relative w-fit max-w-full rounded-[20px] px-5 py-4"
              key={`travel-${stop.zoneId}`}
              style={{ animationDelay: exiting ? '90ms' : '0ms' }}
            >
              <p className="font-mono text-[10px] text-foreground/75 uppercase tracking-[0.16em] tabular-nums sm:text-[11px]">
                {pad(tour.index + 1)} / {total}
                {stop.floorName ? ` · ${stop.floorName}` : ''}
              </p>
              <p className="mt-1 flex items-center gap-2 font-light text-foreground/85 text-sm leading-snug tracking-[-0.01em] sm:text-lg">
                <span aria-hidden="true" className="tour-ping inline-block h-px w-4 shrink-0 bg-foreground/60" />
                <span className="truncate">On the way to {stop.label}</span>
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

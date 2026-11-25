import { useLocale } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { formatRoomArea, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@pascal-app/viewer/ui'
import { Check, ChevronDown, Moon, Pause, Play, SkipBack, SkipForward, Sun, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { chooseTheme, isDark } from '../theme'
import type { TourFloor } from './stops'
import { DWELL_MS, type GuidedTour } from './useGuidedTour'

const pad = (n: number) => String(n).padStart(2, '0')

/** Beside the controls bar, in the shared glass look: invites the visitor into the guided tour. */
export function TourButton({ onStart, disabled }: {
  onStart: () => void
  disabled: boolean
}) {
  return (
    <button
      className="ui-glass ui-sheen pointer-events-auto relative flex h-12 items-center gap-2.5 overflow-hidden rounded-full pr-5 pl-3 text-left text-foreground transition-colors hover:bg-accent/70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:opacity-40 sm:h-14"
      data-guided-tour-start=""
      disabled={disabled}
      onClick={onStart}
      title="Visit every room, one after another"
      type="button"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-foreground text-background sm:h-9 sm:w-9">
        <Play className="h-3.5 w-3.5 translate-x-px fill-current" />
      </span>
      <span className="font-medium text-sm leading-tight">Guided tour</span>
    </button>
  )
}

function RoundButton({ label, onClick, children, primary = false }: {
  label: string
  onClick: () => void
  children: ReactNode
  primary?: boolean
}) {
  return (
    <button
      aria-label={label}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 sm:h-9 sm:w-9 ${
        primary ? 'bg-foreground text-background hover:opacity-90' : 'text-foreground/85 hover:bg-accent/70 hover:text-foreground'
      }`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

/**
 * Slim bottom transport bar while the tour runs: previous, play/pause, next, a clickable
 * segmented timeline (one segment per room filling over `DWELL_MS`), mono status and Exit.
 */
export function TourControls({ tour }: { tour: GuidedTour }) {
  const state = tour.phase === 'travelling' ? ' · on the way' : tour.playing ? '' : ' · paused'
  const total = tour.stops.length
  const multiFloor = new Set(tour.stops.map((s) => s.levelId)).size > 1
  const dense = total > 16

  return (
    <div
      // Clears the viewer's bottom-left compass (`left-3 bottom-3 h-8 w-8`, right edge 44px) with
      // the same 52px (`3.25rem`) inset used beside it on desktop, and keeps ≥56px side margin at `sm`.
      className="pointer-events-none absolute right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[3.25rem] z-30 flex justify-center sm:right-auto sm:bottom-6 sm:left-1/2 sm:w-[min(36rem,calc(100vw-7rem))] sm:-translate-x-1/2 lg:w-[min(36rem,calc(100vw-18rem))]"
      data-guided-tour-controls=""
    >
      <div className="tour-glass relative pointer-events-auto flex w-full items-center gap-1.5 rounded-full px-1.5 py-1.5 text-foreground sm:gap-2.5 sm:px-2">
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <RoundButton label="Previous room" onClick={tour.previous}>
            <SkipBack className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </RoundButton>
          <RoundButton label={tour.playing ? 'Pause tour' : 'Play tour'} onClick={tour.toggle} primary>
            {tour.playing ? <Pause className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <Play className="h-3.5 w-3.5 translate-x-px sm:h-4 sm:w-4" />}
          </RoundButton>
          <RoundButton label="Next room" onClick={tour.next}>
            <SkipForward className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </RoundButton>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-1 sm:px-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-[10px] text-muted-foreground leading-none tabular-nums" role="status">
              <span className="sr-only">Room </span>
              {pad(tour.index + 1)} / {pad(total)}
              {state ? <span className="hidden sm:inline">{state}</span> : null}
              {state ? <span className="sr-only sm:hidden">{state}</span> : null}
            </span>
          </div>

          <TooltipProvider delayDuration={120}>
            <div aria-label="Tour timeline" className={`flex w-full items-center ${dense ? 'gap-0.5' : 'gap-1'}`} role="group">
              {tour.stops.map((stop, i) => {
                const isCurrent = i === tour.index
                const isSeen = tour.seen.has(stop.zoneId)
                const counting = isCurrent && tour.playing && tour.phase === 'arrived'
                const travelling = isCurrent && tour.phase === 'travelling'
                return (
                  <Tooltip delayDuration={120} key={stop.zoneId}>
                    <TooltipTrigger asChild>
                      <button
                        aria-label={`${pad(i + 1)} ${stop.label}`}
                        aria-pressed={isCurrent}
                        className="group relative -my-1.5 flex min-w-[3px] flex-1 cursor-pointer items-center rounded-full py-2 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                        onClick={() => tour.highlight(i)}
                        type="button"
                      >
                        <span className="relative block h-[3px] w-full overflow-hidden rounded-full bg-foreground/15 transition-[height,background-color] duration-150 group-hover:h-[5px] group-hover:bg-foreground/30 group-focus-visible:h-[5px]">
                          {isSeen && !isCurrent ? (
                            <span className="absolute inset-0 rounded-full bg-foreground/75" />
                          ) : counting ? (
                            <span
                              className="tour-segment-fill absolute inset-0 rounded-full bg-foreground"
                              key={tour.index}
                              style={{ animationDuration: `${DWELL_MS}ms` }}
                            />
                          ) : travelling ? (
                            <span className="tour-ping absolute inset-0 rounded-full bg-foreground/45" />
                          ) : isCurrent ? (
                            <span className="absolute inset-0 rounded-full bg-foreground/70" />
                          ) : null}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>
                      <span className="font-mono opacity-65">{pad(i + 1)}</span> {stop.label}
                      {multiFloor && stop.floorName ? <span className="opacity-65"> · {stop.floorName}</span> : null}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </TooltipProvider>
        </div>

        <button
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-foreground/15 px-2.5 font-medium text-xs transition-colors hover:bg-accent/70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 sm:h-9 sm:px-3 sm:text-sm"
          data-guided-tour-exit=""
          onClick={tour.stop}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
          <span>Exit</span>
          <kbd className="hidden rounded-full border border-foreground/15 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground leading-none sm:inline">
            Esc
          </kbd>
        </button>
      </div>
    </div>
  )
}

/**
 * Quiet editorial route index beside the scene: floors as section headers, mono-numbered rooms,
 * small colour mark, seen rooms dimmed with a tick, current row emphasised. Collapsible and
 * collapsed by default under 1024px.
 */
export function TourPanel({ tour, floors }: { tour: GuidedTour; floors: TourFloor[] }) {
  const unit = useViewer((state) => state.unit)
  const locale = useLocale()
  const [open, setOpen] = useState(() => matchMedia('(min-width: 1024px)').matches)
  const userToggled = useRef(false)
  const list = useRef<HTMLOListElement>(null)
  const current = tour.stops[tour.index]
  const seenCount = tour.seen.size
  const total = tour.stops.length

  // Collapse when going narrow and open when going wide, unless the visitor already toggled it.
  useEffect(() => {
    const query = matchMedia('(min-width: 1024px)')
    const onChange = (event: MediaQueryListEvent) => {
      if (!userToggled.current) setOpen(event.matches)
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    list.current?.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest', behavior })
  }, [tour.index, open])

  let n = 0
  return (
    <aside
      aria-label="Guided tour route"
      className={`tour-glass pointer-events-auto absolute top-40 right-3 flex flex-col overflow-hidden text-foreground sm:top-20 sm:right-6 ${
        open
          ? 'corner-smooth z-40 max-h-[calc(100dvh-18rem)] w-[min(17.5rem,calc(100vw-1.5rem))] rounded-2xl sm:z-30 sm:max-h-[calc(100dvh-11rem)]'
          : 'z-30 max-w-[calc(100vw-1.5rem)] rounded-full'
      }`}
      data-guided-tour-panel=""
    >
      <button
        aria-expanded={open}
        className={`flex w-full items-center gap-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 ${
          open ? 'px-4 pt-3.5 pb-2.5' : 'rounded-full px-3.5 py-2'
        }`}
        onClick={() => {
          userToggled.current = true
          setOpen((value) => !value)
        }}
        type="button"
      >
        <div className="min-w-0 flex-1">
          {open ? (
            <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.16em]">Route</p>
          ) : null}
          <p className={open ? 'mt-0.5 text-xs' : 'text-xs'}>
            <span className="font-mono text-foreground tabular-nums">{pad(seenCount)}</span>
            <span className="font-mono text-muted-foreground tabular-nums"> / {pad(total)}</span>
            <span className="text-muted-foreground"> rooms seen</span>
          </p>
        </div>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <>
          <div aria-hidden="true" className="mx-4 mb-2.5 h-px overflow-hidden bg-foreground/10">
            <div
              className="h-full bg-foreground/75 transition-[width] duration-500"
              style={{ width: `${total ? (seenCount / total) * 100 : 0}%` }}
            />
          </div>
          <ol className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-foreground/10 border-t px-2 pt-1.5 pb-2" ref={list}>
            {floors.map((floor, floorIndex) => (
              <li className={floorIndex > 0 ? 'mt-1.5 border-foreground/10 border-t pt-1' : undefined} key={floor.levelId}>
                {floors.length > 1 ? (
                  <p className="px-2.5 pt-2 pb-1 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.14em]">
                    {floor.name}
                  </p>
                ) : null}
                <ol>
                  {floor.stops.map((stop) => {
                    const index = n++
                    const isCurrent = current?.zoneId === stop.zoneId
                    const isSeen = tour.seen.has(stop.zoneId)
                    return (
                      <li key={stop.zoneId}>
                        <button
                          aria-current={isCurrent ? 'step' : undefined}
                          className={`relative flex w-full items-center gap-2 rounded-full px-2.5 py-1.5 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 ${
                            isCurrent
                              ? 'bg-foreground/[0.08] font-medium text-foreground'
                              : isSeen
                                ? 'text-muted-foreground/80 hover:bg-accent/50 hover:text-foreground'
                                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                          }`}
                          data-state={isCurrent ? 'current' : isSeen ? 'seen' : 'ahead'}
                          data-zone-id={stop.zoneId}
                          onClick={() => tour.highlight(index)}
                          title={`Show ${stop.label} on its own`}
                          type="button"
                        >
                          {isCurrent ? (
                            <span
                              aria-hidden="true"
                              className={`absolute top-2 bottom-2 left-0.5 w-0.5 rounded-full bg-foreground ${tour.phase === 'travelling' ? 'tour-ping' : ''}`}
                            />
                          ) : null}
                          <span className={`w-4 shrink-0 font-mono text-[10px] tabular-nums ${isCurrent ? 'text-foreground' : 'text-muted-foreground/70'}`}>
                            {pad(index + 1)}
                          </span>
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{
                              background: isSeen || isCurrent ? stop.color : 'transparent',
                              boxShadow: isSeen || isCurrent ? 'none' : `inset 0 0 0 1.5px ${stop.color}`,
                            }}
                          />
                          <span className="min-w-0 flex-1 truncate">{stop.label}</span>
                          {isSeen && !isCurrent ? (
                            <Check aria-hidden="true" className="h-3 w-3 shrink-0 text-muted-foreground/75" strokeWidth={2.25} />
                          ) : null}
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                            {formatRoomArea(stop.areaM2, unit, locale)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </aside>
  )
}

/** Light or dark, as one switch (placed by `ViewerOverlay`); the tour's Noir/Paper look follows it. */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const [dark, setDark] = useState(isDark)
  useEffect(() => {
    const sync = () => setDark(isDark())
    addEventListener('pascal-theme', sync)
    const system = matchMedia('(prefers-color-scheme: dark)')
    system.addEventListener('change', sync)
    return () => {
      removeEventListener('pascal-theme', sync)
      system.removeEventListener('change', sync)
    }
  }, [])
  return (
    <button
      aria-checked={dark}
      aria-label="Dark mode"
      className={`tour-glass relative pointer-events-auto flex h-10 items-center gap-2 rounded-full p-1 text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 ${
        compact ? 'sm:pr-3' : 'pr-3'
      }`}
      data-theme-switch=""
      onClick={() => chooseTheme(!dark)}
      role="switch"
      type="button"
    >
      <span className="relative flex h-8 w-14 items-center justify-between rounded-full bg-accent/80 px-2">
        <span className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-foreground shadow transition-transform duration-300 ${dark ? 'translate-x-6' : ''}`} />
        <Sun className={`relative h-3.5 w-3.5 ${dark ? 'text-muted-foreground' : 'text-background'}`} />
        <Moon className={`relative h-3.5 w-3.5 ${dark ? 'text-background' : 'text-muted-foreground'}`} />
      </span>
      <span className={`w-9 font-medium text-xs ${compact ? 'hidden sm:inline' : ''}`}>{dark ? 'Dark' : 'Light'}</span>
    </button>
  )
}

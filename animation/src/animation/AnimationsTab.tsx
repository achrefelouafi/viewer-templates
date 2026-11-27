import { useViewer } from '@pascal-app/viewer'
import { Camera, ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Sparkles, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAnimationStore } from './store'
import { type AnimationTemplate, TEMPLATES, type TemplateId } from './templates'

/**
 * The Animations tab, docked on the right edge: it folds to a slim tab (title, play, replay and a
 * progress line) and opens into the template grid, the scrubber, the transport, speed and the
 * cinematic camera switch. Everything else on screen is the default viewer, unchanged.
 */

const SPEEDS = [0.5, 1, 2] as const

/** A tiny looping picture of each template, drawn in the card. */
function TemplateGlyph({ id, accent }: { id: TemplateId; accent: string }) {
  const common = { fill: 'none', stroke: accent, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (id) {
    case 'blueprint':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <path {...common} className="anim-draw" d="M6 22 L6 12 L20 4 L34 12 L34 22 Z M14 22 L14 15 L20 15 L20 22 M24 14 L30 14 L30 18 L24 18 Z" />
        </svg>
      )
    case 'timelapse':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <path {...common} d="M4 24 H36" />
          <path {...common} d="M10 24 V8 H32 M30 8 V12" />
          <rect className="anim-tilt" fill={accent} height="2.5" opacity="0.85" rx="0.6" width="10" x="20" y="21.5" />
          <rect fill={accent} height="9" opacity="0.5" rx="0.6" width="2.5" x="14" y="15" />
        </svg>
      )
    case 'skydrop':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <path {...common} d="M4 25 H36" />
          <rect className="anim-fall" fill={accent} height="6" rx="1" width="9" x="15.5" y="2" />
          <rect fill={accent} height="5" opacity="0.5" rx="1" width="9" x="6" y="20" />
          <rect fill={accent} height="5" opacity="0.5" rx="1" width="9" x="25" y="20" />
        </svg>
      )
    case 'magnetic':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <rect className="anim-snap-a" fill={accent} height="7" opacity="0.9" rx="1" width="7" x="12" y="11" />
          <rect className="anim-snap-b" fill={accent} height="7" opacity="0.6" rx="1" width="7" x="21" y="11" />
          <rect className="anim-snap-c" fill={accent} height="5" opacity="0.4" rx="1" width="16" x="12" y="5" />
        </svg>
      )
    case 'goldenhour':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <path {...common} d="M3 22 H37" />
          <g className="anim-sun"><circle cx="20" cy="22" fill={accent} r="4" /></g>
          <path d="M14 22 V16 L20 12 L26 16 V22" fill={accent} opacity="0.45" />
        </svg>
      )
    case 'tornado':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <path {...common} d="M8 4 H32 M11 9 H29 M14 14 H26 M17 19 H23 M19 24 H21" opacity="0.7" />
          <rect className="anim-orbit" fill={accent} height="3.5" rx="0.6" width="3.5" x="28" y="5" />
        </svg>
      )
    case 'sand':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <path d="M12 24 V15 L20 9 L28 15 V24 Z" fill={accent} opacity="0.35" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <circle className="anim-grain" cx={6 + i * 5.5} cy="5" fill={accent} key={i} r="1.2" style={{ animationDelay: `${i * 0.22}s`, ['--x' as string]: `${6 + i * 5.5}px` }} />
          ))}
        </svg>
      )
    case 'clay':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <path d="M10 24 V14 L20 6 L30 14 V24 Z" fill="#f1ede6" />
          <path className="anim-paint" d="M10 24 V14 L20 6 L30 14 V24 Z" fill={accent} />
        </svg>
      )
    case 'rooms':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <rect {...common} height="20" width="30" x="5" y="4" />
          <path {...common} d="M20 4 V24 M5 14 H20" />
          <rect className="anim-room" fill={accent} height="9" opacity="0.6" width="14" x="6" y="5" />
        </svg>
      )
    case 'ripple':
      return (
        <svg aria-hidden className="anim-glyph" viewBox="0 0 40 28">
          <ellipse {...common} className="anim-ring" cx="20" cy="18" rx="16" ry="6" />
          <ellipse {...common} className="anim-ring anim-ring-2" cx="20" cy="18" rx="16" ry="6" />
          <rect fill={accent} height="7" rx="1" width="6" x="17" y="10" />
        </svg>
      )
  }
}

function TemplateCard({ template, active, onPick }: { template: AnimationTemplate; active: boolean; onPick: () => void }) {
  return (
    <button
      aria-pressed={active}
      className={`anim-card flex items-center gap-2 rounded-xl border p-1.5 text-left transition-all ${
        active ? 'border-transparent bg-accent' : 'border-border/60 bg-background/40 hover:bg-accent/60'
      }`}
      data-template={template.id}
      onClick={onPick}
      style={active ? { boxShadow: `inset 0 0 0 1.5px ${template.accent}` } : undefined}
      title={template.tagline}
      type="button"
    >
      <span className="flex h-8 w-11 shrink-0 items-center justify-center rounded-lg" style={{ background: `${template.accent}1f` }}>
        <TemplateGlyph accent={template.accent} id={template.id} />
      </span>
      <span className="min-w-0 truncate font-medium text-[12px] leading-tight">{template.name}</span>
    </button>
  )
}

function formatTime(seconds: number) {
  return `${seconds.toFixed(1)}s`
}

function IconButton({ label, onClick, children, disabled }: {
  label: string
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      aria-label={label}
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

export function AnimationsTab({ ready }: {
  /** The scene is on screen: the build can be measured. */
  ready: boolean
}) {
  const [open, setOpen] = useState(() => useAnimationStore.getState().panelOpen)
  const template = useAnimationStore((s) => s.template)
  const status = useAnimationStore((s) => s.status)
  const time = useAnimationStore((s) => s.time)
  const duration = useAnimationStore((s) => s.duration)
  const speed = useAnimationStore((s) => s.speed)
  const cinematic = useAnimationStore((s) => s.cinematic)
  const pieceCount = useAnimationStore((s) => s.pieceCount)
  const zoom = useAnimationStore((s) => s.zoom)
  const tilt = useAnimationStore((s) => s.tilt)
  const walkthrough = useViewer((s) => s.walkthroughMode)
  const store = useAnimationStore.getState()
  const running = status === 'playing' || status === 'paused'
  const active = TEMPLATES.find((t) => t.id === template)!

  // A walkthrough owns the screen and the camera: a build in progress steps aside.
  useEffect(() => {
    if (walkthrough && running) useAnimationStore.getState().stop()
  }, [walkthrough, running])

  // `?animation=<template>` plays that template once the scene is ready (handy for embeds).
  useEffect(() => {
    if (!ready) return
    const wanted = new URLSearchParams(window.location.search).get('animation') as TemplateId | null
    if (wanted && TEMPLATES.some((t) => t.id === wanted)) useAnimationStore.getState().select(wanted)
  }, [ready])

  if (walkthrough) return null

  const progress = duration > 0 ? Math.min(1, time / duration) : 0
  const toggleOpen = (next: boolean) => {
    setOpen(next)
    useAnimationStore.setState({ panelOpen: next })
  }

  const playPause = status === 'playing' ? (
    <IconButton label="Pause" onClick={store.pause}><Pause className="size-4" /></IconButton>
  ) : (
    <IconButton disabled={!ready} label={status === 'paused' ? 'Resume' : `Play ${active.name}`} onClick={store.play}>
      <Play className="size-4" />
    </IconButton>
  )

  const scrubber = (
    <input
      aria-label="Timeline"
      className="anim-scrub h-1 w-full cursor-pointer"
      disabled={!ready}
      max={1000}
      min={0}
      onChange={(event) => store.seek((Number(event.target.value) / 1000) * (duration || 1))}
      style={{ ['--anim-accent' as string]: active.accent, ['--anim-progress' as string]: `${progress * 100}%` }}
      type="range"
      value={Math.round(progress * 1000)}
    />
  )

  // Docked on the right edge, centred top to bottom, so the house in the middle stays clear.
  return (
    <div className="pointer-events-none absolute top-1/2 right-3 z-40 flex -translate-y-1/2 flex-col items-end sm:right-4">
      <div
        className="dark corner-smooth pointer-events-auto flex max-h-[calc(100dvh-9rem)] flex-col overflow-hidden rounded-2xl border border-border bg-background/90 text-foreground shadow-elevation-5 backdrop-blur-xl"
        data-animations-tab={open ? 'open' : 'closed'}
      >
        {open ? (
          <div className="flex w-[min(18rem,calc(100vw-1.5rem))] flex-col">
            <div className="flex items-center gap-1 p-1.5 pb-0">
              <button
                aria-expanded
                className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-full px-2.5 font-medium text-sm transition-colors hover:bg-accent"
                onClick={() => toggleOpen(false)}
                title="Hide animations"
                type="button"
              >
                <Sparkles className="size-4 shrink-0" style={{ color: active.accent }} />
                <span className="truncate">Animations</span>
                {pieceCount > 0 && <span className="ml-auto font-mono text-[10px] text-muted-foreground">{pieceCount} pieces</span>}
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </div>

            <div className="anim-strip grid grid-cols-2 gap-1.5 overflow-y-auto p-2">
              {TEMPLATES.map((t) => (
                <TemplateCard active={t.id === template} key={t.id} onPick={() => ready && store.select(t.id)} template={t} />
              ))}
            </div>

            <p className="px-3 pb-1 text-[11px] text-muted-foreground leading-snug">
              <span className="font-medium text-foreground">{active.name}.</span> {active.tagline}
            </p>

            <div className="flex flex-col gap-1.5 border-border/60 border-t px-3 py-2">
              <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-[0.12em]">Camera</span>
              <label className="flex items-center gap-2 text-[11px]">
                <span className="w-9 shrink-0 text-muted-foreground">Zoom</span>
                <input
                  aria-label="Camera zoom"
                  className="anim-scrub h-1 w-full cursor-pointer"
                  max={200}
                  min={50}
                  onChange={(event) => store.setZoom(Number(event.target.value) / 100)}
                  style={{ ['--anim-accent' as string]: active.accent, ['--anim-progress' as string]: `${((zoom * 100 - 50) / 150) * 100}%` }}
                  type="range"
                  value={Math.round(zoom * 100)}
                />
                <span className="w-9 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">{Math.round(zoom * 100)}%</span>
              </label>
              <label className="flex items-center gap-2 text-[11px]">
                <span className="w-9 shrink-0 text-muted-foreground">Tilt</span>
                <input
                  aria-label="Camera tilt"
                  className="anim-scrub h-1 w-full cursor-pointer"
                  max={85}
                  min={5}
                  onChange={(event) => store.setTilt(Number(event.target.value))}
                  style={{ ['--anim-accent' as string]: active.accent, ['--anim-progress' as string]: `${(((tilt ?? 58) - 5) / 80) * 100}%` }}
                  type="range"
                  value={tilt ?? 58}
                />
                <button
                  className={`w-9 shrink-0 rounded-full text-right font-mono text-[10px] tabular-nums ${tilt === null ? 'text-muted-foreground' : 'text-foreground hover:underline'}`}
                  onClick={() => store.setTilt(null)}
                  title={tilt === null ? 'Each template picks its own tilt' : 'Back to each template’s own tilt'}
                  type="button"
                >
                  {tilt === null ? 'Auto' : `${tilt}°`}
                </button>
              </label>
              <span className="text-[10px] text-muted-foreground leading-snug">Tilt: 5° looks straight down, 85° from the ground.</span>
            </div>

            <div className="flex flex-col gap-1.5 border-border/60 border-t p-1.5 pt-2">
              <div className="flex items-center gap-2 px-1.5">
                {scrubber}
                <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-muted-foreground tabular-nums">
                  {formatTime(time)} / {formatTime(duration)}
                </span>
              </div>
              <div className="flex items-center gap-0.5">
                {playPause}
                <IconButton disabled={!ready} label="Replay" onClick={store.replay}><RotateCcw className="size-4" /></IconButton>
                <IconButton disabled={!running} label="Stop and show the finished house" onClick={store.stop}>
                  <Square className="size-3.5" />
                </IconButton>
                <span className="flex-1" />
                <button
                  className="h-8 shrink-0 rounded-full px-2 font-mono text-[11px] transition-colors hover:bg-accent"
                  onClick={() => store.setSpeed(SPEEDS[(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]!)}
                  title="Speed"
                  type="button"
                >
                  {speed}×
                </button>
                <button
                  aria-pressed={cinematic}
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full transition-colors ${cinematic ? 'bg-accent' : 'text-muted-foreground hover:bg-accent'}`}
                  onClick={() => store.setCinematic(!cinematic)}
                  title={cinematic ? 'Cinematic camera on' : 'Cinematic camera off'}
                  type="button"
                >
                  <Camera className="size-4" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          // Folded: a slim tab with the transport, and the progress while a build plays.
          <div className="flex flex-col items-stretch">
            <div className="flex items-center gap-0.5 p-1.5">
              <button
                aria-expanded={false}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 font-medium text-sm transition-colors hover:bg-accent"
                onClick={() => toggleOpen(true)}
                title="Show animations"
                type="button"
              >
                <ChevronLeft className="size-3.5 text-muted-foreground" />
                <Sparkles className="size-4" style={{ color: active.accent }} />
                Animations
              </button>
              {playPause}
              <IconButton disabled={!ready} label="Replay" onClick={store.replay}><RotateCcw className="size-4" /></IconButton>
            </div>
            {running && (
              <div className="mx-3 mb-2 h-0.5 overflow-hidden rounded-full bg-foreground/15">
                <div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: active.accent }} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

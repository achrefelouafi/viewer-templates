import { useViewer } from '@pascal-app/viewer'
import { Camera, ChevronDown, Pause, Play, RotateCcw, Sparkles, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAnimationStore } from './store'
import { type AnimationTemplate, TEMPLATES, type TemplateId } from './templates'

/**
 * The Animations tab: a pill that sits above the viewer's controls bar and opens into the
 * template strip, the transport (play, pause, replay, stop), a scrubber, speed and the cinematic
 * camera switch. Everything else on screen is the default viewer, unchanged.
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
      className={`anim-card group relative flex w-[8.75rem] shrink-0 flex-col items-start gap-1.5 rounded-2xl border p-2.5 text-left transition-all ${
        active ? 'border-transparent bg-accent' : 'border-border/60 bg-background/40 hover:bg-accent/60'
      }`}
      data-template={template.id}
      onClick={onPick}
      style={active ? { boxShadow: `inset 0 0 0 1.5px ${template.accent}` } : undefined}
      title={template.tagline}
      type="button"
    >
      <span className="flex h-9 w-full items-center justify-center rounded-xl" style={{ background: `${template.accent}1f` }}>
        <TemplateGlyph accent={template.accent} id={template.id} />
      </span>
      <span className="font-medium text-[13px] leading-none">{template.name}</span>
      <span className="line-clamp-2 text-[11px] text-muted-foreground leading-snug">{template.tagline}</span>
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

export function AnimationsTab({ ready, liftClassName }: {
  /** The scene is on screen: the build can be measured. */
  ready: boolean
  /** Where the tab sits: above the controls bar, or at the bottom when the bar is hidden. */
  liftClassName: string
}) {
  const [open, setOpen] = useState(false)
  const template = useAnimationStore((s) => s.template)
  const status = useAnimationStore((s) => s.status)
  const time = useAnimationStore((s) => s.time)
  const duration = useAnimationStore((s) => s.duration)
  const speed = useAnimationStore((s) => s.speed)
  const cinematic = useAnimationStore((s) => s.cinematic)
  const pieceCount = useAnimationStore((s) => s.pieceCount)
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

  return (
    <div className={`pointer-events-none absolute inset-x-0 z-40 flex flex-col items-center px-3 ${liftClassName}`}>
      <div
        className="dark corner-smooth pointer-events-auto flex max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border border-border bg-background/90 text-foreground shadow-elevation-5 backdrop-blur-xl"
        data-animations-tab={open ? 'open' : 'closed'}
      >
        {open && (
          <div className="flex flex-col gap-2.5 p-2.5 pb-1">
            <div className="flex items-center justify-between px-1">
              <span className="font-medium text-[11px] text-muted-foreground uppercase tracking-[0.12em]">Build animations</span>
              {pieceCount > 0 && <span className="font-mono text-[10px] text-muted-foreground">{pieceCount} pieces</span>}
            </div>
            <div className="anim-strip flex gap-2 overflow-x-auto pb-1">
              {TEMPLATES.map((t) => (
                <TemplateCard active={t.id === template} key={t.id} onPick={() => ready && store.select(t.id)} template={t} />
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-1 p-1.5">
          <button
            aria-expanded={open}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 font-medium text-sm transition-colors hover:bg-accent"
            onClick={() => setOpen((v) => !v)}
            type="button"
          >
            <Sparkles className="size-4" style={{ color: active.accent }} />
            Animations
            <ChevronDown className={`size-3.5 transition-transform ${open ? '' : 'rotate-180'}`} />
          </button>

          <span className="mx-0.5 h-5 w-px bg-border" />

          {status === 'playing' ? (
            <IconButton label="Pause" onClick={store.pause}><Pause className="size-4" /></IconButton>
          ) : (
            <IconButton disabled={!ready} label={status === 'paused' ? 'Resume' : `Play ${active.name}`} onClick={store.play}>
              <Play className="size-4" />
            </IconButton>
          )}
          <IconButton disabled={!ready} label="Replay" onClick={store.replay}><RotateCcw className="size-4" /></IconButton>
          {(open || running) && (
            <IconButton disabled={!running} label="Stop and show the finished house" onClick={store.stop}>
              <Square className="size-3.5" />
            </IconButton>
          )}

          {(open || running) && (
            <>
              <label className="flex w-36 items-center gap-2 px-1 sm:w-52">
                <span className="sr-only">Timeline</span>
                <input
                  aria-label="Timeline"
                  className="anim-scrub h-1 w-full cursor-pointer"
                  disabled={!ready}
                  max={1000}
                  min={0}
                  onChange={(event) => {
                    const d = duration || 1
                    store.seek((Number(event.target.value) / 1000) * d)
                  }}
                  style={{ ['--anim-accent' as string]: active.accent, ['--anim-progress' as string]: `${progress * 100}%` }}
                  type="range"
                  value={Math.round(progress * 1000)}
                />
              </label>
              <span className="hidden shrink-0 whitespace-nowrap text-right font-mono text-[11px] text-muted-foreground tabular-nums sm:inline">
                {formatTime(time)} / {formatTime(duration)}
              </span>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}

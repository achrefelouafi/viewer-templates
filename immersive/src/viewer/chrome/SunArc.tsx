import { type SkyPhase, type TimeOfDay, useViewer } from '@pascal-app/viewer'
import { type KeyboardEvent, type PointerEvent, useId, useRef } from 'react'
import { formatClockMinutes, TIME_PRESETS } from './skyState'

const W = 280
const H = 132
const CX = W / 2
const CY = 98
const RX = 110
const RY_DAY = 74
const RY_NIGHT = 24
const SNAP_MIN = 5

const SKY_GRADIENTS: Record<SkyPhase, readonly [string, string, string]> = {
  night: ['#070b18', '#111a33', '#1c2642'],
  blue: ['#1b254a', '#5b5d8a', '#c98d9c'],
  golden: ['#3c4b74', '#9e7d8f', '#ebb37e'],
  morning: ['#4e7eb5', '#9ec2e2', '#e4ecf2'],
  midday: ['#4682c4', '#97c2e8', '#dfebf5'],
  afternoon: ['#5682b5', '#a9c1da', '#ebe1d3'],
}

function arcPoint(minutes: number, sunrise: number, sunset: number): { x: number; y: number; day: boolean } {
  const dayLen = Math.max(60, sunset - sunrise)
  if (minutes >= sunrise && minutes <= sunset) {
    const angle = Math.PI * (1 - (minutes - sunrise) / dayLen)
    return { x: CX + RX * Math.cos(angle), y: CY - RY_DAY * Math.sin(angle), day: true }
  }
  const nightLen = Math.max(60, 1440 - dayLen)
  const since = (minutes < sunrise ? minutes + 1440 : minutes) - sunset
  const angle = Math.PI * (since / nightLen)
  return { x: CX + RX * Math.cos(angle), y: CY + RY_NIGHT * Math.sin(angle), day: false }
}

function pointerToMinutes(x: number, y: number, sunrise: number, sunset: number): number {
  const dayLen = Math.max(60, sunset - sunrise)
  const nightLen = Math.max(60, 1440 - dayLen)
  const ny = y <= CY ? (CY - y) / RY_DAY : (CY - y) / RY_NIGHT
  const nx = (x - CX) / RX
  const angle = Math.atan2(ny, nx)
  const raw =
    angle >= 0
      ? sunrise + (1 - angle / Math.PI) * dayLen
      : sunset + (-angle / Math.PI) * nightLen
  const snapped = Math.round(raw / SNAP_MIN) * SNAP_MIN
  return ((snapped % 1440) + 1440) % 1440
}

/** Tiny live sun-on-arc glyph for the CommandBar's Light trigger button. */
export function MiniSunGlyph({
  minutes,
  sunrise,
  sunset,
}: {
  minutes: number
  sunrise: number
  sunset: number
}) {
  const dayLen = Math.max(60, sunset - sunrise)
  const isDay = minutes >= sunrise && minutes <= sunset
  const t = isDay ? (minutes - sunrise) / dayLen : 0.5
  const angle = Math.PI * (1 - t)
  const sx = 9 + 6.5 * Math.cos(angle)
  const sy = isDay ? 11 - 6.5 * Math.sin(angle) : 11.5

  return (
    <svg aria-hidden="true" className="h-3.5 w-[18px] shrink-0 overflow-visible" viewBox="0 0 18 14">
      <path
        d="M2.5 11 A6.5 6.5 0 0 1 15.5 11"
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.35}
        strokeWidth="1.2"
      />
      <line stroke="currentColor" strokeOpacity={0.22} strokeWidth="1" x1="1" x2="17" y1="11" y2="11" />
      {isDay ? (
        <circle cx={sx} cy={sy} fill="currentColor" r="2.2" />
      ) : (
        <path
          d="M10.8 4.4 A2.6 2.6 0 1 0 10.8 8.8 A2 2 0 1 1 10.8 4.4 Z"
          fill="currentColor"
        />
      )}
    </svg>
  )
}

/**
 * Interactive half-circle solar arc: sunrise left, sunset right, dynamic atmospheric sky gradient,
 * clickable preset dots directly on the arc, draggable sun/moon knob, and full keyboard slider
 * support (`role="slider"`).
 */
export function SunArc({
  minutes,
  clock,
  phase,
  sunrise,
  sunset,
  presets,
  activePreset,
}: {
  minutes: number
  clock: number
  phase: SkyPhase
  sunrise: number
  sunset: number
  presets: Record<TimeOfDay, number>
  activePreset: TimeOfDay | null
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const gradId = useId().replaceAll(':', '')
  const [top, mid, horizon] = SKY_GRADIENTS[phase]
  const knob = arcPoint(minutes, sunrise, sunset)
  const isNight = phase === 'night' || phase === 'blue'

  const setMinutes = (next: number) => {
    const viewer = useViewer.getState()
    if (viewer.skyLive) viewer.setSkyLive(false)
    viewer.setTimeOfDayMinutes(((next % 1440) + 1440) % 1440)
  }

  const updateFromPointer = (event: PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return
    const x = ((event.clientX - rect.left) / rect.width) * W
    const y = ((event.clientY - rect.top) / rect.height) * H
    setMinutes(pointerToMinutes(x, y, sunrise, sunset))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = {
      ArrowRight: 15,
      ArrowUp: 15,
      ArrowLeft: -15,
      ArrowDown: -15,
      PageUp: 60,
      PageDown: -60,
    }
    if (event.key === 'Home') {
      event.preventDefault()
      setMinutes(sunrise)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      setMinutes(sunset)
      return
    }
    const delta = steps[event.key]
    if (!delta) return
    event.preventDefault()
    setMinutes(minutes + delta)
  }

  return (
    <div
      aria-label="Time of day"
      aria-valuemax={1435}
      aria-valuemin={0}
      aria-valuenow={Math.round(minutes)}
      aria-valuetext={formatClockMinutes(clock)}
      className="relative overflow-hidden rounded-[16px] border border-foreground/12 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onKeyDown={onKeyDown}
      role="slider"
      tabIndex={0}
    >
      <svg
        className="block h-[132px] w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={(event) => {
          if ((event.target as Element).closest('[data-arc-preset]')) return
          event.currentTarget.setPointerCapture(event.pointerId)
          updateFromPointer(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            updateFromPointer(event)
          }
        }}
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
      >
        <defs>
          <linearGradient id={`sky-${gradId}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={top} />
            <stop offset="56%" stopColor={mid} />
            <stop offset="75%" stopColor={horizon} />
            <stop offset="76%" stopColor={isNight ? '#0a0d16' : '#6b707d'} stopOpacity="0.88" />
            <stop offset="100%" stopColor={isNight ? '#06080f' : '#4a4e5a'} stopOpacity="0.92" />
          </linearGradient>
          <radialGradient id={`sun-glow-${gradId}`}>
            <stop offset="0%" stopColor={knob.day ? '#ffe599' : '#d8e4ff'} stopOpacity="0.72" />
            <stop offset="100%" stopColor={knob.day ? '#ffe599' : '#d8e4ff'} stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect fill={`url(#sky-${gradId})`} height={H} width={W} />

        {/* Subtle nocturnal starfield when dusk/night settles in. */}
        {isNight ? (
          <g fill="#ffffff" fillOpacity={phase === 'night' ? 0.55 : 0.25}>
            <circle cx="44" cy="24" r="0.9" />
            <circle cx="96" cy="18" r="0.7" />
            <circle cx="172" cy="15" r="1" />
            <circle cx="228" cy="28" r="0.8" />
            <circle cx="252" cy="46" r="0.7" />
          </g>
        ) : null}

        {/* Horizon line */}
        <line stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1" x1="12" x2={W - 12} y1={CY} y2={CY} />

        {/* Day half-circle arc + subtle night return path */}
        <path
          d={`M ${CX - RX} ${CY} A ${RX} ${RY_DAY} 0 0 1 ${CX + RX} ${CY}`}
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.52"
          strokeWidth="1.25"
        />
        <path
          d={`M ${CX + RX} ${CY} A ${RX} ${RY_NIGHT} 0 0 1 ${CX - RX} ${CY}`}
          fill="none"
          stroke="#ffffff"
          strokeDasharray="2 4"
          strokeOpacity="0.28"
          strokeWidth="1"
        />

        {/* Clickable preset dots placed at each preset's real solar angle */}
        {TIME_PRESETS.map(({ id, label }) => {
          const p = arcPoint(presets[id], sunrise, sunset)
          const isActive = activePreset === id
          return (
            <g
              className="cursor-pointer"
              data-arc-preset={id}
              key={id}
              onClick={(event) => {
                event.stopPropagation()
                useViewer.getState().setTimeOfDay(id)
              }}
            >
              <title>{`${label} · ${formatClockMinutes(presets[id])}`}</title>
              <circle cx={p.x} cy={p.y} fill="transparent" r="10" />
              <circle
                cx={p.x}
                cy={p.y}
                fill={isActive ? '#ffffff' : '#ffffff'}
                fillOpacity={isActive ? 1 : 0.6}
                r={isActive ? 3.5 : 2.5}
                stroke="#0b0d12"
                strokeOpacity="0.35"
                strokeWidth="1"
              />
            </g>
          )
        })}

        {/* Draggable sun / moon knob */}
        <circle cx={knob.x} cy={knob.y} fill={`url(#sun-glow-${gradId})`} r="19" />
        <circle
          cx={knob.x}
          cy={knob.y}
          fill={knob.day ? '#ffd978' : '#dde7ff'}
          r="7"
          stroke="#ffffff"
          strokeWidth="2"
        />
      </svg>

      {/* Sunrise & sunset horizon captions */}
      <div className="pointer-events-none absolute inset-x-3 bottom-1.5 flex items-center justify-between font-mono text-[9px] text-white/80 tabular-nums drop-shadow">
        <span>Rise {formatClockMinutes(sunrise)}</span>
        <span>Set {formatClockMinutes(sunset)}</span>
      </div>
    </div>
  )
}

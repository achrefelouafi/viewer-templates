import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ALARM_LABEL,
  ALERT,
  alarmColor,
  binaryLabel,
  openness,
  TOGGLE_DOMAINS,
  tripped,
  climateColor,
  describeCall,
  domainOf,
  FIELDS,
  fieldColor,
  fieldOf,
  isOn,
  kelvinColor,
  lightColor,
  nameOf,
  statusOf,
  type Area,
  type FieldKind,
  type HassEntities,
  type HassEntity,
  type HomeDevice,
  type ServiceCall,
} from './entities'
import { ClimateEntityFeature, supportsFeature } from './controls/climate'
import { MoreInfoClimate } from './controls/MoreInfoClimate'
import { type EntityFormatters, useEntityFormatters } from './hass/names'
import type { PinRefs } from './HomeEffects'

/* The Home panel: pins riding on the model, the device list by room, the selected device's card with
   Home Assistant's own controls for its domain, and the floor-field picker. Every control is a
   Home Assistant service call, shown at the foot of the card. */

type Call = (domain: string, service: string, data: ServiceCall['data']) => Promise<boolean> | void

const Svg = ({ children, className = 'size-4' }: { children: ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)
function Icon({ e, className }: { e: HassEntity; className?: string }) {
  const dc = e.attributes.device_class
  const I = (d: string) => <Svg className={className}><path d={d} /></Svg>
  switch (domainOf(e.entity_id)) {
    case 'humidifier': return I('M12 3s5 5.5 5 9.5a5 5 0 0 1-10 0C7 8.5 12 3 12 3zM9.5 13.5a2.5 2.5 0 0 0 2.5 2.5')
    case 'person': return I('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 21a7.5 7.5 0 0 1 15 0')
    case 'device_tracker': return I('M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM11 18.5h2')
    case 'remote': return I('M9 2.5h6a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 20V4A1.5 1.5 0 0 1 9 2.5zM12 6.5h.01M10 11h4M10 14h4')
    case 'infrared': return I('M4 12h3M17 12h3M7.5 7.5 9.6 9.6M16.5 7.5l-2.1 2.1M7.5 16.5l2.1-2.1M16.5 16.5l-2.1-2.1M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z')
    case 'radio_frequency': return I('M12 13v8M12 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM8 7.5a5.5 5.5 0 0 0 0 8M16 7.5a5.5 5.5 0 0 1 0 8M5 4.5a9.5 9.5 0 0 0 0 14M19 4.5a9.5 9.5 0 0 1 0 14')
    case 'event': return I('M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0')
    case 'weather': return I('M7 18a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.6-1.5A4.5 4.5 0 0 1 17 18zM9 21l-1 1.5M13 21l-1 1.5M17 21l-1 1.5')
    case 'scene': return I('M4 20 14 10M14 4v2M14 14v2M10 8H8M20 8h-2M17 5l-1.4 1.4M17 11l-1.4-1.4')
    case 'button': return I('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z')
    case 'number': return I('M5 9h14M5 15h14M10 4 8 20M16 4l-2 16')
    case 'select': return I('M4 6h16M4 12h16M4 18h10M17 16l2 2 2-2')
    case 'text': return I('M4 6h16M12 6v13M9 19h6')
    case 'date':
    case 'datetime': return I('M4 5h16v15H4zM4 9h16M8 3v4M16 3v4')
    case 'time': return I('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2')
    case 'update': return I('M12 3v12M7 10l5 5 5-5M4 20h16')
    case 'notify': return I('M4 5h16v11H8l-4 4zM8 9h8M8 12h5')
    case 'calendar': return I('M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M8 13h3v3H8z')
    case 'todo': return I('M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2')
    case 'timer_list': return I('M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2 2M10 2h4')
    case 'conversation': return I('M4 5h16v11H9l-5 4zM8 10h.01M12 10h.01M16 10h.01')
    case 'tts': return I('M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11')
    case 'stt': return I('M9 3h6v11H9zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8 21h8')
    case 'wake_word': return I('M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM19 4l1.5-1.5M5 4 3.5 2.5M20 9h2M2 9h2')
    case 'ai_task': return I('M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4zM18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z')
    case 'image': return I('M4 5h16v14H4zM4 15l5-5 5 5 2-2 4 4M15 9h.01')
    case 'image_processing': return I('M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M12 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 17a4 4 0 0 1 8 0')
    case 'geo_location': return I('M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z')
    case 'air_quality': return I('M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7')
    case 'cover': return <Svg className={className}><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M4 8h16M4 12h16M4 16h16" /></Svg>
    case 'valve': return <Svg className={className}><path d="M3 14h6M15 14h6M9 10v8h6v-8zM12 10V5M8 5h8" /></Svg>
    case 'lock': return <Svg className={className}><rect x="5" y="11" width="14" height="10" rx="2" /><path d={e.state === 'locked' ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.5-2'} /></Svg>
    case 'siren': return <Svg className={className}><path d="M7 18v-6a5 5 0 0 1 10 0v6M5 21h14M12 3v2M4.5 6.5l1.4 1.4M19.5 6.5l-1.4 1.4" /></Svg>
    case 'alarm_control_panel': return <Svg className={className}><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" /></Svg>
    case 'media_player': return dc === 'tv'
      ? <Svg className={className}><rect x="2.5" y="5" width="19" height="12" rx="1.5" /><path d="M8 21h8M12 17v4" /></Svg>
      : <Svg className={className}><rect x="6" y="2.5" width="12" height="19" rx="2" /><circle cx="12" cy="14" r="3.5" /><circle cx="12" cy="6.5" r="1" /></Svg>
    case 'camera': return <Svg className={className}><path d="M3 8h12v8H3zM15 11l6-3v8l-6-3" /></Svg>
    case 'vacuum': return <Svg className={className}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.5" /></Svg>
    case 'lawn_mower': return <Svg className={className}><path d="M3 17h13l3-7h2M5 17v-4h10M7 20a1.5 1.5 0 1 0 0-.01M15 20a1.5 1.5 0 1 0 0-.01" /></Svg>
    case 'switch': return <Svg className={className}><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M10 9v3M14 9v3M9 16h6" /></Svg>
    case 'water_heater': return <Svg className={className}><rect x="6" y="2.5" width="12" height="19" rx="3" /><path d="M12 8c-2 2.5-2 4 0 5.5 2-1.5 2-3 0-5.5" /></Svg>
    case 'assist_satellite': return <Svg className={className}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></Svg>
    case 'binary_sensor': {
      if (dc === 'smoke' || dc === 'gas' || dc === 'carbon_monoxide') return <Svg className={className}><circle cx="12" cy="7" r="4" /><path d="M7 15c1-1 2-1 3 0s2 1 3 0 2-1 3 0M7 19c1-1 2-1 3 0s2 1 3 0 2-1 3 0" /></Svg>
      if (dc === 'moisture') return <Svg className={className}><path d="M12 3s5 5.5 5 9.5a5 5 0 0 1-10 0C7 8.5 12 3 12 3zM4 20h16" /></Svg>
      if (dc === 'motion' || dc === 'occupancy' || dc === 'presence') return <Svg className={className}><circle cx="13" cy="4.5" r="1.8" /><path d="M10 21l2-6 3 3v3M8 11l3-3.5 3 2 3 1M12 8.5l-1 5" /></Svg>
      if (dc === 'connectivity') return <Svg className={className}><path d="M2.5 9a14 14 0 0 1 19 0M5.8 12.6a9 9 0 0 1 12.4 0M9 16a4.5 4.5 0 0 1 6 0M12 19.5h.01" /></Svg>
      return <Svg className={className}><path d="M5 21V4h10v17M15 5l4 1v15M11 12h.01M3 21h18" /></Svg>
    }
    case 'light': return <Svg className={className}><path d="M12 2v5M5 13a7 7 0 0 1 14 0zM10 17a2 2 0 0 0 4 0" /></Svg>
    case 'fan': return <Svg className={className}><circle cx="12" cy="12" r="1.6" /><path d="M12 10.4C9 7 10 3 13 3s3.5 4-1 7.4M13.6 12c3.4-3 7.4-2 7.4 1s-4 3.5-7.4-1M12 13.6c3 3.4 2 7.4-1 7.4s-3.5-4 1-7.4M10.4 12C7 15 3 14 3 11s4-3.5 7.4 1" /></Svg>
    case 'climate': return <Svg className={className}><rect x="2.5" y="4" width="19" height="9" rx="2" /><path d="M6 10h12M7 16.5c0 1.5-1.5 1.5-1.5 3M12 16.5c0 1.5-1.5 1.5-1.5 3M17 16.5c0 1.5-1.5 1.5-1.5 3" /></Svg>
    default: {
      const k = fieldOf(e)
      if (k === 'humidity') return <Svg className={className}><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" /></Svg>
      if (k === 'carbon_dioxide' || k === 'pm25') return <Svg className={className}><path d="M4 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M5 17h5" /></Svg>
      return <Svg className={className}><path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0zM12 9v8" /></Svg>
    }
  }
}
const Power = () => <Svg><path d="M12 3v9M6.3 7.3a8 8 0 1 0 11.4 0" /></Svg>

/** The colour a device shows on its pin and icon while it is on. */
function accent(e: HassEntity) {
  switch (domainOf(e.entity_id)) {
    case 'light': return lightColor(e)
    case 'climate': return climateColor(e)
    case 'fan': return '#9fe8ff'
    case 'lock': return e.state === 'locked' ? ALERT.ok : e.state === 'jammed' ? ALERT.danger : ALERT.warn
    case 'alarm_control_panel': return alarmColor(e.state)
    case 'siren': return ALERT.danger
    case 'binary_sensor': {
      const dc = String(e.attributes.device_class)
      if (dc === 'connectivity') return tripped(e) ? '#5ce1c6' : ALERT.danger
      if (!tripped(e)) return ALERT.ok
      return dc === 'moisture' ? ALERT.water : dc === 'motion' || dc === 'door' || dc === 'window' ? ALERT.warn : ALERT.danger
    }
    case 'camera': return e.state === 'recording' ? ALERT.danger : ALERT.info
    case 'media_player': return ((e.attributes._art as string[] | undefined) ?? ['#8a9cff'])[0]!
    case 'valve':
    case 'cover': return ALERT.info
    case 'water_heater': return '#ff8a3d'
    case 'switch': return '#ffc247'
    case 'vacuum': return '#7fd3ff'
    case 'lawn_mower': return '#9be36b'
    case 'assist_satellite': return e.state === 'idle' ? '#dfe7ef' : ALERT.info
    case 'humidifier': return '#7cc8ff'
    case 'person':
    case 'device_tracker': return String(e.attributes._color ?? '#ff8a5c')
    case 'remote': return '#ffd166'
    case 'infrared': return '#ff5d8f'
    case 'radio_frequency': return '#b48cff'
    case 'event': return '#ffd166'
    default: {
      const k = fieldOf(e)
      return k ? fieldColor(k, Number(e.state)) : '#9aa3ad'
    }
  }
}
const toggles = (e: HassEntity) => {
  const d = domainOf(e.entity_id)
  if (d === 'climate') {
    return (
      supportsFeature(e, ClimateEntityFeature.TURN_ON) ||
      supportsFeature(e, ClimateEntityFeature.TURN_OFF)
    )
  }
  return TOGGLE_DOMAINS.includes(d)
}
/** Whether the pin and icon show the device's colour: on, open, working, or (sensors) always. */
function lit(e: HassEntity) {
  switch (domainOf(e.entity_id)) {
    case 'sensor':
    case 'binary_sensor':
    case 'lock':
    case 'alarm_control_panel': return true
    case 'cover':
    case 'valve': return openness(e) > 0
    case 'vacuum':
    case 'lawn_mower': return e.state !== 'docked' && e.state !== 'idle'
    case 'water_heater': return e.state !== 'off'
    case 'assist_satellite': return e.state !== 'idle'
    case 'camera': return e.state !== 'off'
    case 'person':
    case 'device_tracker': return e.state === 'home'
    case 'infrared':
    case 'radio_frequency':
    case 'event': return true
    default: return isOn(e)
  }
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onChange}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? 'bg-foreground' : 'bg-foreground/20'}`}>
      <i className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  )
}

function Seg<T extends string | number>({ label, value, options, onPick }: { label: string; value: T; options: { v: T; t: string; c?: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex gap-1 rounded-full bg-foreground/5 p-1" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.v)} type="button" role="radio" aria-checked={o.v === value} onClick={() => onPick(o.v)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1 text-xs transition-colors ${o.v === value ? 'bg-background font-medium shadow' : 'text-muted-foreground hover:text-foreground'}`}>
            {o.c && <i className="size-2 rounded-full" style={{ background: o.c }} />}
            {o.t}
          </button>
        ))}
      </div>
    </div>
  )
}

/** A slider that fills in the text colour (white on dark); `color` is kept for callers but no longer tints it. */
function Range({ label, value, min, max, step, disabled, onCommit, format }: {
  label: string; value: number; min: number; max: number; step: number; color?: string; disabled?: boolean; onCommit: (v: number) => void; format: (v: number) => string
}) {
  // drag freely, call the service on release, as Home Assistant's own sliders do
  const [v, setV] = useState(value)
  const dragging = useRef(false)
  useEffect(() => {
    if (!dragging.current) setV(value)
  }, [value])
  const commit = () => {
    dragging.current = false
    if (v !== value) onCommit(v)
  }
  return (
    <label className="grid gap-1.5">
      <span className="flex justify-between text-muted-foreground text-xs">{label}<b className="font-medium text-foreground">{format(v)}</b></span>
      <input type="range" min={min} max={max} step={step} value={v} disabled={disabled} aria-label={label}
        className="h-2 w-full cursor-pointer appearance-none rounded-full text-foreground accent-foreground disabled:opacity-40 [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md"
        style={{ background: `linear-gradient(90deg, currentColor ${((v - min) / (max - min)) * 100}%, color-mix(in oklab, currentColor 14%, transparent) 0)` }}
        onChange={(ev) => { dragging.current = true; setV(Number(ev.target.value)) }}
        onPointerUp={commit} onKeyUp={commit} onBlur={() => dragging.current && commit()} />
    </label>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid gap-0.5 rounded-xl bg-foreground/5 px-3 py-2">
      <span className="text-muted-foreground text-xs">{k}</span>
      <b className="font-medium font-mono text-sm">{v}</b>
    </div>
  )
}

function Spark({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null
  const lo = Math.min(...data)
  const hi = Math.max(...data)
  const pad = (hi - lo) * 0.15 || 0.15
  const pts = data.map((v, i) => [(i / (data.length - 1)) * 260, 56 - ((v - lo + pad) / (hi - lo + pad * 2)) * 50] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')
  return (
    <svg className="h-16 w-full" viewBox="0 0 260 60" preserveAspectRatio="none" role="img" aria-label="Reading over the last minute">
      <path d={`${line}L260 60L0 60Z`} fill={color} opacity="0.16" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** A row of pill buttons, the pressed one filled. */
function Actions({ items }: { items: { t: string; on?: boolean; go: () => void }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((b) => (
        <button key={b.t} type="button" aria-pressed={!!b.on} onClick={b.go}
          className={`flex-1 rounded-full px-3 py-1.5 text-sm transition-colors ${b.on ? 'bg-foreground text-background' : 'bg-foreground/5 hover:bg-foreground/10'}`}>
          {b.t}
        </button>
      ))}
    </div>
  )
}

/** A device's state, large and in its colour. */
function BigState({ color, text, sub }: { color: string; text: string; sub?: string }) {
  return (
    <div className="grid gap-0.5">
      <b className="font-semibold text-2xl" data-tone={color}>{text}</b>
      {sub && <span className="text-muted-foreground text-xs">{sub}</span>}
    </div>
  )
}

/** A dashed box for the lab's stand-ins for the world (people moving, a bell rung, the weather). */
function LabOnly({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 rounded-xl border border-dashed border-border p-2.5">
      <span className="text-muted-foreground text-xs">Lab only: {label.charAt(0).toLowerCase() + label.slice(1)}</span>
      {children}
    </div>
  )
}

/** A one-line input and its button: messages, to-do items, dates, Assist. */
function Send({ placeholder, initial = '', button, type = 'text', clear = false, onSend }: { placeholder?: string; initial?: string; button: string; type?: string; clear?: boolean; onSend: (v: string) => void }) {
  const [v, setV] = useState(initial)
  useEffect(() => setV(initial), [initial])
  return (
    <form className="flex gap-1.5" onSubmit={(ev) => {
      ev.preventDefault()
      if (!v.trim()) return
      onSend(v.trim())
      if (clear) setV('')
    }}>
      <input type={type} value={v} placeholder={placeholder} aria-label={placeholder ?? button} onChange={(ev) => setV(ev.target.value)}
        className="min-w-0 flex-1 rounded-full border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-foreground/40" />
      <button type="submit" className="rounded-full bg-foreground px-3 py-1.5 font-medium text-background text-sm">{button}</button>
    </form>
  )
}

/** A stand-in camera still for image entities: a porch, drawn from the snapshot's seed. */
function Snapshot({ seed, caption }: { seed: number; caption: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const g = ref.current?.getContext('2d')
    if (!g) return
    const W = 320
    const H = 180
    const sky = g.createLinearGradient(0, 0, 0, H)
    sky.addColorStop(0, '#2b3a52')
    sky.addColorStop(1, '#5b6b7e')
    g.fillStyle = sky
    g.fillRect(0, 0, W, H)
    g.fillStyle = '#3a3530'
    g.fillRect(110, 30, 100, 150)
    g.fillStyle = '#6b4a2f'
    g.fillRect(125, 45, 70, 135)
    g.fillStyle = '#7c8a6b'
    g.fillRect(0, 150, W, 30)
    if (caption.startsWith('Someone')) {
      // a visitor, somewhere on the porch
      const x = 70 + seed * 180
      g.fillStyle = '#d9a98a'
      g.beginPath()
      g.arc(x, 78, 14, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#c0533b'
      g.fillRect(x - 18, 94, 36, 60)
    }
    g.fillStyle = 'rgba(255,255,255,.85)'
    g.font = '11px ui-monospace, monospace'
    g.fillText(new Date().toLocaleTimeString(), 8, 16)
  }, [seed, caption])
  return <canvas ref={ref} width={320} height={180} className="w-full rounded-xl" aria-label={caption} />
}

/** How the Home tab groups the entities that are not a thing in a room. */
const HOME_GROUPS = [
  ['Weather and outside', ['weather', 'air_quality', 'geo_location']],
  ['Scenes and actions', ['scene', 'button']],
  ['Family', ['calendar', 'todo', 'timer_list', 'notify', 'sensor', 'binary_sensor']],
  ['Assist', ['conversation', 'tts', 'stt', 'wake_word', 'ai_task']],
  ['Settings', ['number', 'select', 'text', 'date', 'time', 'datetime']],
  ['Cameras and images', ['image', 'image_processing']],
  ['Updates', ['update']],
] as const

const CMD: Record<string, string> = { power: 'Power', volume_down: 'Vol −', volume_up: 'Vol +', next: 'Next', cooler: 'Cooler', warmer: 'Warmer', open: 'Open', close: 'Close' }

function simulateLabel(dc: string, on: boolean) {
  switch (dc) {
    case 'smoke': return on ? 'Clear the smoke' : 'Fill the room with smoke'
    case 'moisture': return on ? 'Mop it up' : 'Spring a leak'
    case 'motion': return on ? 'Everyone leaves' : 'Walk past'
    case 'door':
    case 'window': return on ? 'Close it' : 'Open it'
    case 'connectivity': return on ? 'Cut the internet' : 'Reconnect'
    default: return on ? 'Turn off' : 'Turn on'
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function Controls({ e, call, formatters, history, layer, onLayer, areas }: { e: HassEntity; call: Call; formatters: EntityFormatters; history: number[]; layer: FieldKind | null; onLayer: (k: FieldKind | null) => void; areas: Area[] }) {
  const id = e.entity_id
  const a = e.attributes
  switch (domainOf(id)) {
    case 'light': {
      const modes = (a.supported_color_modes as string[] | undefined) ?? []
      const rgb = a.rgb_color as [number, number, number] | undefined
      return (
        <>
          <Range label="Brightness" value={Math.max(1, Math.round((Number(a.brightness ?? 255) / 255) * 100))} min={1} max={100} step={1}
            color={lightColor(e)} onCommit={(v) => call('light', 'turn_on', { entity_id: id, brightness_pct: v })} format={(v) => `${v}%`} />
          {modes.includes('color_temp') && (
            <Seg<number> label="White" value={a.color_mode === 'color_temp' ? Number(a.color_temp_kelvin) : 0}
              onPick={(k) => call('light', 'turn_on', { entity_id: id, color_temp_kelvin: k })}
              options={[2700, 4000, 6500].map((k) => ({ v: k, t: k === 2700 ? 'Warm' : k === 4000 ? 'Neutral' : 'Cool', c: kelvinColor(k) }))} />
          )}
          {modes.includes('rgb') && (
            <div className="grid gap-1.5">
              <span className="text-muted-foreground text-xs">Colour</span>
              <div className="flex gap-2">
                {([[255, 80, 80], [255, 170, 60], [255, 230, 90], [90, 230, 140], [70, 190, 255], [150, 110, 255], [255, 110, 200]] as [number, number, number][]).map((c) => {
                  const on = a.color_mode === 'rgb' && rgb?.join() === c.join()
                  return <button key={c.join()} type="button" aria-label={`Colour ${c.join(', ')}`} aria-pressed={on}
                    className={`size-7 rounded-full ring-offset-2 ring-offset-background ${on ? 'ring-2 ring-foreground' : ''}`} style={{ background: `rgb(${c})` }}
                    onClick={() => call('light', 'turn_on', { entity_id: id, rgb_color: c })} />
                })}
              </div>
            </div>
          )}
        </>
      )
    }
    case 'climate':
      return <MoreInfoClimate entity={e} call={call} formatters={formatters} />
    case 'fan': {
      const pct = Number(a.percentage ?? 0)
      return (
        <>
          <Range label="Speed" value={pct} min={0} max={100} step={Number(a.percentage_step ?? 1)} color="#9fe8ff"
            onCommit={(v) => call('fan', 'set_percentage', { entity_id: id, percentage: v })} format={(v) => (v ? `${Math.round(v)}%` : 'Off')} />
          <div className="flex items-center justify-between">
            <span className="text-sm">Oscillate</span>
            <Switch on={!!a.oscillating} label="Oscillate" onChange={() => call('fan', 'oscillate', { entity_id: id, oscillating: !a.oscillating })} />
          </div>
          {a.direction !== undefined && (
            <Seg<string> label="Direction" value={String(a.direction)} onPick={(d) => call('fan', 'set_direction', { entity_id: id, direction: d })}
              options={[{ v: 'forward', t: 'Down (summer)' }, { v: 'reverse', t: 'Up (winter)' }]} />
          )}
        </>
      )
    }
    case 'cover':
    case 'valve': {
      const d = domainOf(id)
      const pos = Number(a.current_position ?? (e.state === 'open' ? 100 : 0))
      return (
        <>
          <Actions items={[
            { t: 'Open', on: e.state === 'opening', go: () => call(d, `open_${d}`, { entity_id: id }) },
            { t: 'Stop', go: () => call(d, `stop_${d}`, { entity_id: id }) },
            { t: 'Close', on: e.state === 'closing', go: () => call(d, `close_${d}`, { entity_id: id }) },
          ]} />
          <Range label="Position" value={pos} min={0} max={100} step={1} color={ALERT.info}
            onCommit={(v) => call(d, `set_${d}_position`, { entity_id: id, position: v })} format={(v) => (v === 0 ? 'Closed' : v === 100 ? 'Open' : `${Math.round(v)}%`)} />
        </>
      )
    }
    case 'lock': {
      const locked = e.state === 'locked'
      return (
        <>
          <BigState color={accent(e)} text={cap(e.state)} sub={e.state.endsWith('ing') ? 'The lock is turning' : locked ? 'The door is secured' : 'Anyone can open the door'} />
          <Actions items={[
            { t: 'Lock', on: locked, go: () => call('lock', 'lock', { entity_id: id }) },
            { t: 'Unlock', on: e.state === 'unlocked', go: () => call('lock', 'unlock', { entity_id: id }) },
            { t: 'Open door', on: e.state === 'open', go: () => call('lock', 'open', { entity_id: id }) },
          ]} />
        </>
      )
    }
    case 'binary_sensor': {
      const on = tripped(e)
      return (
        <>
          <BigState color={accent(e)} text={binaryLabel(e)} sub={e.last_changed ? `Since ${new Date(e.last_changed).toLocaleTimeString()}` : 'No change yet'} />
          {/* a real home's sensors change on their own; in the lab a button stands in for the world */}
          <div className="grid gap-1.5 rounded-xl border border-dashed border-border p-2.5">
            <span className="text-muted-foreground text-xs">Lab only: what the world would do</span>
            <button type="button" onClick={() => call('lab', 'simulate', { entity_id: id, state: on ? 'off' : 'on' })}
              className="rounded-full bg-foreground/5 px-3 py-1.5 text-sm hover:bg-foreground/10">
              {simulateLabel(String(a.device_class), on)}
            </button>
          </div>
        </>
      )
    }
    case 'siren': return (
      <Seg<string> label="Tone" value={String(a.tone)} onPick={(tone) => call('siren', 'turn_on', { entity_id: id, tone })}
        options={((a.available_tones as string[]) ?? ['alarm']).map((t) => ({ v: t, t: cap(t) }))} />
    )
    case 'alarm_control_panel': return (
      <>
        <BigState color={alarmColor(e.state)} text={ALARM_LABEL[e.state] ?? e.state} sub={e.state === 'pending' ? 'Disarm before the delay runs out' : e.state.startsWith('armed') ? 'Motion or an opened door will set it off' : ''} />
        <Actions items={[
          { t: 'Disarm', on: e.state === 'disarmed', go: () => call('alarm_control_panel', 'alarm_disarm', { entity_id: id }) },
          { t: 'Home', on: e.state === 'armed_home', go: () => call('alarm_control_panel', 'alarm_arm_home', { entity_id: id }) },
          { t: 'Away', on: e.state === 'armed_away', go: () => call('alarm_control_panel', 'alarm_arm_away', { entity_id: id }) },
          { t: 'Night', on: e.state === 'armed_night', go: () => call('alarm_control_panel', 'alarm_arm_night', { entity_id: id }) },
        ]} />
        <button type="button" onClick={() => call('alarm_control_panel', 'alarm_trigger', { entity_id: id })} className="rounded-full border border-red-500/40 px-3 py-1.5 text-red-500 text-sm hover:bg-red-500/10">Panic</button>
      </>
    )
    case 'media_player': {
      const vol = Math.round(Number(a.volume_level ?? 0) * 100)
      return (
        <>
          {e.state !== 'off' && (
            <div className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: `linear-gradient(120deg, ${((a._art as string[]) ?? ['#555', '#333']).join(', ')})` }}>
              <span className="grid min-w-0 flex-1 text-white">
                <b className="truncate font-semibold">{String(a.media_title ?? 'Nothing playing')}</b>
                <small className="truncate opacity-80">{String(a.media_artist ?? '')} · {String(a.source ?? '')}</small>
              </span>
            </div>
          )}
          <Actions items={[
            { t: '⏮', go: () => call('media_player', 'media_previous_track', { entity_id: id }) },
            { t: e.state === 'playing' ? 'Pause' : 'Play', on: e.state === 'playing', go: () => call('media_player', 'media_play_pause', { entity_id: id }) },
            { t: '⏭', go: () => call('media_player', 'media_next_track', { entity_id: id }) },
            { t: a.is_volume_muted ? 'Unmute' : 'Mute', on: !!a.is_volume_muted, go: () => call('media_player', 'volume_mute', { entity_id: id, is_volume_muted: !a.is_volume_muted }) },
          ]} />
          <Range label="Volume" value={vol} min={0} max={100} step={1} color={accent(e)} onCommit={(v) => call('media_player', 'volume_set', { entity_id: id, volume_level: v / 100 })} format={(v) => `${Math.round(v)}%`} />
          {Array.isArray(a.source_list) && (
            <Seg<string> label="Source" value={String(a.source)} onPick={(source) => call('media_player', 'select_source', { entity_id: id, source })}
              options={(a.source_list as string[]).map((s) => ({ v: s, t: s }))} />
          )}
        </>
      )
    }
    case 'camera': return (
      <>
        <BigState color={accent(e)} text={e.state === 'recording' ? 'Recording' : e.state === 'off' ? 'Off' : 'Live'} sub={e.state === 'recording' ? 'Something is moving in view' : 'Watching the garden and the front door'} />
        <div className="flex items-center justify-between">
          <span className="text-sm">Motion detection</span>
          <Switch on={!!a.motion_detection} label="Motion detection" onChange={() => call('camera', a.motion_detection ? 'disable_motion_detection' : 'enable_motion_detection', { entity_id: id })} />
        </div>
      </>
    )
    case 'vacuum':
    case 'lawn_mower': {
      const d = domainOf(id)
      const working = e.state === 'cleaning' || e.state === 'mowing'
      return (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat k="Status" v={cap(e.state)} />
            <Stat k="Battery" v={`${Math.round(Number(a.battery_level ?? 0))}%`} />
          </div>
          <Actions items={[
            { t: 'Start', on: working, go: () => call(d, d === 'vacuum' ? 'start' : 'start_mowing', { entity_id: id }) },
            { t: 'Pause', on: e.state === 'paused', go: () => call(d, 'pause', { entity_id: id }) },
            { t: 'Dock', on: e.state === 'returning' || e.state === 'docked', go: () => call(d, d === 'vacuum' ? 'return_to_base' : 'dock', { entity_id: id }) },
            ...(d === 'vacuum' ? [{ t: 'Locate', go: () => call(d, 'locate', { entity_id: id }) }] : []),
          ]} />
          {Array.isArray(a.fan_speed_list) && (
            <Seg<string> label="Suction" value={String(a.fan_speed)} onPick={(fan_speed) => call(d, 'set_fan_speed', { entity_id: id, fan_speed })}
              options={(a.fan_speed_list as string[]).map((s) => ({ v: s, t: cap(s) }))} />
          )}
        </>
      )
    }
    case 'switch': return (
      <div className="grid grid-cols-2 gap-2">
        <Stat k="Drawing" v={`${Math.round(Number(a.current_power_w ?? 0))} W`} />
        <Stat k="Rated" v={`${a.rated_power_w ?? '—'} W`} />
      </div>
    )
    case 'water_heater': {
      const target = Number(a.temperature ?? 55)
      return (
        <>
          <div className="flex items-center justify-between gap-3">
            <button type="button" aria-label="Lower the target" disabled={target <= Number(a.min_temp ?? 35)} onClick={() => call('water_heater', 'set_temperature', { entity_id: id, temperature: target - 1 })}
              className="grid size-10 place-items-center rounded-full bg-foreground/5 text-lg disabled:opacity-40">−</button>
            <div className="grid text-center">
              <b className="font-mono font-semibold text-4xl">{target}°</b>
              <span className="text-muted-foreground text-xs">Tank {Number(a.current_temperature ?? 0).toFixed(1)}°</span>
            </div>
            <button type="button" aria-label="Raise the target" disabled={target >= Number(a.max_temp ?? 70)} onClick={() => call('water_heater', 'set_temperature', { entity_id: id, temperature: target + 1 })}
              className="grid size-10 place-items-center rounded-full bg-foreground/5 text-lg disabled:opacity-40">+</button>
          </div>
          <Seg<string> label="Mode" value={e.state} onPick={(m) => call('water_heater', 'set_operation_mode', { entity_id: id, operation_mode: m })}
            options={((a.operation_list as string[]) ?? []).map((m) => ({ v: m, t: cap(m) }))} />
        </>
      )
    }
    case 'assist_satellite': return (
      <>
        <BigState color={accent(e)} text={cap(e.state)} sub={a._said ? `“${a._said}”` : 'Say the wake word, or announce something'} />
        <Actions items={[
          { t: 'Wake word', on: e.state === 'listening', go: () => call('assist_satellite', 'start_conversation', { entity_id: id }) },
          { t: 'Announce', on: e.state === 'responding', go: () => call('assist_satellite', 'announce', { entity_id: id, message: 'Dinner is ready' }) },
        ]} />
      </>
    )
    case 'humidifier': return (
      <>
        <div className="grid grid-cols-2 gap-2">
          <Stat k="Room" v={`${a.current_humidity ?? '—'}%`} />
          <Stat k="Doing" v={cap(String(a.action ?? 'off'))} />
        </div>
        <Range label="Target" value={Number(a.humidity ?? 50)} min={Number(a.min_humidity ?? 30)} max={Number(a.max_humidity ?? 80)} step={1} color="#7cc8ff"
          onCommit={(v) => call('humidifier', 'set_humidity', { entity_id: id, humidity: v })} format={(v) => `${Math.round(v)}%`} />
        {Array.isArray(a.available_modes) && (
          <Seg<string> label="Mode" value={String(a.mode)} onPick={(mode) => call('humidifier', 'set_mode', { entity_id: id, mode })} options={(a.available_modes as string[]).map((m) => ({ v: m, t: cap(m) }))} />
        )}
      </>
    )
    case 'person':
    case 'device_tracker': {
      const room = String(a._room ?? '')
      return (
        <>
          <BigState color={accent(e)} text={e.state === 'home' ? `Home · ${cap(room)}` : 'Away'} sub={a.battery_level !== undefined ? `Phone battery ${a.battery_level}%` : undefined} />
          {domainOf(id) === 'person' && (
            <LabOnly label="Move them">
              <div className="flex flex-wrap gap-1.5">
                {[...areas.map((x) => ({ v: x.id, t: x.name })), { v: 'not_home', t: 'Away' }].map((r) => (
                  <button key={r.v} type="button" aria-pressed={(r.v === 'not_home' ? e.state === 'not_home' : room === r.v)}
                    onClick={() => {
                      call('lab', 'move', { entity_id: id, room: r.v })
                      for (const t of (a.device_trackers as string[] | undefined) ?? []) call('lab', 'move', { entity_id: t, room: r.v })
                    }}
                    className={`rounded-full px-2.5 py-1 text-xs ${(r.v === 'not_home' ? e.state === 'not_home' : room === r.v) ? 'bg-foreground text-background' : 'bg-foreground/5 hover:bg-foreground/10'}`}>
                    {r.t}
                  </button>
                ))}
              </div>
            </LabOnly>
          )}
        </>
      )
    }
    case 'remote': return (
      <>
        {Array.isArray(a.activity_list) && (
          <Seg<string> label="Activity" value={String(a.current_activity)} onPick={(activity) => call('remote', 'turn_on', { entity_id: id, activity })} options={(a.activity_list as string[]).map((x) => ({ v: x, t: x }))} />
        )}
        <Actions items={['power', 'volume_down', 'volume_up', 'next'].map((c) => ({ t: CMD[c]!, go: () => call('remote', 'send_command', { entity_id: id, command: c }) }))} />
      </>
    )
    case 'infrared':
    case 'radio_frequency': {
      const d = domainOf(id)
      const cmds = d === 'infrared' ? ['power', 'cooler', 'warmer'] : ['open', 'close']
      return (
        <>
          <BigState color={accent(e)} text={a._command ? `Sent “${CMD[String(a._command)] ?? a._command}”` : 'Nothing sent yet'} sub={`Controls ${String(a._target ?? '').split('.')[1]?.replaceAll('_', ' ') ?? ''}`} />
          <Actions items={cmds.map((c) => ({ t: CMD[c]!, go: () => call(d, 'send_command', { entity_id: id, command: c }) }))} />
        </>
      )
    }
    case 'event': return (
      <>
        <BigState color={accent(e)} text={a.event_type ? `${cap(String(a.event_type))}` : 'Nothing yet'} sub={a.event_type ? `Last ${statusOf(e).split(' ').slice(1).join(' ')}` : 'Waiting for the first press'} />
        <LabOnly label="What the world would do">
          <button type="button" onClick={() => call('lab', 'fire', { entity_id: id, event_type: ((a.event_types as string[]) ?? ['press'])[0] })} className="w-full rounded-full bg-foreground/5 px-3 py-1.5 text-sm hover:bg-foreground/10">Ring the bell</button>
        </LabOnly>
      </>
    )
    case 'weather': {
      const fc = (a._forecast as { day: string; condition: string; temperature: number; templow: number }[]) ?? []
      return (
        <>
          <div className="flex items-end justify-between">
            <b className="font-mono font-semibold text-4xl">{String(a.temperature)}°</b>
            <span className="text-right text-muted-foreground text-xs">{cap(e.state.replace('-', ' '))}<br />Feels {String(a.apparent_temperature)}° · {String(a.humidity)}% · {String(a.wind_speed)} km/h</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {fc.map((f) => (
              <div key={f.day} className="grid gap-0.5 rounded-xl bg-foreground/5 px-2 py-1.5 text-center text-xs">
                <span className="text-muted-foreground">{f.day}</span>
                <b className="font-medium">{cap(f.condition.replace('-', ' '))}</b>
                <span>{f.temperature}° / {f.templow}°</span>
              </div>
            ))}
          </div>
          <LabOnly label="Change the weather (the sky follows)">
            <div className="flex flex-wrap gap-1.5">
              {['sunny', 'partlycloudy', 'cloudy', 'rainy', 'pouring', 'lightning-rainy', 'snowy', 'fog'].map((c) => (
                <button key={c} type="button" onClick={() => call('lab', 'set_condition', { entity_id: id, condition: c })}
                  className={`rounded-full px-2.5 py-1 text-xs ${e.state === c ? 'bg-foreground text-background' : 'bg-foreground/5 hover:bg-foreground/10'}`}>{cap(c.replace('-', ' '))}</button>
              ))}
            </div>
          </LabOnly>
        </>
      )
    }
    case 'scene': {
      const sets = Object.entries((a._entities ?? {}) as Record<string, [string, Record<string, unknown>]>)
      return (
        <>
          <button type="button" onClick={() => call('scene', 'turn_on', { entity_id: id })} className="rounded-full bg-foreground px-3 py-2 font-medium text-background text-sm">Activate</button>
          <ul className="grid gap-1 text-xs">
            {sets.map(([t, [s]]) => <li key={t} className="flex justify-between gap-2"><span className="truncate">{t}</span><span className="text-muted-foreground">{s.replaceAll('_', ' ')}</span></li>)}
          </ul>
        </>
      )
    }
    case 'button': return <button type="button" onClick={() => call('button', 'press', { entity_id: id })} className="rounded-full bg-foreground px-3 py-2 font-medium text-background text-sm">Press</button>
    case 'number': return (
      <Range label={nameOf(e)} value={Number(e.state)} min={Number(a.min ?? 0)} max={Number(a.max ?? 100)} step={Number(a.step ?? 1)} color={ALERT.info}
        onCommit={(v) => call('number', 'set_value', { entity_id: id, value: v })} format={(v) => `${v}${a.unit_of_measurement ? ` ${a.unit_of_measurement}` : ''}`} />
    )
    case 'select': return <Seg<string> label="Option" value={e.state} onPick={(option) => call('select', 'select_option', { entity_id: id, option })} options={((a.options as string[]) ?? []).map((o) => ({ v: o, t: o }))} />
    case 'text': return <Send placeholder="New text" initial={e.state} button="Set" onSend={(value) => call('text', 'set_value', { entity_id: id, value })} />
    case 'date': return <Send type="date" initial={e.state} button="Set" onSend={(value) => call('date', 'set_value', { entity_id: id, date: value })} />
    case 'time': return <Send type="time" initial={e.state.slice(0, 5)} button="Set" onSend={(value) => call('time', 'set_value', { entity_id: id, time: `${value}:00` })} />
    case 'datetime': return <Send type="datetime-local" initial={e.state.slice(0, 16)} button="Set" onSend={(value) => call('datetime', 'set_value', { entity_id: id, datetime: `${value}:00` })} />
    case 'update': return (
      <>
        <div className="grid grid-cols-2 gap-2">
          <Stat k="Installed" v={String(a.installed_version)} />
          <Stat k="Latest" v={String(a.latest_version)} />
        </div>
        {a.release_summary ? <p className="text-muted-foreground text-xs">{String(a.release_summary)}</p> : null}
        {a.in_progress ? (
          <div className="h-2 overflow-hidden rounded-full bg-foreground/10"><i className="block h-full bg-foreground transition-[width]" style={{ width: `${Number(a.update_percentage ?? 0)}%` }} /></div>
        ) : e.state === 'on' ? (
          <Actions items={[{ t: 'Install', go: () => call('update', 'install', { entity_id: id }) }, { t: 'Skip', go: () => call('update', 'skip', { entity_id: id }) }]} />
        ) : <span className="text-muted-foreground text-sm">Up to date</span>}
      </>
    )
    case 'notify': return (
      <>
        {a._last ? <p className="text-muted-foreground text-xs">Last: “{String(a._last)}”</p> : null}
        <Send placeholder="Message to send" button="Send" onSend={(message) => call('notify', 'send_message', { entity_id: id, message })} />
      </>
    )
    case 'calendar': {
      const evs = ((a._events ?? []) as { summary: string; start: number; end: number; location?: string }[]).filter((v) => v.end > Date.now()).sort((x, y) => x.start - y.start)
      return (
        <>
          <ul className="grid gap-1.5">
            {evs.map((v) => (
              <li key={v.summary + v.start} className="rounded-xl bg-foreground/5 px-3 py-2 text-sm">
                <b className="font-medium">{v.summary}</b>
                <span className="block text-muted-foreground text-xs">{new Date(v.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–{new Date(v.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{v.location ? ` · ${v.location}` : ''}</span>
              </li>
            ))}
          </ul>
          <Send placeholder="New event in 30 min" button="Add" onSend={(summary) => call('calendar', 'create_event', { entity_id: id, summary, in_minutes: 30 })} />
        </>
      )
    }
    case 'todo': {
      const items = (a._items ?? []) as { summary: string; status: string }[]
      return (
        <>
          <ul className="grid gap-1">
            {items.map((i) => (
              <li key={i.summary}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={i.status === 'completed'} onChange={() => call('todo', 'update_item', { entity_id: id, item: i.summary, status: i.status === 'completed' ? 'needs_action' : 'completed' })} />
                  <span className={i.status === 'completed' ? 'text-muted-foreground line-through' : ''}>{i.summary}</span>
                </label>
              </li>
            ))}
          </ul>
          <Send placeholder="Add an item" button="Add" onSend={(item) => call('todo', 'add_item', { entity_id: id, item })} />
          <button type="button" onClick={() => call('todo', 'remove_completed_items', { entity_id: id })} className="text-left text-muted-foreground text-xs hover:text-foreground">Clear completed</button>
        </>
      )
    }
    case 'timer_list': {
      const list = (a._timers ?? []) as { id: string; name: string; remaining: number; paused: boolean }[]
      const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
      return (
        <>
          {list.length === 0 && <span className="text-muted-foreground text-sm">No timers running</span>}
          {list.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2">
              <span className="flex-1 text-sm">{t.name}</span>
              <b className="font-mono">{mmss(t.remaining)}</b>
              <button type="button" className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs" onClick={() => call('timer_list', t.paused ? 'unpause_timer' : 'pause_timer', { entity_id: id, timer_id: t.id })}>{t.paused ? 'Resume' : 'Pause'}</button>
              <button type="button" className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs" onClick={() => call('timer_list', 'cancel_timer', { entity_id: id, timer_id: t.id })}>Cancel</button>
            </div>
          ))}
          <Actions items={[
            { t: 'Eggs · 10 s', go: () => call('timer_list', 'create_timer', { entity_id: id, name: 'Eggs', seconds: 10 }) },
            { t: 'Pasta · 1 min', go: () => call('timer_list', 'create_timer', { entity_id: id, name: 'Pasta', seconds: 60 }) },
            { t: 'Tea · 5 min', go: () => call('timer_list', 'create_timer', { entity_id: id, name: 'Tea', seconds: 300 }) },
          ]} />
        </>
      )
    }
    case 'conversation': return (
      <>
        {a._last ? (
          <div className="grid gap-1.5 text-sm">
            <span className="justify-self-end rounded-2xl rounded-br-sm bg-foreground px-3 py-1.5 text-background">{String(a._last)}</span>
            <span className="justify-self-start rounded-2xl rounded-bl-sm bg-foreground/5 px-3 py-1.5">{String(a._reply ?? '…')}</span>
          </div>
        ) : <p className="text-muted-foreground text-xs">Try “turn off the lounge pendant”, “lock the front door”, “temperature in the studio” or “who is home”.</p>}
        <Send placeholder="Ask Assist" button="Send" clear onSend={(text) => call('conversation', 'process', { entity_id: id, text })} />
      </>
    )
    case 'tts': {
      const speakers = (a._speakers as string[]) ?? []
      return <Send placeholder="Something to say" button="Speak" clear onSend={(message) => call('tts', 'speak', { entity_id: id, media_player_entity_id: speakers[0] ?? '', message })} />
    }
    case 'stt': return <Stat k="Languages" v={((a._languages as string[]) ?? []).join(', ')} />
    case 'wake_word': return (
      <>
        <Stat k="Listening for" v={((a._words as string[]) ?? []).join(' · ')} />
        <LabOnly label="What the world would do">
          <button type="button" onClick={() => call('wake_word', 'detect', { entity_id: id })} className="w-full rounded-full bg-foreground/5 px-3 py-1.5 text-sm hover:bg-foreground/10">Say “{((a._words as string[]) ?? ['Okay Nabu'])[0]}”</button>
        </LabOnly>
      </>
    )
    case 'ai_task': return (
      <>
        {a._result ? <p className="rounded-xl bg-foreground/5 px-3 py-2 text-sm">{String(a._result)}</p> : null}
        <button type="button" onClick={() => call('ai_task', 'generate_data', { entity_id: id, task_name: 'summary', instructions: 'Summarise the home right now' })} className="rounded-full bg-foreground px-3 py-2 font-medium text-background text-sm">Summarise my home</button>
      </>
    )
    case 'image': return (
      <>
        <Snapshot seed={Number(a._seed ?? 0)} caption={String(a._caption ?? '')} />
        <span className="text-muted-foreground text-xs">{String(a._caption ?? '')} · {statusOf({ ...e, entity_id: 'button.x' }).replace('Last ', '')}</span>
      </>
    )
    case 'image_processing': return <BigState color={accent(e)} text={`${e.state} ${String(a._label ?? 'found')}`} sub={`In the ${String(a._area ?? '')}, seen by the camera`} />
    case 'geo_location': return (
      <div className="grid grid-cols-2 gap-2">
        <Stat k="Distance" v={`${e.state} km`} />
        <Stat k="Source" v={cap(String(a.source ?? ''))} />
      </div>
    )
    case 'air_quality': return (
      <div className="grid grid-cols-2 gap-2">
        <Stat k="PM2.5" v={`${e.state} µg/m³`} />
        <Stat k="PM10" v={`${a.particulate_matter_10} µg/m³`} />
        <Stat k="Ozone" v={`${a.ozone} µg/m³`} />
        <Stat k="NO₂" v={`${a.nitrogen_dioxide} µg/m³`} />
      </div>
    )
    default: {
      const k = fieldOf(e)
      if (!k) return <Stat k="Reading" v={`${e.state} ${a.unit_of_measurement ?? ''}`} />
      const v = Number(e.state)
      const c = fieldColor(k, v)
      const first = history[0] ?? v
      const delta = v - first
      return (
        <>
          <div className="flex items-end justify-between">
            <b className="font-mono font-semibold text-4xl">{v.toFixed(FIELDS[k].digits)}<small className="ml-1 text-base">{a.unit_of_measurement ?? FIELDS[k].unit}</small></b>
            <span className="text-right text-muted-foreground text-xs">{Math.abs(delta) < 10 ** -FIELDS[k].digits ? 'Steady' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(FIELDS[k].digits)} in 1 min`}</span>
          </div>
          <Spark data={history} color={c} />
          <button type="button" onClick={() => onLayer(layer === k ? null : k)} aria-pressed={layer === k}
            className={`rounded-full border px-3 py-1.5 text-sm ${layer === k ? 'border-transparent bg-foreground text-background' : 'border-border hover:bg-foreground/5'}`}>
            {layer === k ? `Showing ${FIELDS[k].label.toLowerCase()} on the floor` : `Show ${FIELDS[k].label.toLowerCase()} on the floor`}
          </button>
        </>
      )
    }
  }
}

/** Samples every sensor once a second, for the sparklines (a minute of history). */
function useHistory(entities: HassEntities) {
  const ref = useRef(entities)
  ref.current = entities
  const [hist, setHist] = useState<Record<string, number[]>>({})
  useEffect(() => {
    const id = window.setInterval(() => {
      setHist((h) => {
        const next: Record<string, number[]> = {}
        for (const e of Object.values(ref.current)) {
          if (!fieldOf(e)) continue
          next[e.entity_id] = [...(h[e.entity_id] ?? []), Number(e.state)].slice(-60)
        }
        return next
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])
  return hist
}

export function HomePanel({ title, devices, areas, entities, selected, lastCall, notice, layer, pins, onSelect, onGroup, call, onLayer }: {
  notice?: { text: string; at: number } | null
  /** A grouped pin was clicked: the devices under it, for the camera to zoom in on. */
  onGroup?: (entityIds: string[]) => void
  title: string
  devices: HomeDevice[]
  areas: Area[]
  entities: HassEntities
  selected: string | null
  lastCall: (ServiceCall & { source?: string; note?: string }) | null
  layer: FieldKind | null
  pins: PinRefs
  onSelect: (id: string | null) => void
  call: Call
  onLayer: (k: FieldKind | null) => void
}) {
  const history = useHistory(entities)
  // an automation that just ran shows as a toast for a few seconds
  const [toast, setToast] = useState<{ label: string; text: string } | null>(null)
  useEffect(() => {
    if (lastCall?.source !== 'automation' || !lastCall.note) return
    setToast({ label: 'Automation', text: lastCall.note })
    const id = window.setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(id)
  }, [lastCall])
  useEffect(() => {
    if (!notice) return
    setToast({ label: 'Home', text: notice.text })
    const id = window.setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(id)
  }, [notice])
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && onSelect(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSelect])

  const formatters = useEntityFormatters()
  const toggle = (e: HassEntity) => {
    const d = domainOf(e.entity_id)
    if (d === 'climate') return call('climate', isOn(e) ? 'turn_off' : 'turn_on', { entity_id: e.entity_id })
    return call(d, 'toggle', { entity_id: e.entity_id })
  }
  const sel = selected ? entities[selected] : undefined
  const active = devices.filter((d) => entities[d.entityId] && toggles(entities[d.entityId]!) && isOn(entities[d.entityId]))
  const switchable = devices.filter((d) => entities[d.entityId] && toggles(entities[d.entityId]!))
  const layers = (Object.keys(FIELDS) as FieldKind[]).filter((k) => Object.values(entities).some((e) => fieldOf(e) === k))
  const [tab, setTab] = useState<'rooms' | 'home'>('rooms')
  const lastGroup = useRef<string | null>(null)
  const [menu, setMenu] = useState<{ ids: string[]; x: number; y: number } | null>(null)
  // everything Home Assistant has that is not a thing placed in a room
  const placed = new Set(devices.map((d) => d.entityId))
  const homeOnly = Object.values(entities).filter((e) => !placed.has(e.entity_id))

  // a plain function, not a component, so rows aren't remounted every tick
  const row = (e: HassEntity) => {
    const on = lit(e)
    return (
      <div key={e.entity_id} className={`mx-1.5 flex items-center gap-2 rounded-xl px-2.5 py-1.5 ${selected === e.entity_id ? 'bg-foreground/8' : 'hover:bg-foreground/5'}`}>
        <button type="button" aria-pressed={selected === e.entity_id} onClick={() => onSelect(selected === e.entity_id ? null : e.entity_id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span className={`grid size-8 shrink-0 place-items-center rounded-[9px] transition-colors ${on ? 'bg-foreground text-background' : 'bg-foreground/8 text-muted-foreground'}`}><Icon e={e} /></span>
          <span className="grid min-w-0">
            <b className="truncate font-medium text-sm">{nameOf(e)}</b>
            <small className="truncate text-muted-foreground text-xs">{statusOf(e, formatters)}</small>
          </span>
        </button>
        {toggles(e) && <Switch on={isOn(e)} label={`${nameOf(e)} power`} onChange={() => toggle(e)} />}
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {toast && (
        <div role="status" className="absolute top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border/60 bg-background/95 px-4 py-2 text-sm shadow-lg backdrop-blur">
          <i className="size-2 rounded-full bg-foreground" />
          <span className="text-muted-foreground">{toast.label}</span>
          <b className="font-medium">{toast.text}</b>
        </div>
      )}
      {/* pins ride on the model */}
      {devices.map((d) => {
        const e = entities[d.entityId]
        if (!e) return null
        const focused = selected === d.entityId
        const on = lit(e)
        return (
          <button key={d.entityId} type="button" ref={(el) => void (pins.current[d.entityId] = el)} data-entity={d.entityId}
            aria-label={focused && toggles(e) ? `Turn ${nameOf(e)} ${isOn(e) ? 'off' : 'on'}` : `Open ${nameOf(e)}`}
            onClick={(ev) => {
              // a grouped pin zooms in on its group, so its pins spread apart; clicked again
              // (devices too close to ever separate) it lists them to pick from
              const group = ev.currentTarget.dataset.group
              if (group && onGroup) {
                if (lastGroup.current === group) {
                  const r = ev.currentTarget.getBoundingClientRect()
                  const box = ev.currentTarget.offsetParent?.getBoundingClientRect()
                  setMenu({ ids: group.split(','), x: r.left - (box?.left ?? 0) + r.width / 2, y: r.bottom - (box?.top ?? 0) + 6 })
                } else {
                  lastGroup.current = group
                  setMenu(null)
                  onGroup(group.split(','))
                }
                return
              }
              lastGroup.current = null
              setMenu(null)
              if (focused && toggles(e)) toggle(e)
              else onSelect(d.entityId)
            }}
            // the canvas sets the tooltip from these: one name, or every name in a group
            data-title={`${nameOf(e)} · ${statusOf(e, formatters)}`}
            data-name={nameOf(e)}
            // a pin grouped with others under it shows "+n" (data-more, set by the canvas)
            // plain circles as in the site's viewer: dark and quiet when off, white with a soft halo when on
            className={`group pointer-events-auto absolute top-0 left-0 grid place-items-center rounded-full transition-[opacity,scale] hover:scale-110 after:absolute after:-top-1 after:-right-1.5 after:hidden after:min-w-4 after:rounded-full after:bg-foreground after:px-1 after:text-center after:font-mono after:text-[9px] after:text-background after:leading-4 after:content-[attr(data-more)] data-[more]:after:block ${
              selected && !focused ? 'opacity-30' : ''} ${focused ? 'size-10' : 'size-7'} ${on
                ? 'bg-foreground text-background shadow-[0_0_0_4px_color-mix(in_oklab,var(--foreground)_16%,transparent)]'
                : 'border border-foreground/15 bg-background/80 text-muted-foreground backdrop-blur'}`}>
            {/* icons only on the model: the name shows in a small label on hover */}
            {focused && toggles(e) ? <Power /> : <Icon e={e} className={focused ? 'size-4.5' : 'size-3.5'} />}
            <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] text-background opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100 group-data-[more]:hidden">
              {nameOf(e)}
            </span>
          </button>
        )
      })}

      {/* the devices under a grouped pin that zooming could not separate */}
      {menu && (
        <div role="menu" aria-label="Devices here" className="pointer-events-auto absolute z-10 grid w-56 -translate-x-1/2 gap-0.5 rounded-xl border border-border/60 bg-background/95 p-1 shadow-lg backdrop-blur" style={{ left: menu.x, top: menu.y }}>
          {menu.ids.map((id) => entities[id] && (
            <button key={id} type="button" role="menuitem" onClick={() => {
              setMenu(null)
              lastGroup.current = null
              onSelect(id)
            }} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-foreground/5">
              <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-foreground/8 text-muted-foreground"><Icon e={entities[id]!} className="size-3.5" /></span>
              <span className="grid min-w-0">
                <b className="truncate font-medium">{nameOf(entities[id]!)}</b>
                <small className="truncate text-muted-foreground text-xs">{statusOf(entities[id]!, formatters)}</small>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* the device list, by room */}
      <aside aria-label="Devices" className="pointer-events-auto absolute top-4 left-4 flex max-h-[calc(100%-2rem)] w-72 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/90 shadow-lg backdrop-blur">
        <header className="flex items-center justify-between border-border/60 border-b px-4 py-3">
          <b className="font-semibold">{title}</b>
          <span className="flex items-center gap-1.5 text-muted-foreground text-xs"><i className="size-1.5 rounded-full bg-emerald-400" />{active.length} of {switchable.length} on</span>
        </header>
        <div className="flex gap-1 border-border/60 border-b p-1.5" role="tablist">
          {(['rooms', 'home'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`flex-1 rounded-full px-3 py-1 text-xs ${tab === t ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-foreground/5'}`}>
              {t === 'rooms' ? `Rooms · ${devices.length}` : `Home · ${homeOnly.length}`}
            </button>
          ))}
        </div>
        <div className="ui-scroll overflow-y-auto py-1">
          {tab === 'rooms'
            ? areas.map((area) => (
              <section key={area.id} aria-label={area.name}>
                <h3 className="px-4 pt-2 pb-1 font-medium text-muted-foreground text-xs">{area.name}</h3>
                {devices.filter((d) => d.anchor.area === area.id).map((d) => entities[d.entityId] && row(entities[d.entityId]!))}
              </section>
            ))
            : HOME_GROUPS.map(([name, domains]) => {
              const list = homeOnly.filter((e) => (domains as readonly string[]).includes(domainOf(e.entity_id)))
              return list.length ? (
                <section key={name} aria-label={name}>
                  <h3 className="px-4 pt-2 pb-1 font-medium text-muted-foreground text-xs">{name}</h3>
                  {list.map(row)}
                </section>
              ) : null
            })}
        </div>
        {tab === 'rooms' && layers.length > 0 && (
          <footer className="border-border/60 border-t px-3 py-3">
            <Seg<string> label="Floor shows" value={layer ?? 'none'} onPick={(v) => onLayer(v === 'none' ? null : (v as FieldKind))}
              options={[{ v: 'none', t: 'Nothing' }, ...layers.map((k) => ({ v: k as string, t: FIELDS[k].label }))]} />
          </footer>
        )}
      </aside>

      {/* the selected device's card */}
      {sel && (
        <section key={sel.entity_id} aria-label={`${nameOf(sel)} controls`} className="ui-scroll pointer-events-auto absolute top-[var(--card-top,1rem)] right-[var(--card-right,1rem)] flex max-h-[calc(100%-var(--card-top,1rem)-1rem)] w-80 flex-col gap-4 overflow-y-auto rounded-2xl border border-border/60 bg-background/90 p-4 shadow-lg backdrop-blur">
          <header className="flex items-center gap-3">
            <button type="button" onClick={() => onSelect(null)} aria-label="Back to all devices" className="grid size-8 place-items-center rounded-full hover:bg-foreground/5">
              <Svg><path d="m15 18-6-6 6-6" /></Svg>
            </button>
            <span className="grid min-w-0 flex-1">
              <b className="truncate font-semibold">{nameOf(sel)}</b>
              <small className="truncate text-muted-foreground text-xs">{areas.find((a) => a.id === devices.find((d) => d.entityId === sel.entity_id)?.anchor.area)?.name ?? 'Home'} · {sel.entity_id}</small>
            </span>
            {toggles(sel) && domainOf(sel.entity_id) !== 'climate' && <Switch on={isOn(sel)} label={`${nameOf(sel)} power`} onChange={() => toggle(sel)} />}
          </header>
          <div className="grid gap-4">
            <Controls e={sel} call={call} formatters={formatters} history={history[sel.entity_id] ?? []} layer={layer} onLayer={onLayer} areas={areas} />
          </div>
          {lastCall?.data.entity_id === sel.entity_id && (
            <code className="block overflow-x-auto whitespace-nowrap rounded-lg bg-foreground/5 px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {lastCall.source === 'automation' ? 'automation → ' : ''}{describeCall(lastCall)}
            </code>
          )}
        </section>
      )}
    </div>
  )
}

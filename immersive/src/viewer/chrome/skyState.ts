import {
  presetInstant,
  resolveLocation,
  type SkyPhase,
  skyPhase,
  solarClockInstant,
  solarClockMinutes,
  solarPosition,
  sunEvents,
  type TimeOfDay,
  useViewer,
  type Weather,
} from '@pascal-app/viewer'
import type { ViewerNodes } from '@pascal-app/viewer/ui'
import { Cloud, CloudSun, Cloudy, Moon, Sun, Sunrise, Sunset } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type SiteNodeLike = {
  type?: string
  parcel?: { originLngLat?: readonly [number, number] | null } | null
  dossier?: { point?: { lat?: number; lng?: number } | null } | null
}

export const TIME_PRESETS = [
  { id: 'midday', label: 'Midday', icon: Sun },
  { id: 'golden', label: 'Golden hour', icon: Sunset },
  { id: 'blue', label: 'Blue hour', icon: Sunrise },
  { id: 'night', label: 'Night', icon: Moon },
] as const satisfies readonly { id: TimeOfDay; label: string; icon: typeof Sun }[]

export const WEATHER_OPTIONS = [
  { id: 'clear', label: 'Clear', icon: Sun },
  { id: 'fair', label: 'Fair', icon: CloudSun },
  { id: 'cloudy', label: 'Cloudy', icon: Cloudy },
  { id: 'overcast', label: 'Overcast', icon: Cloud },
] as const satisfies readonly { id: Weather; label: string; icon: typeof Sun }[]

const PHASE_LABELS: Record<SkyPhase, string> = {
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
  golden: 'Golden hour',
  blue: 'Blue hour',
  night: 'Night',
}

let clockFormat: Intl.DateTimeFormat | null = null

/** Minutes after midnight formatted as a short wall-clock string. */
export function formatClockMinutes(minutes: number): string {
  clockFormat ??= new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  })
  return clockFormat.format(new Date(Math.round(minutes) * 60_000))
}

export function phaseLabel(phase: SkyPhase): string {
  return PHASE_LABELS[phase]
}

/**
 * Resolves the scene's current sky state from `@pascal-app/viewer`'s solar helpers and store.
 * Reads the site node from `nodes` (published graph or live store) so baked GLBs work identically.
 */
export function useSkyInfo(nodes: ViewerNodes) {
  const timeOfDay = useViewer((s) => s.timeOfDay)
  const timeOfDayMinutes = useViewer((s) => s.timeOfDayMinutes)
  const skyLive = useViewer((s) => s.skyLive)
  const weather = useViewer((s) => s.weather)
  const deviceLocation = useViewer((s) => s.deviceLocation)

  const site = useMemo(
    () => (Object.values(nodes) as unknown as SiteNodeLike[]).find((node) => node.type === 'site'),
    [nodes],
  )

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!skyLive) return
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [skyLive])

  const { location, source } = resolveLocation(site, deviceLocation)
  const { lat, lng } = location

  const day = useMemo(() => {
    const today = new Date()
    const presets = Object.fromEntries(
      TIME_PRESETS.map(({ id }) => [id, solarClockMinutes(presetInstant(today, lat, lng, id), lng)]),
    ) as Record<TimeOfDay, number>
    return { today, presets, events: sunEvents(today, lat, lng) ?? { sunrise: 6 * 60, sunset: 18 * 60 } }
  }, [lat, lng])

  const minutes = skyLive ? solarClockMinutes(now, lng) : (timeOfDayMinutes ?? day.presets[timeOfDay])
  const clock = skyLive ? now.getHours() * 60 + now.getMinutes() : minutes
  const elevation = solarPosition(solarClockInstant(day.today, lng, minutes), lat, lng).elevation
  const phase = skyPhase(elevation, minutes)

  // Keep the active preset card consistent with the header's phase badge (or nearest within ±15m).
  const activePreset: TimeOfDay | null = (() => {
    if (!skyLive && timeOfDayMinutes === null) return timeOfDay
    if (phase === 'midday' || phase === 'golden' || phase === 'blue' || phase === 'night') return phase
    let nearest: TimeOfDay | null = null
    let bestDiff = 15
    for (const { id } of TIME_PRESETS) {
      const raw = Math.abs(minutes - day.presets[id])
      const diff = Math.min(raw, 1440 - raw)
      if (diff <= bestDiff) {
        bestDiff = diff
        nearest = id
      }
    }
    return nearest
  })()

  return {
    minutes,
    clock,
    phase,
    isDay: elevation >= 0,
    activePreset,
    presets: day.presets,
    events: day.events,
    skyLive,
    weather,
    source,
  }
}

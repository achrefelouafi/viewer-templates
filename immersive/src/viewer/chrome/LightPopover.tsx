import { requestDeviceLocation, useViewer, WEATHER_COVER } from '@pascal-app/viewer'
import { Switch, type ViewerNodes } from '@pascal-app/viewer/ui'
import { LocateFixed, Moon, RotateCcw, Sun } from 'lucide-react'
import { useState } from 'react'
import { formatClockMinutes, phaseLabel, TIME_PRESETS, useSkyInfo, WEATHER_OPTIONS } from './skyState'
import { SunArc } from './SunArc'

/**
 * Light and weather popover: interactive half-circle SunArc with atmospheric sky gradient,
 * four two-line time presets, four cloud-cover chips, and live clock / device location toggle.
 */
export function LightPopover({ nodes }: { nodes: ViewerNodes }) {
  const sky = useSkyInfo(nodes)
  const [locating, setLocating] = useState(false)

  const handleLiveToggle = (live: boolean) => {
    const viewer = useViewer.getState()
    viewer.setSkyLive(live)
    if (!live || sky.source === 'site' || sky.source === 'device') return
    setLocating(true)
    requestDeviceLocation()
      .then((location) => useViewer.getState().setDeviceLocation(location))
      .catch(() => {})
      .finally(() => setLocating(false))
  }

  return (
    <div className="flex flex-col gap-3.5 text-foreground">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="ui-eyebrow ui-eyebrow-rule">Light &amp; sky</span>
          <div className="mt-1.5 flex items-center gap-2">
            {sky.isDay ? <Sun className="h-4 w-4 text-foreground" /> : <Moon className="h-4 w-4 text-foreground" />}
            <span className="font-mono text-base tabular-nums">{formatClockMinutes(sky.clock)}</span>
            <span className="rounded-full bg-foreground/[0.07] px-2 py-0.5 text-[11px] text-muted-foreground">
              {phaseLabel(sky.phase)}
            </span>
          </div>
        </div>
        <button
          className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-muted-foreground text-xs transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          onClick={() => {
            const viewer = useViewer.getState()
            viewer.setSkyLive(false)
            viewer.setTimeOfDay('midday')
            viewer.setWeather('fair')
          }}
          type="button"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Reset</span>
        </button>
      </div>

      <SunArc
        activePreset={sky.activePreset}
        clock={sky.clock}
        minutes={sky.minutes}
        phase={sky.phase}
        presets={sky.presets}
        sunrise={sky.events.sunrise}
        sunset={sky.events.sunset}
      />

      <div className="grid grid-cols-2 gap-1.5">
        {TIME_PRESETS.map(({ id, label, icon: Icon }) => {
          const active = sky.activePreset === id
          return (
            <button
              aria-pressed={active}
              className={`flex flex-col items-start gap-0.5 rounded-2xl border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 ${
                active
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-foreground/10 text-foreground hover:bg-foreground/[0.06]'
              }`}
              key={id}
              onClick={() => useViewer.getState().setTimeOfDay(id)}
              type="button"
            >
              <span className="inline-flex items-center gap-1.5 font-medium text-xs leading-snug">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{label}</span>
              </span>
              <span className={`pl-5 font-mono text-[10px] tabular-nums ${active ? 'opacity-75' : 'text-muted-foreground'}`}>
                {formatClockMinutes(sky.presets[id])}
              </span>
            </button>
          )
        })}
      </div>

      <div className="border-foreground/10 border-t pt-3">
        <span className="ui-eyebrow ui-eyebrow-rule mb-2">Weather</span>
        <div className="grid grid-cols-4 gap-1.5">
          {WEATHER_OPTIONS.map(({ id, label, icon: Icon }) => {
            const active = sky.weather === id
            return (
              <button
                aria-pressed={active}
                className={`flex flex-col items-center gap-0.5 rounded-2xl border px-1.5 py-2 text-center transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 ${
                  active
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-foreground/10 text-foreground hover:bg-foreground/[0.06]'
                }`}
                key={id}
                onClick={() => useViewer.getState().setWeather(id)}
                type="button"
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="text-[11px] leading-tight">{label}</span>
                <span className={`font-mono text-[9px] tabular-nums ${active ? 'opacity-75' : 'text-muted-foreground'}`}>
                  {Math.round(WEATHER_COVER[id] * 100)}%
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl bg-foreground/[0.05] px-3 py-2.5 text-xs">
        <span className="flex min-w-0 items-center gap-2">
          <LocateFixed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block text-foreground">
              {sky.source === 'site' ? 'Follow the clock' : 'Use my location'}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {sky.source === 'site' ? 'Sun follows your local time' : 'Approximate unless shared'}
            </span>
          </span>
        </span>
        <Switch checked={sky.skyLive} disabled={locating} onCheckedChange={handleLiveToggle} />
      </label>
    </div>
  )
}

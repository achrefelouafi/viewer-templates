import { create } from 'zustand'
import { addDb, climateStrength, domainOf, noiseOf, QUIET_DB, fieldOf, FIELDS, hvacAction, isOn, tripped, type HassEntities, type HassEntity, type ServiceCall } from './entities'

/* A stand-in Home Assistant for the effects lab: it keeps entities in Home Assistant's shapes,
   answers the service calls the cards make, moves things that take time (covers, valves, locks,
   arming, robots), runs a few automations a real home would have, and lets each room's air respond
   to its climate units, fans and heaters. A connection to a real Home Assistant will replace this
   store with the same `entities` and `callService`. */

export type AreaAir = {
  temperature: number
  humidity: number
  carbon_dioxide: number
  pm25: number
  volatile_organic_compounds: number
  /** Light level and noise follow what is on in the room each tick rather than drifting. */
  illuminance: number
  sound_pressure: number
}

/** Who made a call: the person in the viewer, a home automation, or the lab's own test switch. */
export type CallSource = 'user' | 'automation' | 'lab'

export type HomeStore = {
  entities: HassEntities
  air: Record<string, AreaAir>
  lastCall: (ServiceCall & { source: CallSource; note?: string }) | null
  callService: (domain: string, service: string, data: ServiceCall['data'], source?: CallSource) => void
  /** Advance the home by `dt` seconds. */
  tick: (dt: number) => void
  /** How much daylight there is outside (0..1), which the rooms' light level follows. */
  daylight: number
  setDaylight: (d: number) => void
  /** A notice the viewer shows for a moment (a notification sent, a timer done, Assist's answer). */
  notice: { text: string; at: number } | null
}

/** Where the air settles with nothing running. */
const AMBIENT = { temperature: 25.5, humidity: 58, carbon_dioxide: 1350, pm25: 18, volatile_organic_compounds: 380 }
const approach = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt))
const toward = (from: number, to: number, step: number) => (Math.abs(to - from) <= step ? to : from + Math.sign(to - from) * step)

/** How long the things that take time take, in seconds. */
const TAKES = { lock: 1.4, arming: 5, entry: 6, listen: 2.2, process: 1.4, respond: 3.4, robotHome: 7 }
/** Covers and valves travel this much of their range per second. */
const TRAVEL = { cover: 22, valve: 45 }

export function createHomeSimulator(start: HassEntities, areaOf: Record<string, string>, air: Record<string, AreaAir>) {
  const now = () => new Date().toISOString()
  /** Last mode a climate unit ran in, so turn_on brings it back. */
  const lastHvac: Record<string, string> = {}
  /** Seconds left on each timed transition. */
  const timers: Record<string, number> = {}
  for (const e of Object.values(start)) if (domainOf(e.entity_id) === 'climate' && e.state !== 'off') lastHvac[e.entity_id] = e.state

  return create<HomeStore>((set, get) => {
    const put = (e: HassEntity, old?: HassEntity) => set((s) => ({ entities: { ...s.entities, [e.entity_id]: { ...e, last_changed: e.state !== old?.state ? now() : old?.last_changed } } }))

    const notice = (text: string) => set({ notice: { text, at: Date.now() } })

    const callService: HomeStore['callService'] = (domain, service, data, source = 'user') => {
      const id = data.entity_id
      const old = get().entities[id]
      if (!old) return
      const svc = service === 'toggle' ? (isOn(old) ? 'turn_off' : 'turn_on') : service
      const next = apply(old, domain, svc, data, lastHvac, timers)
      if (domainOf(id) === 'climate' && next.state !== 'off') lastHvac[id] = next.state
      put(next, old)
      set({ lastCall: { domain, service, data, source } })
      knockOn(domain, svc, data, next)
    }

    /** What a call sets off beyond its own entity: a scene's devices, a remote's TV, Assist's answer. */
    const knockOn = (domain: string, service: string, data: ServiceCall['data'], e: HassEntity) => {
      const all = get().entities
      const run = (d: string, s: string, args: ServiceCall['data']) => all[args.entity_id] && callService(d, s, args, 'automation')
      if (domain === 'scene' && service === 'turn_on') {
        for (const [target, call] of Object.entries((e.attributes._entities ?? {}) as Record<string, [string, Record<string, unknown>]>)) run(domainOf(target), call[0], { entity_id: target, ...call[1] })
        notice(`Scene “${e.attributes.friendly_name}” set`)
      }
      if ((domain === 'remote' || domain === 'infrared' || domain === 'radio_frequency') && service === 'send_command') {
        const target = String(e.attributes._target ?? '')
        const cmd = String(data.command)
        const t = all[target]
        if (t) {
          const td = domainOf(target)
          if (cmd === 'power') run(td, 'toggle', { entity_id: target })
          if (cmd === 'volume_up' || cmd === 'volume_down') run(td, 'volume_set', { entity_id: target, volume_level: Math.max(0, Math.min(1, Number(t.attributes.volume_level ?? 0.3) + (cmd === 'volume_up' ? 0.1 : -0.1))) })
          if (cmd === 'next') run(td, 'media_next_track', { entity_id: target })
          if (cmd === 'cooler' || cmd === 'warmer') run(td, 'set_temperature', { entity_id: target, temperature: Number(t.attributes.temperature ?? 21) + (cmd === 'warmer' ? 1 : -1) })
          if (cmd === 'open' || cmd === 'close') run(td, cmd === 'open' ? 'open_cover' : 'close_cover', { entity_id: target })
        }
      }
      if (domain === 'button' && service === 'press' && e.attributes._restarts) {
        const target = String(e.attributes._restarts)
        if (all[target]) {
          put({ ...all[target]!, state: 'off' }, all[target])
          timers[target] = 6
        }
      }
      if (domain === 'notify') notice(`Notification sent: “${data.message}”`)
      if (domain === 'tts') {
        const mp = all[String(data.media_player_entity_id)]
        if (mp) put({ ...mp, attributes: { ...mp.attributes, _said: data.message, _said_at: Date.now() } }, mp)
        notice(`Speaking on ${mp?.attributes.friendly_name ?? 'a speaker'}: “${data.message}”`)
      }
      if (domain === 'wake_word') {
        const sat = Object.values(all).find((x) => domainOf(x.entity_id) === 'assist_satellite')
        if (sat) run('assist_satellite', 'start_conversation', { entity_id: sat.entity_id })
      }
      if (domain === 'conversation' && service === 'process') {
        const reply = converse(String(data.text ?? ''), get().entities, run)
        const cur = get().entities[e.entity_id]!
        put({ ...cur, attributes: { ...cur.attributes, _reply: reply } }, cur)
        notice(`Assist: ${reply}`)
      }
      if (domain === 'ai_task' && service === 'generate_data') {
        const result = summarise(get().entities, get().air)
        const cur = get().entities[e.entity_id]!
        put({ ...cur, attributes: { ...cur.attributes, _result: result } }, cur)
      }
      // the doorbell takes a snapshot of whoever is at the door
      if (domain === 'lab' && service === 'fire' && e.attributes.device_class === 'doorbell') {
        const img = Object.values(get().entities).find((x) => domainOf(x.entity_id) === 'image')
        if (img) put({ ...img, state: new Date().toISOString(), attributes: { ...img.attributes, _caption: 'Someone rang the bell', _seed: Math.random() } }, img)
        notice('Someone is at the front door')
      }
      if (domain === 'timer_list' && service === 'create_timer') notice(`Timer “${data.name || 'Timer'}” started`)
    }

    const automation = (domain: string, service: string, data: ServiceCall['data'], note: string) => {
      const e = get().entities[data.entity_id]
      if (!e) return
      callService(domain, service, data, 'automation')
      set((s) => ({ lastCall: s.lastCall && { ...s.lastCall, note } }))
    }

    return {
      entities: start,
      air,
      lastCall: null,
      callService,
      daylight: 0.5,
      setDaylight: (daylight) => set({ daylight }),
      notice: null,

      tick: (dt) => {
        const { entities, air: was } = get()
        const all = Object.values(entities)
        const next: HassEntities = { ...entities }
        const change = (e: HassEntity, patch: Partial<HassEntity> & { attributes?: Record<string, unknown> }) => {
          next[e.entity_id] = { ...e, ...patch, attributes: { ...e.attributes, ...(patch.attributes ?? {}) }, last_changed: patch.state && patch.state !== e.state ? now() : e.last_changed }
        }

        /* things that take time */
        for (const e of all) {
          const id = e.entity_id
          const d = domainOf(id)
          if (timers[id] !== undefined) timers[id] -= dt
          const done = timers[id] !== undefined && timers[id]! <= 0
          if (done) delete timers[id]

          if (d === 'cover' || d === 'valve') {
            const target = Number(e.attributes._target ?? e.attributes.current_position ?? 0)
            const pos = Number(e.attributes.current_position ?? 0)
            if (pos !== target) {
              const p = toward(pos, target, (d === 'cover' ? TRAVEL.cover : TRAVEL.valve) * dt)
              const moving = p !== target
              change(e, { state: moving ? (target > pos ? 'opening' : 'closing') : p === 0 ? 'closed' : 'open', attributes: { current_position: Math.round(p * 10) / 10 } })
            }
          }
          if (d === 'lock' && done) change(e, { state: e.state === 'locking' ? 'locked' : e.state === 'unlocking' ? 'unlocked' : e.state === 'opening' ? 'open' : e.state })
          if (d === 'alarm_control_panel' && done) {
            if (e.state === 'arming') change(e, { state: String(e.attributes._arm_to ?? 'armed_away') })
            if (e.state === 'pending') change(e, { state: 'triggered' })
          }
          if (d === 'assist_satellite' && done) {
            const order: Record<string, [string, number] | undefined> = { listening: ['processing', TAKES.process], processing: ['responding', TAKES.respond], responding: ['idle', 0] }
            const to = order[e.state]
            if (to) {
              change(e, { state: to[0] })
              if (to[1]) timers[id] = to[1]
            }
          }
          if (d === 'vacuum' || d === 'lawn_mower') {
            const working = e.state === 'cleaning' || e.state === 'mowing'
            const battery = Number(e.attributes.battery_level ?? 100)
            const docked = e.state === 'docked'
            const b = working ? battery - dt * 0.6 : docked ? Math.min(100, battery + dt * 1.5) : battery - dt * 0.15
            change(e, { attributes: { battery_level: Math.round(b * 10) / 10 } })
            if (e.state === 'returning' && done) change(next[id]!, { state: 'docked' })
            if (working && b < 15) {
              change(next[id]!, { state: 'returning' })
              timers[id] = TAKES.robotHome
            }
          }
          if (d === 'switch') {
            const rated = Number(e.attributes.rated_power_w ?? 0)
            const w = Number(e.attributes.current_power_w ?? 0)
            const want = isOn(e) ? rated * (0.94 + Math.sin(performance.now() / 900) * 0.04) : 0
            change(e, { attributes: { current_power_w: Math.round(approach(w, want, 3, dt)) } })
          }
          if (d === 'water_heater') {
            const t = Number(e.attributes.current_temperature ?? 40)
            const want = e.state === 'off' ? 22 : Number(e.attributes.temperature ?? 55)
            change(e, { attributes: { current_temperature: Math.round(approach(t, want, e.state === 'performance' ? 0.05 : 0.025, dt) * 10) / 10 } })
          }
          if (d === 'media_player' && e.state === 'playing') {
            const pos = Number(e.attributes.media_position ?? 0) + dt
            const dur = Number(e.attributes.media_duration ?? 200)
            change(e, { attributes: { media_position: pos >= dur ? 0 : pos } })
          }
          // a device a button restarted comes back
          if (d === 'binary_sensor' && done && e.state === 'off') change(e, { state: 'on' })
          if (d === 'update' && e.attributes.in_progress) {
            const p = Number(e.attributes.update_percentage ?? 0) + dt * 14
            if (p >= 100) {
              change(e, { state: 'off', attributes: { in_progress: false, update_percentage: null, installed_version: e.attributes.latest_version } })
              set({ notice: { text: `${e.attributes.friendly_name} updated to ${e.attributes.latest_version}`, at: Date.now() } })
            } else change(e, { attributes: { update_percentage: p } })
          }
          if (d === 'timer_list') {
            type Timer = { id: string; name: string; duration: number; remaining: number; paused: boolean }
            const list = ((e.attributes._timers ?? []) as Timer[]).map((t) => (t.paused ? t : { ...t, remaining: t.remaining - dt }))
            const finished = list.filter((t) => t.remaining <= 0)
            const left = list.filter((t) => t.remaining > 0)
            if (finished.length) set({ notice: { text: `Timer “${finished[0]!.name}” is done`, at: Date.now() } })
            change(e, { state: String(left.length), attributes: { _timers: left } })
          }
          if (d === 'calendar') {
            type Ev = { summary: string; start: number; end: number; location?: string }
            const t = Date.now()
            const evs = ((e.attributes._events ?? []) as Ev[]).filter((v) => v.end > t).sort((a, b) => a.start - b.start)
            const cur = evs.find((v) => v.start <= t)
            const show = cur ?? evs[0]
            change(e, {
              state: cur ? 'on' : 'off',
              attributes: { message: show?.summary ?? null, start_time: show ? new Date(show.start).toISOString() : null, end_time: show ? new Date(show.end).toISOString() : null, location: show?.location ?? null },
            })
          }
          if (d === 'image_processing') {
            const watch = String(e.attributes._area ?? 'garden')
            const n = all.filter((p) => domainOf(p.entity_id) === 'person' && p.attributes._room === watch).length
            if (String(n) !== e.state) change(e, { state: String(n) })
          }
        }

        /* the rooms' air */
        const airNext: Record<string, AreaAir> = {}
        for (const [area, a] of Object.entries(was)) {
          const here = Object.values(next).filter((e) => areaOf[e.entity_id] === area)
          let temperature = approach(a.temperature, AMBIENT.temperature, 0.004, dt)
          let humidity = approach(a.humidity, AMBIENT.humidity, 0.006, dt)
          let carbon_dioxide = approach(a.carbon_dioxide, AMBIENT.carbon_dioxide, 0.01, dt)
          let pm25 = approach(a.pm25, AMBIENT.pm25, 0.01, dt)
          let volatile_organic_compounds = approach(a.volatile_organic_compounds, AMBIENT.volatile_organic_compounds, 0.01, dt)
          // light level: daylight through open covers, plus every light that is on
          const covers = here.filter((e) => domainOf(e.entity_id) === 'cover')
          const opening = covers.length ? Math.max(...covers.map((c) => Number(c.attributes.current_position ?? 100) / 100)) : 0.6
          let illuminance = get().daylight * opening * 650
          // noise: what a sensor a couple of metres from the room's noisy devices hears (−6 dB), plus
          // what comes through the walls from the other rooms (−24 dB), added as sound energy, the
          // same model the noise map draws
          const heard = Object.values(next).flatMap((e) => {
            const db = noiseOf(e)
            if (db == null || !areaOf[e.entity_id]) return []
            return [areaOf[e.entity_id] === area ? db - 6 : db - 24]
          })
          const sound = addDb([QUIET_DB, ...heard])
          for (const e of here) {
            const d = domainOf(e.entity_id)
            if (d === 'climate' && e.state !== 'off') {
              const k = climateStrength(e)
              const act = hvacAction({ ...e, attributes: { ...e.attributes, current_temperature: a.temperature } })
              const target = Number(e.attributes.temperature ?? 21)
              if (act === 'cooling' || act === 'heating') temperature = approach(temperature, target, 0.05 * k, dt)
              if (act === 'cooling') humidity = approach(humidity, 44, 0.02 * k, dt)
              if (act === 'drying') humidity = approach(humidity, 36, 0.05 * k, dt)
              pm25 = approach(pm25, 6, 0.02 * k, dt)
            }
            if (d === 'fan' && e.state === 'on') {
              const p = Number(e.attributes.percentage ?? 50) / 100
              carbon_dioxide = approach(carbon_dioxide, 620, 0.04 * p, dt)
              temperature = approach(temperature, temperature - 0.6, 0.01 * p, dt)
            }
            // a heater on a plug warms its room
            if (d === 'switch' && e.attributes.heats_room) temperature = approach(temperature, 31, 0.02 * (Number(e.attributes.current_power_w ?? 0) / 2000), dt)
            if (d === 'humidifier' && isOn(e)) humidity = approach(humidity, Number(e.attributes.humidity ?? 50) + 2, 0.03, dt)
            if (d === 'light' && isOn(e)) illuminance += (Number(e.attributes.brightness ?? 255) / 255) * 320
            if (d === 'climate' && e.state !== 'off') volatile_organic_compounds = approach(volatile_organic_compounds, 140, 0.015, dt)
            if (d === 'fan' && isOn(e)) volatile_organic_compounds = approach(volatile_organic_compounds, 200, 0.01, dt)
          }
          // a smoke alarm going off means smoke in the air
          if (here.some((e) => e.attributes.device_class === 'smoke' && tripped(e))) {
            pm25 = approach(pm25, 180, 0.2, dt)
            volatile_organic_compounds = approach(volatile_organic_compounds, 1800, 0.2, dt)
          }
          airNext[area] = { temperature, humidity, carbon_dioxide, pm25, volatile_organic_compounds, illuminance, sound_pressure: approach(a.sound_pressure, sound, 3, dt) }
        }

        /* sensors read their room; plugs report to their power sensors */
        for (const e of Object.values(next)) {
          const a = airNext[areaOf[e.entity_id] ?? '']
          const d = domainOf(e.entity_id)
          if (d === 'sensor') {
            const k = fieldOf(e)
            if (k && a) next[e.entity_id] = { ...e, state: a[k].toFixed(FIELDS[k].digits + 1) }
            const from = e.attributes.power_of as string | undefined
            if (from && next[from]) next[e.entity_id] = { ...e, state: String(next[from]!.attributes.current_power_w ?? 0) }
          } else if (d === 'climate' && a) {
            next[e.entity_id] = { ...e, attributes: { ...e.attributes, current_temperature: Math.round(a.temperature * 10) / 10, current_humidity: Math.round(a.humidity) } }
          } else if (d === 'humidifier' && a) {
            const want = Number(e.attributes.humidity ?? 50)
            next[e.entity_id] = { ...e, attributes: { ...e.attributes, current_humidity: Math.round(a.humidity), action: !isOn(e) ? 'off' : a.humidity < want - 1 ? 'humidifying' : 'idle' } }
          } else if (d === 'air_quality' && a) {
            next[e.entity_id] = { ...e, state: a.pm25.toFixed(0), attributes: { ...e.attributes, particulate_matter_10: Math.round(a.pm25 * 1.6) } }
          }
        }

        set({ air: airNext, entities: next })

        /* the home's automations */
        const find = (pred: (e: HassEntity) => boolean) => Object.values(get().entities).filter(pred)
        const alarm = find((e) => domainOf(e.entity_id) === 'alarm_control_panel')[0]
        const sirens = find((e) => domainOf(e.entity_id) === 'siren')
        const smoke = find((e) => domainOf(e.entity_id) === 'binary_sensor' && ['smoke', 'gas', 'carbon_monoxide'].includes(String(e.attributes.device_class)) && tripped(e))
        const leaks = find((e) => e.attributes.device_class === 'moisture' && tripped(e))
        const intrusion = find((e) => ['motion', 'door', 'window', 'glass_break'].includes(String(e.attributes.device_class)) && tripped(e))
        if (leaks.length) for (const v of find((e) => domainOf(e.entity_id) === 'valve' && e.attributes.device_class === 'water' && Number(e.attributes._target ?? e.attributes.current_position) > 0)) {
          automation('valve', 'close_valve', { entity_id: v.entity_id }, `Leak at ${leaks[0]!.attributes.friendly_name}: closing the water main`)
        }
        if (alarm && intrusion.length && ['armed_away', 'armed_night'].includes(alarm.state)) {
          put({ ...alarm, state: 'pending' }, alarm)
          timers[alarm.entity_id] = TAKES.entry
        }
        const wantSiren = smoke.length > 0 || alarm?.state === 'triggered'
        for (const s of sirens) {
          if (wantSiren && !isOn(s)) automation('siren', 'turn_on', { entity_id: s.entity_id, tone: smoke.length ? 'fire' : 'alarm', _auto: true }, smoke.length ? `${smoke[0]!.attributes.friendly_name}: sounding the siren` : 'Alarm triggered: sounding the siren')
          if (!wantSiren && isOn(s) && s.attributes._auto) automation('siren', 'turn_off', { entity_id: s.entity_id }, 'All clear: siren off')
        }
        // a camera records while something moves where it looks
        for (const c of find((e) => domainOf(e.entity_id) === 'camera' && e.state !== 'off')) {
          const sees = (c.attributes.watches as string[] | undefined)?.some((id) => {
            const w = get().entities[id]
            return w && (tripped(w) || w.state === 'mowing' || w.state === 'cleaning')
          })
          const want = c.attributes.motion_detection && sees ? 'recording' : 'streaming'
          if (c.state !== want) put({ ...c, state: want }, c)
        }
      },
    }
  })
}

/** One service call on one entity, the way Home Assistant's integrations answer it. */
function apply(e: HassEntity, domain: string, service: string, data: ServiceCall['data'], lastHvac: Record<string, string>, timers: Record<string, number>): HassEntity {
  const at = { ...e.attributes }
  const d = domainOf(e.entity_id)
  const with_ = (state: string, attrs: Record<string, unknown> = {}) => ({ ...e, state, attributes: { ...at, ...attrs } })

  // the lab's test switch for things only the world changes (smoke, water, motion, a door)
  if (domain === 'lab' && service === 'simulate') return with_(String(data.state))

  if (d === 'light') {
    if (service === 'turn_off') return with_('off')
    if (service === 'turn_on') {
      if (data.brightness_pct !== undefined) at.brightness = Math.round((Number(data.brightness_pct) / 100) * 255)
      if (data.brightness !== undefined) at.brightness = Number(data.brightness)
      if (data.color_temp_kelvin !== undefined) {
        at.color_temp_kelvin = Number(data.color_temp_kelvin)
        at.color_mode = 'color_temp'
      }
      if (data.rgb_color !== undefined) {
        at.rgb_color = data.rgb_color
        at.color_mode = 'rgb'
      }
      return with_('on')
    }
  }

  if (d === 'climate') {
    if (service === 'turn_off') return with_('off')
    if (service === 'turn_on') return with_(lastHvac[e.entity_id] ?? 'cool')
    if (service === 'set_hvac_mode') return with_(String(data.hvac_mode))
    if (service === 'set_temperature') return with_(e.state, { temperature: Number(data.temperature) })
    if (service === 'set_fan_mode') return with_(e.state, { fan_mode: data.fan_mode })
  }

  if (d === 'fan') {
    if (service === 'turn_off') return with_('off')
    if (service === 'turn_on') return with_('on', data.percentage !== undefined ? { percentage: Number(data.percentage) } : {})
    if (service === 'set_percentage') {
      const p = Number(data.percentage)
      return p === 0 ? with_('off') : with_('on', { percentage: p })
    }
    if (service === 'oscillate') return with_(e.state, { oscillating: !!data.oscillating })
    if (service === 'set_direction') return with_(e.state, { direction: data.direction })
  }

  if (d === 'cover' || d === 'valve') {
    const pos = Number(at.current_position ?? 0)
    const to = (target: number) => with_(target === pos ? e.state : target > pos ? 'opening' : 'closing', { _target: target })
    if (service === 'open_cover' || service === 'open_valve') return to(100)
    if (service === 'close_cover' || service === 'close_valve') return to(0)
    if (service === 'stop_cover' || service === 'stop_valve') return with_(pos === 0 ? 'closed' : 'open', { _target: pos })
    if (service === 'set_cover_position' || service === 'set_valve_position') return to(Number(data.position))
  }

  if (d === 'lock') {
    timers[e.entity_id] = TAKES.lock
    if (service === 'lock') return with_('locking')
    if (service === 'unlock') return with_('unlocking')
    if (service === 'open') return with_('opening')
  }

  if (d === 'alarm_control_panel') {
    if (service === 'alarm_disarm') {
      delete timers[e.entity_id]
      return with_('disarmed')
    }
    if (service === 'alarm_trigger') return with_('triggered')
    const mode = { alarm_arm_home: 'armed_home', alarm_arm_away: 'armed_away', alarm_arm_night: 'armed_night' }[service]
    if (mode) {
      timers[e.entity_id] = mode === 'armed_home' ? 1 : TAKES.arming
      return with_('arming', { _arm_to: mode })
    }
  }

  if (d === 'siren') {
    if (service === 'turn_off') return with_('off', { _auto: false })
    if (service === 'turn_on') return with_('on', { tone: data.tone ?? at.tone ?? 'alarm', _auto: !!data._auto })
  }

  if (d === 'media_player') {
    if (service === 'turn_off') return with_('off')
    if (service === 'turn_on') return with_('idle')
    if (service === 'media_play_pause') return with_(e.state === 'playing' ? 'paused' : 'playing')
    if (service === 'media_play') return with_('playing')
    if (service === 'media_pause') return with_('paused')
    if (service === 'volume_set') return with_(e.state, { volume_level: Number(data.volume_level), is_volume_muted: false })
    if (service === 'volume_mute') return with_(e.state, { is_volume_muted: !!data.is_volume_muted })
    if (service === 'select_source') return with_(e.state === 'off' ? 'idle' : e.state, { source: data.source })
    if (service === 'media_next_track' || service === 'media_previous_track') {
      const list = (at._playlist as { title: string; artist: string; duration: number }[] | undefined) ?? []
      const i = list.findIndex((t) => t.title === at.media_title)
      const n = list[(i + (service === 'media_next_track' ? 1 : list.length - 1)) % Math.max(1, list.length)]
      return n ? with_('playing', { media_title: n.title, media_artist: n.artist, media_duration: n.duration, media_position: 0 }) : e
    }
  }

  if (d === 'camera') {
    if (service === 'turn_off') return with_('off')
    if (service === 'turn_on') return with_('streaming')
    if (service === 'enable_motion_detection') return with_(e.state, { motion_detection: true })
    if (service === 'disable_motion_detection') return with_(e.state, { motion_detection: false })
  }

  if (d === 'vacuum' || d === 'lawn_mower') {
    const work = d === 'vacuum' ? 'cleaning' : 'mowing'
    if (service === 'start' || service === 'start_mowing') return with_(work)
    if (service === 'pause') return with_('paused')
    if (service === 'stop') return with_('idle')
    if (service === 'return_to_base' || service === 'dock') {
      timers[e.entity_id] = TAKES.robotHome
      return with_('returning')
    }
    if (service === 'set_fan_speed') return with_(e.state, { fan_speed: data.fan_speed })
    if (service === 'locate') return with_(e.state, { _locate: Date.now() })
  }

  if (d === 'water_heater') {
    if (service === 'turn_off') return with_('off')
    if (service === 'turn_on') return with_(String(at._last_mode ?? 'eco'))
    if (service === 'set_operation_mode') return with_(String(data.operation_mode), data.operation_mode !== 'off' ? { _last_mode: data.operation_mode } : {})
    if (service === 'set_temperature') return with_(e.state, { temperature: Number(data.temperature) })
  }

  if (d === 'assist_satellite') {
    if (service === 'start_conversation' || service === 'announce') {
      timers[e.entity_id] = service === 'announce' ? TAKES.respond : TAKES.listen
      return with_(service === 'announce' ? 'responding' : 'listening', data.message ? { _said: data.message } : {})
    }
  }

  if (d === 'humidifier') {
    if (service === 'turn_off') return with_('off')
    if (service === 'turn_on') return with_('on')
    if (service === 'set_humidity') return with_('on', { humidity: Number(data.humidity) })
    if (service === 'set_mode') return with_(e.state, { mode: data.mode })
  }

  // the lab moves people between rooms, or out of the house
  if ((d === 'person' || d === 'device_tracker') && domain === 'lab' && service === 'move') {
    const room = String(data.room)
    return with_(room === 'not_home' ? 'not_home' : 'home', { _room: room === 'not_home' ? null : room })
  }

  const stamp = new Date().toISOString()
  if (d === 'remote') {
    if (service === 'turn_off') return with_('off')
    if (service === 'turn_on') return with_('on', data.activity ? { current_activity: data.activity } : {})
    if (service === 'send_command') return with_(e.state === 'off' ? 'on' : e.state, { _sent: Date.now(), _command: data.command })
  }
  if ((d === 'infrared' || d === 'radio_frequency') && service === 'send_command') return with_(stamp, { _sent: Date.now(), _command: data.command })
  if (d === 'button' && service === 'press') return with_(stamp)
  if (d === 'scene' && service === 'turn_on') return with_(stamp)
  if (d === 'notify' && service === 'send_message') return with_(stamp, { _last: data.message })
  if (d === 'tts' && service === 'speak') return with_(stamp)
  if (d === 'conversation' && service === 'process') return with_(stamp, { _last: data.text })
  if (d === 'ai_task' && service === 'generate_data') return with_(stamp)
  if (d === 'wake_word' && service === 'detect') return with_(stamp)
  if (d === 'event' && domain === 'lab' && service === 'fire') return with_(stamp, { event_type: data.event_type })
  if (d === 'weather' && domain === 'lab' && service === 'set_condition') return with_(String(data.condition))
  if (d === 'number' && service === 'set_value') return with_(String(data.value))
  if (d === 'select' && service === 'select_option') return with_(String(data.option))
  if ((d === 'text' || d === 'date' || d === 'time' || d === 'datetime') && service === 'set_value') return with_(String(data.value ?? data.date ?? data.time ?? data.datetime))
  if (d === 'update') {
    if (service === 'install') return with_(e.state, { in_progress: true, update_percentage: 0 })
    if (service === 'skip') return with_('off', { skipped_version: at.latest_version })
  }
  if (d === 'todo') {
    type Item = { summary: string; status: 'needs_action' | 'completed' }
    let items = [...((at._items ?? []) as Item[])]
    if (service === 'add_item') items.push({ summary: String(data.item), status: 'needs_action' })
    if (service === 'update_item') items = items.map((i) => (i.summary === data.item ? { ...i, status: data.status as Item['status'] } : i))
    if (service === 'remove_item') items = items.filter((i) => i.summary !== data.item)
    if (service === 'remove_completed_items') items = items.filter((i) => i.status !== 'completed')
    return with_(String(items.filter((i) => i.status === 'needs_action').length), { _items: items })
  }
  if (d === 'calendar' && service === 'create_event') {
    const start = Date.now() + Number(data.in_minutes ?? 30) * 60_000
    const evs = [...((at._events ?? []) as unknown[]), { summary: String(data.summary), start, end: start + 60 * 60_000 }]
    return with_(e.state, { _events: evs })
  }
  if (d === 'timer_list') {
    type Timer = { id: string; name: string; duration: number; remaining: number; paused: boolean }
    let list = [...((at._timers ?? []) as Timer[])]
    if (service === 'create_timer') {
      const secs = Number(data.seconds ?? 300)
      list.push({ id: `t${Date.now()}`, name: String(data.name || 'Timer'), duration: secs, remaining: secs, paused: false })
    }
    if (service === 'pause_timer' || service === 'unpause_timer') list = list.map((t) => (t.id === data.timer_id ? { ...t, paused: service === 'pause_timer' } : t))
    if (service === 'cancel_timer' || service === 'remove_timer' || service === 'finish_timer') list = list.filter((t) => t.id !== data.timer_id)
    if (service === 'add_time') list = list.map((t) => (t.id === data.timer_id ? { ...t, remaining: t.remaining + Number(data.seconds ?? 60) } : t))
    return with_(String(list.length), { _timers: list })
  }
  if (d === 'image' && domain === 'lab' && service === 'snapshot') return with_(stamp, { _caption: data.caption, _seed: Math.random() })

  if (service === 'turn_off') return with_('off')
  if (service === 'turn_on') return with_('on')
  return e
}

/** Assist, in miniature: a few of Home Assistant's built-in sentences, answered from the home. */
function converse(text: string, entities: HassEntities, run: (d: string, s: string, data: ServiceCall['data']) => unknown) {
  const t = text.toLowerCase().trim()
  const all = Object.values(entities)
  // a name matches when every word said appears in it: "studio fan" finds "Studio ceiling fan"
  const named = (said: string) => {
    const words = said.trim().split(/\s+/)
    return all.find((e) => {
      const name = String(e.attributes.friendly_name ?? '').toLowerCase()
      return words.every((w) => name.includes(w))
    })
  }
  let m = t.match(/^turn (on|off) (?:the )?(.+)$/)
  if (m) {
    const e = named(m[2]!)
    if (!e) return `I couldn't find “${m[2]}”.`
    run(domainOf(e.entity_id), m[1] === 'on' ? 'turn_on' : 'turn_off', { entity_id: e.entity_id })
    return `Turned ${m[1]} ${e.attributes.friendly_name}.`
  }
  m = t.match(/^(lock|unlock) (?:the )?(.+)$/)
  if (m) {
    const e = all.find((x) => domainOf(x.entity_id) === 'lock' && String(x.attributes.friendly_name).toLowerCase().includes(m![2]!.replace(' lock', '')))
    if (!e) return `I couldn't find a lock called “${m[2]}”.`
    run('lock', m[1]!, { entity_id: e.entity_id })
    return `${m[1] === 'lock' ? 'Locking' : 'Unlocking'} ${e.attributes.friendly_name}.`
  }
  m = t.match(/(?:what(?:'s| is) the )?temperature in (?:the )?(.+?)\??$/)
  if (m) {
    const e = all.find((x) => x.attributes.device_class === 'temperature' && String(x.attributes.friendly_name).toLowerCase().includes(m![1]!))
    return e ? `It's ${Number(e.state).toFixed(1)} °C in the ${m[1]}.` : `I don't have a temperature for “${m[1]}”.`
  }
  if (/who(?:'s| is) home/.test(t)) {
    const home = all.filter((e) => domainOf(e.entity_id) === 'person' && e.state === 'home').map((e) => e.attributes.friendly_name)
    return home.length ? `${home.join(' and ')} ${home.length > 1 ? 'are' : 'is'} home.` : 'Nobody is home.'
  }
  return "Sorry, I didn't understand that. Try “turn off the lounge pendant”, “lock the front door”, “temperature in the studio” or “who is home”."
}

/** The AI task's answer: a short summary of the home, as a model would write it from the states. */
function summarise(entities: HassEntities, air: Record<string, AreaAir>) {
  const all = Object.values(entities)
  const lights = all.filter((e) => domainOf(e.entity_id) === 'light' && isOn(e)).length
  const open = all.filter((e) => ['door', 'window'].includes(String(e.attributes.device_class)) && tripped(e)).length
  const people = all.filter((e) => domainOf(e.entity_id) === 'person' && e.state === 'home').length
  const rooms = Object.entries(air).map(([k, a]) => `${k} ${a.temperature.toFixed(1)}°`).join(', ')
  return `${people} ${people === 1 ? 'person' : 'people'} home, ${lights} lights on, ${open ? `${open} doors or windows open` : 'everything closed'}. Rooms: ${rooms}.`
}

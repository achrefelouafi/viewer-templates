import { useViewer } from '@pascal-app/viewer'
import { Button, type ViewerSource } from '@pascal-app/viewer/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { type Area, domainOf, type FieldKind, type HomeDevice } from './entities'
import { useHass } from './hass/connection'
import { HomeEffects, type PinRefs } from './HomeEffects'
import { HomePanel } from './HomePanel'
import { anchorOf, entityInfos, type Link, linkHome, type LinkReport, wantsOf } from './link/match'
import { formatReport } from './link/report'
import { type GraphNodes, polygonOf, readThings, type Room, type Thing } from './link/scene'
import { normalize } from './link/words'
import { HomeNoir } from './sketch/HomeNoir'

/* Home Assistant on a Pascal project: the visitor connects their own Home Assistant, its entities
   are linked to the plan's items (src/home/link), and the linked items get their effects, pins and
   controls while the rest of the plan is drawn as the guided tour's wireframe. Links the matching
   could not settle are put to the visitor; their answers are kept in this browser, per project. */

const FLOOR_Y = 0.05

/** Things that control a device elsewhere: they get a pin and controls, never the device's effect
    (a wall thermostat blows no air). */
const QUIET_KINDS: ReadonlySet<string> = new Set(['thermostat', 'keypad', 'plug', 'sensor', 'other'])

/** What the plan leaves out, as the lab has none: the ceilings over every room (the fans and lights
    hung from them still draw), and the editor's start marker. */
const HIDDEN_KINDS: ReadonlySet<string> = new Set(['ceiling', 'ceiling-grid', 'spawn'])

/** Answers the visitor gave, kept in this browser per project and Home Assistant. */
function useAnswers<T>(kind: string, projectId: string, hassUrl: string) {
  const key = `pascal-ha-${kind}:${projectId}:${hassUrl}`
  const read = () => JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, T>
  const [answers, setAnswers] = useState<Record<string, T>>(read)
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a new key only
  useEffect(() => setAnswers(read()), [key])
  const answer = useCallback((name: string, value: T) => {
    setAnswers((a) => {
      const next = { ...a, [name]: value }
      localStorage.setItem(key, JSON.stringify(next))
      return next
    })
  }, [key])
  const forget = useCallback((name: string) => {
    setAnswers((a) => {
      const next = { ...a }
      delete next[name]
      localStorage.setItem(key, JSON.stringify(next))
      return next
    })
  }, [key])
  return { answers, answer, forget }
}

/** The visitor's links over the matching's: entity → the thing it drives, or null for none. A
    link made by hand takes the thing from whatever the matching had put there in its domain. */
function withPicks(report: LinkReport, picks: Record<string, string | null>): Link[] {
  const handled = new Set(Object.entries(picks).flatMap(([id, thing]) => (thing ? [`${thing}|${domainOf(id)}`] : [])))
  return report.links.map((l): Link => {
    if (l.entityId in picks) {
      const thingId = picks[l.entityId]
      return thingId
        ? { ...l, status: 'sure', thingId, why: 'you linked it' }
        : { ...l, status: 'missing', thingId: undefined, why: 'you unlinked it' }
    }
    if (l.thingId && handled.has(`${l.thingId}|${domainOf(l.entityId)}`)) {
      return { ...l, status: 'unplaced', thingId: undefined, why: 'you linked another device to its thing' }
    }
    return l
  })
}

/** A room's floor rectangle, for the room readings. */
function areasOf(nodes: GraphNodes): Area[] {
  return Object.values(nodes).flatMap((n) => {
    if (n?.type !== 'zone') return []
    const poly = polygonOf(n)
    if (!poly.length) return []
    const xs = poly.map((p) => p[0])
    const zs = poly.map((p) => p[1])
    return [{ id: n.id, name: n.name ?? n.id, bounds: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] as Area['bounds'] }]
  })
}

/** Where a thing is drawn: the middle of its drawn model, else where the graph puts it. */
function drawnCentre(source: ViewerSource, t: Thing): [number, number, number] {
  const object = source.objectFor(t.id)
  if (!object) return t.position
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return t.position
  const c = box.getCenter(new THREE.Vector3())
  return [c.x, c.y, c.z]
}

/** A question the linking leaves to the visitor: which room an area is, or which thing an entity drives. */
export type Question =
  | { kind: 'area'; area: string; choices: Room[]; devices: number }
  | { kind: 'entity'; link: Link }

export type HomeLayer = ReturnType<typeof useHomeLayer>

/**
 * Everything the project viewer needs to put Home Assistant on its plan.
 * @param ready the scene is drawn, so drawn positions can be read
 */
export function useHomeLayer({ projectId, source, ready }: { projectId: string; source: ViewerSource; ready: boolean }) {
  const status = useHass((s) => s.status)
  const entities = useHass((s) => s.entities)
  const areaOf = useHass((s) => s.areaOf)
  const hassUrl = useHass((s) => s.hassUrl)
  useEffect(() => {
    void useHass.getState().resume()
    // development builds only: the connection's store on `window.__hass`, for debugging
    if (import.meta.env.DEV) (window as unknown as { __hass: unknown }).__hass = useHass
  }, [])
  const linkAnswers = useAnswers<string | null>('links', projectId, hassUrl)
  const roomAnswers = useAnswers<string | null>('areas', projectId, hassUrl)
  const picks = linkAnswers.answers

  const nodes = source.nodes as unknown as GraphNodes
  // items linked by hand are read even where the word table finds no device in them
  const include = useMemo(() => new Set(Object.values(picks).flatMap((t) => (t ? [t] : []))), [picks])
  const plan = useMemo(() => readThings(nodes, { include }), [nodes, include])
  const areas = useMemo(() => areasOf(nodes), [nodes])
  // which entities there are and where, not their states: the links stay put as states change
  const entityKey = useMemo(() => Object.keys(entities).sort().join(','), [entities])
  const infos = useMemo(
    () => entityInfos(useHass.getState().entities, (id) => areaOf[id]),
    // biome-ignore lint/correctness/useExhaustiveDependencies: on new entities, not new states
    [entityKey, areaOf],
  )
  const report = useMemo(() => linkHome(plan.things, infos, plan.rooms, roomAnswers.answers), [plan, infos, roomAnswers.answers])
  const links = useMemo(() => withPicks(report, picks), [report, picks])

  const devices = useMemo<HomeDevice[]>(() => {
    if (!ready) return []
    const byId = new Map(plan.things.map((t) => [t.id, t]))
    const areaById = new Map(areas.map((a) => [a.id, a]))
    return links.flatMap((l): HomeDevice[] => {
      const t = l.thingId ? byId.get(l.thingId) : undefined
      if (t) {
        const anchor = anchorOf(t, l.roomId ?? t.rooms[0]?.id ?? 'home')
        return [{ entityId: l.entityId, nodeId: t.id, anchor: { ...anchor, position: drawnCentre(source, t) }, ...(QUIET_KINDS.has(t.kind) ? { effect: 'none' as const } : {}) }]
      }
      // what reads its room (a thermometer): a pin in the room. A device the plan does not draw stays
      // off the plan (the panel's Home tab), never an effect in mid-air
      const area = l.roomId ? areaById.get(l.roomId) : undefined
      if (!area || l.status !== 'room') return []
      const [x0, z0, x1, z1] = area.bounds
      return [{ entityId: l.entityId, anchor: { position: [(x0 + x1) / 2, 1.5, (z0 + z1) / 2], rotationY: 0, mount: 'wall', area: area.id } }]
    })
  }, [ready, links, plan, areas, source])

  const kept = useMemo(() => new Set(devices.flatMap((d) => (d.nodeId ? [d.nodeId] : []))), [devices])

  // development builds only: the linking on `window.__homeLinks()`, printed as the test prints it
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const found = new Set(plan.things.map((t) => t.id))
    // and the items it found nothing in, with what their catalog calls them, to grow the word table
    const others = Object.values(nodes).flatMap((n) =>
      n?.type === 'item' && !found.has(n.id) ? [`${n.name || n.asset?.name} · ${n.asset?.category ?? ''}${n.asset?.attachTo ? ` · ${n.asset.attachTo}` : ''}`] : [])
    ;(window as unknown as { __homeLinks: () => void }).__homeLinks = () =>
      console.log(formatReport({ ...report, links }, plan.things), { things: plan.things, links, others })
  }, [report, links, plan, nodes])

  // the questions: rooms first (one answer can place several devices), then single devices
  const questions = useMemo<Question[]>(() => {
    const placeable = new Set(links.filter((l) => l.status !== 'home').map((l) => l.entityId))
    const count = (area: string) => infos.filter((e) => e.area === area && placeable.has(e.entity_id)).length
    const rooms = report.areas
      .filter((a) => (a.how === 'unsure' || a.how === 'none') && count(a.area) > 0)
      .map((a): Question => ({ kind: 'area', area: a.area, choices: a.choices, devices: count(a.area) }))
    return [...rooms, ...links.filter((l) => l.status === 'ask').map((link): Question => ({ kind: 'entity', link }))]
  }, [report, links, infos])

  return {
    status, connected: status === 'connected', entities, devices, areas, kept, links, questions, infos, things: plan.things, rooms: plan.rooms, source,
    /** Links an entity to a thing by hand, or to nothing. */
    pick: linkAnswers.answer,
    /** Takes back a hand-made link: the matching decides again. */
    unpick: linkAnswers.forget,
    /** Says which room a Home Assistant area is, or null for none of the plan's. */
    placeArea: roomAnswers.answer,
  }
}

/** Inside the viewer's canvas: the wireframe over all but the linked items, and their effects. */
export function HomeScene({ home, pins, selected, layer, onPress }: {
  home: HomeLayer
  pins: PinRefs
  selected: string | null
  layer: FieldKind | null
  onPress: (entityId: string) => void
}) {
  return (
    <>
      <HomeNoir hide={HIDDEN_KINDS} keep={home.kept} source={home.source} />
      {home.connected && <HomeEffects devices={home.devices} areas={home.areas} entities={home.entities} layer={layer} floorY={FLOOR_Y} pins={pins} selected={selected} onPress={onPress} />}
    </>
  )
}

/** Over the viewer: the connect button, the devices panel, and the questions the linking left. */
export function HomeOverlay({ home, title, pins, selected, layer, onSelect, onLayer, onGroup, itemId = null, onCloseItem }: {
  home: HomeLayer
  title: string
  pins: PinRefs
  selected: string | null
  layer: FieldKind | null
  onSelect: (entityId: string | null) => void
  onLayer: (layer: FieldKind | null) => void
  /** A grouped pin was clicked: the devices under it, for the camera to zoom in on. */
  onGroup?: (entityIds: string[]) => void
  /** An item clicked on the plan, whose links the link card shows. */
  itemId?: string | null
  onCloseItem?: () => void
}) {
  const call = useHass((s) => s.call)
  return (
    <>
      {home.connected && (
        <HomePanel title={title} devices={home.devices} areas={home.areas} entities={home.entities} selected={selected} lastCall={null} notice={null}
          layer={layer} pins={pins} onSelect={onSelect} call={(d, s, data) => call(d, s, data)} onLayer={onLayer} {...(onGroup ? { onGroup } : {})} />
      )}
      <ConnectCard home={home} />
      {/* the cards sit where a device's controls open, so not while one is open */}
      {home.connected && !selected && itemId && (
        <LinkCard home={home} itemId={itemId} key={itemId} onClose={() => onCloseItem?.()} />
      )}
      {home.connected && !selected && !itemId && home.questions.length > 0 && <QuestionCard home={home} />}
    </>
  )
}

function ConnectCard({ home }: { home: HomeLayer }) {
  const { status, error, hassUrl, signIn, disconnect } = useHass()
  const [address, setAddress] = useState(hassUrl)
  useEffect(() => setAddress(hassUrl), [hassUrl])
  const busy = status === 'redirecting' || status === 'connecting'
  const linked = home.links.filter((l) => l.thingId).length

  if (home.connected) {
    return (
      <div className="pointer-events-auto absolute bottom-4 left-4 z-30 flex items-center gap-2 rounded-full border border-border/60 bg-background/95 py-1.5 pr-1.5 pl-4 text-sm shadow-lg backdrop-blur">
        <i className="size-2 rounded-full bg-[#3ddc97]" />
        <span className="text-muted-foreground">Home Assistant</span>
        <b className="font-medium">{linked} linked</b>
        <Button className="rounded-full" onClick={disconnect} size="sm" variant="ghost">Disconnect</Button>
      </div>
    )
  }
  return (
    // where the devices panel will be once connected, as in the lab
    <div className="pointer-events-auto absolute top-4 left-4 z-30 w-[min(18rem,calc(100vw-2rem))]">
      <form
          className="grid gap-3 rounded-2xl border border-border/60 bg-background/95 p-4 text-sm shadow-lg backdrop-blur"
          onSubmit={(ev) => {
            ev.preventDefault()
            void signIn(address)
          }}
        >
          <div className="grid gap-1">
            <b className="font-medium">Connect Home Assistant</b>
            <span className="text-muted-foreground text-xs">Your Home Assistant's address, as you open it in this browser. You sign in on its own page.</span>
          </div>
          <input
            aria-label="Home Assistant address"
            className="h-9 rounded-full border border-border bg-background px-3.5 outline-none focus:border-foreground/40"
            disabled={busy}
            onChange={(ev) => setAddress(ev.target.value)}
            placeholder="https://myhome.duckdns.org"
            value={address}
          />
          <p aria-live="polite" className="min-h-4 text-[#ff4d4f] text-xs" role="alert">{error}</p>
          <div className="flex justify-end gap-2">
            <Button className="rounded-full" disabled={busy || !address.trim()} size="sm" type="submit">
              {status === 'redirecting' ? 'Opening sign-in…' : status === 'connecting' ? 'Connecting…' : 'Sign in'}
            </Button>
          </div>
        </form>
    </div>
  )
}

/** A card on the right, where a device's controls open. */
const CARD = 'pointer-events-auto absolute top-[var(--card-top,1rem)] right-[var(--card-right,1rem)] z-30 grid w-[min(20rem,calc(100vw-2rem))] gap-3 rounded-2xl border border-border/60 bg-background/95 p-4 text-sm shadow-lg backdrop-blur'
const ROW = 'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-foreground/8'

/** Lights up a thing on the plan while a choice is pointed at, as Pascal's own hover does. */
function useHoverThing() {
  const hovered = useRef<string | null>(null)
  useEffect(() => () => void (hovered.current && useViewer.getState().setHoveredId(null)), [])
  return (id: string | null) => {
    hovered.current = id
    useViewer.getState().setHoveredId(id as never)
  }
}

/** The questions the linking left: which room an area is, then which thing a device drives. */
function QuestionCard({ home }: { home: HomeLayer }) {
  const call = useHass((s) => s.call)
  const byId = useMemo(() => new Map(home.things.map((t) => [t.id, t])), [home.things])
  const [index, setIndex] = useState(0)
  const hover = useHoverThing()
  const at = Math.min(index, home.questions.length - 1)
  const q = home.questions[at]
  if (!q) return null
  const counter = <span className="font-mono text-muted-foreground text-xs">{at + 1}/{home.questions.length}</span>
  const later = home.questions.length > 1 && (
    <Button className="rounded-full" onClick={() => setIndex((i) => (i + 1) % home.questions.length)} size="sm" variant="ghost">Later</Button>
  )

  if (q.kind === 'area') {
    return (
      <div className={CARD}>
        <div className="flex items-baseline justify-between gap-2">
          <b className="font-medium">Which room is "{q.area}"?</b>
          {counter}
        </div>
        <span className="text-muted-foreground text-xs">
          {q.devices} {q.devices === 1 ? 'device' : 'devices'} in this Home Assistant area. {q.choices.length < home.rooms.length ? 'It could be more than one room of your plan.' : 'No room of your plan has that name.'}
        </span>
        <ul className="ui-scroll grid max-h-64 gap-1 overflow-y-auto">
          {q.choices.map((room) => (
            <li key={room.id}>
              <button className={ROW} onClick={() => home.placeArea(q.area, room.id)} type="button">{room.name}</button>
            </li>
          ))}
        </ul>
        <div className="flex justify-between gap-2">
          <Button className="rounded-full" onClick={() => home.placeArea(q.area, null)} size="sm" variant="ghost">None of these</Button>
          {later}
        </div>
      </div>
    )
  }

  const { link } = q
  const name = home.entities[link.entityId]?.attributes.friendly_name ?? link.entityId
  const canBlink = ['light', 'switch', 'fan', 'media_player'].includes(domainOf(link.entityId))
  return (
    <div className={CARD}>
      <div className="flex items-baseline justify-between gap-2">
        <b className="font-medium">Which one is {name}?</b>
        {counter}
      </div>
      {canBlink && (
        <Button className="justify-self-start rounded-full" onClick={() => blink(call, link.entityId)} size="sm" variant="secondary">
          Blink it in your home
        </Button>
      )}
      <ul className="grid gap-1">
        {link.candidates.map((c) => {
          const t = byId.get(c.thingId)
          return (
            <li key={c.thingId}>
              <button className={ROW} onBlur={() => hover(null)} onClick={() => { hover(null); home.pick(link.entityId, c.thingId) }}
                onFocus={() => hover(c.thingId)} onMouseEnter={() => hover(c.thingId)} onMouseLeave={() => hover(null)} type="button">
                <span className="truncate">{t?.label ?? c.thingId}</span>
                <span className="shrink-0 text-muted-foreground text-xs">{t?.rooms.map((r) => r.name).join(', ')}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex justify-between gap-2">
        <Button className="rounded-full" onClick={() => home.pick(link.entityId, null)} size="sm" variant="ghost">Not in the plan</Button>
        {later}
      </div>
    </div>
  )
}

/** An item picked on the plan: the devices it drives, and any device of the home to link to it. */
function LinkCard({ home, itemId, onClose }: { home: HomeLayer; itemId: string; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const node = (home.source.nodes as unknown as GraphNodes)[itemId]
  const thing = home.things.find((t) => t.id === itemId)
  const label = thing?.label ?? node?.name ?? node?.asset?.name ?? 'This item'
  const rooms = thing?.rooms ?? []
  const linked = home.links.filter((l) => l.thingId === itemId)
  const nameOfEntity = (id: string) => home.entities[id]?.attributes.friendly_name ?? id
  // what could be linked: devices (not people, scenes or the weather), the likeliest first
  const choices = useMemo(() => {
    const words = normalize(query)
    const roomNames = new Set(rooms.map((r) => r.name))
    const placeable = new Set(home.links.filter((l) => l.status !== 'home' && l.thingId !== itemId).map((l) => l.entityId))
    return home.infos
      .filter((e) => placeable.has(e.entity_id) && (!words || normalize(`${e.name} ${e.entity_id}`).includes(words)))
      .map((e) => {
        const wants = wantsOf(e)
        const fits = thing && wants.place === 'thing' && (wants.kinds.includes(thing.kind) || wants.also?.includes(thing.kind))
        const here = home.links.find((l) => l.entityId === e.entity_id)?.roomId
        const sameRoom = rooms.some((r) => r.id === here) || (e.area !== undefined && roomNames.has(e.area))
        return { e, score: (fits ? 2 : 0) + (sameRoom ? 1 : 0) }
      })
      .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name))
      .slice(0, 8)
  }, [query, home.infos, home.links, itemId, rooms, thing])

  return (
    <div className={CARD}>
      <div className="flex items-start justify-between gap-2">
        <div className="grid min-w-0">
          <b className="truncate font-medium">{label}</b>
          <span className="text-muted-foreground text-xs">{rooms.map((r) => r.name).join(', ') || 'Outside any room'}</span>
        </div>
        <Button className="rounded-full" onClick={onClose} size="sm" variant="ghost">Close</Button>
      </div>
      {linked.length > 0 && (
        <ul className="grid gap-1">
          {linked.map((l) => (
            <li className="flex items-center justify-between gap-2 rounded-xl bg-foreground/5 px-3 py-2" key={l.entityId}>
              <span className="truncate">{nameOfEntity(l.entityId)}</span>
              <Button className="rounded-full" onClick={() => home.pick(l.entityId, null)} size="sm" variant="ghost">Unlink</Button>
            </li>
          ))}
        </ul>
      )}
      <input
        aria-label="Find a device to link"
        className="h-9 rounded-full border border-border bg-background px-3.5 outline-none focus:border-foreground/40"
        onChange={(ev) => setQuery(ev.target.value)}
        placeholder={linked.length ? 'Link another device…' : 'Link a device…'}
        value={query}
      />
      <ul className="ui-scroll grid max-h-64 gap-1 overflow-y-auto">
        {choices.map(({ e }) => (
          <li key={e.entity_id}>
            <button className={ROW} onClick={() => home.pick(e.entity_id, itemId)} type="button">
              <span className="truncate">{e.name}</span>
              <span className="shrink-0 text-muted-foreground text-xs">{e.area ?? 'No area'}</span>
            </button>
          </li>
        ))}
        {!choices.length && <li className="px-3 py-2 text-muted-foreground text-xs">No device matches.</li>}
      </ul>
    </div>
  )
}

/** Makes a device show itself for a moment: a light flashes, anything else toggles twice. */
function blink(call: (domain: string, service: string, data: Record<string, unknown>) => void, entityId: string) {
  const domain = domainOf(entityId)
  if (domain === 'light') return call('light', 'turn_on', { entity_id: entityId, flash: 'short' })
  call('homeassistant', 'toggle', { entity_id: entityId })
  window.setTimeout(() => call('homeassistant', 'toggle', { entity_id: entityId }), 1500)
}

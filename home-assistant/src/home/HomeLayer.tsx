import { useViewer } from '@pascal-app/viewer'
import { Button, type ViewerSource } from '@pascal-app/viewer/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { type Area, domainOf, type FieldKind, type HomeDevice } from './entities'
import { useHass } from './hass/connection'
import { HomeEffects, type PinRefs } from './HomeEffects'
import { HomePanel } from './HomePanel'
import { anchorOf, entityInfos, type Link, linkHome, type LinkReport } from './link/match'
import { formatReport } from './link/report'
import { type GraphNodes, polygonOf, readThings, type Thing } from './link/scene'
import { HomeNoir } from './sketch/HomeNoir'

/* Home Assistant on a Pascal project: the visitor connects their own Home Assistant, its entities
   are linked to the plan's items (src/home/link), and the linked items get their effects, pins and
   controls while the rest of the plan is drawn as the guided tour's wireframe. Links the matching
   could not settle are put to the visitor; their answers are kept in this browser, per project. */

const FLOOR_Y = 0.05

/** The visitor's own answers: entity → the thing it drives, or null for "not in the plan". */
type Picks = Record<string, string | null>
const picksKey = (projectId: string, hassUrl: string) => `pascal-ha-links:${projectId}:${hassUrl}`

function usePicks(projectId: string, hassUrl: string) {
  const key = picksKey(projectId, hassUrl)
  const [picks, setPicks] = useState<Picks>(() => JSON.parse(localStorage.getItem(key) ?? '{}') as Picks)
  useEffect(() => setPicks(JSON.parse(localStorage.getItem(key) ?? '{}') as Picks), [key])
  const pick = useCallback((entityId: string, thingId: string | null) => {
    setPicks((p) => {
      const next = { ...p, [entityId]: thingId }
      localStorage.setItem(key, JSON.stringify(next))
      return next
    })
  }, [key])
  const forget = useCallback(() => {
    localStorage.removeItem(key)
    setPicks({})
  }, [key])
  return { picks, pick, forget }
}

/** The visitor's answers over the matching's. */
function withPicks(report: LinkReport, picks: Picks): Link[] {
  return report.links.map((l) => {
    if (!(l.entityId in picks)) return l
    const thingId = picks[l.entityId]
    return thingId
      ? { ...l, status: 'sure', thingId, why: 'you picked it' }
      : { ...l, status: 'missing', thingId: undefined, why: 'you said it is not in the plan' }
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
  const { picks, pick, forget } = usePicks(projectId, hassUrl)

  const nodes = source.nodes as unknown as GraphNodes
  const plan = useMemo(() => readThings(nodes), [nodes])
  const areas = useMemo(() => areasOf(nodes), [nodes])
  // which entities there are and where, not their states: the links stay put as states change
  const entityKey = useMemo(() => Object.keys(entities).sort().join(','), [entities])
  const report = useMemo(() => {
    const infos = entityInfos(useHass.getState().entities, (id) => areaOf[id])
    return linkHome(plan.things, infos, plan.rooms)
    // biome-ignore lint/correctness/useExhaustiveDependencies: on new entities, not new states
  }, [plan, entityKey, areaOf])
  const links = useMemo(() => withPicks(report, picks), [report, picks])

  const devices = useMemo<HomeDevice[]>(() => {
    if (!ready) return []
    const byId = new Map(plan.things.map((t) => [t.id, t]))
    const areaById = new Map(areas.map((a) => [a.id, a]))
    return links.flatMap((l): HomeDevice[] => {
      const t = l.thingId ? byId.get(l.thingId) : undefined
      if (t) {
        const anchor = anchorOf(t, l.roomId ?? t.rooms[0]?.id ?? 'home')
        return [{ entityId: l.entityId, nodeId: t.id, anchor: { ...anchor, position: drawnCentre(source, t) } }]
      }
      // what reads its room (a thermometer), and what the plan does not draw: a pin in the room
      const area = l.roomId ? areaById.get(l.roomId) : undefined
      if (!area || (l.status !== 'room' && l.status !== 'missing')) return []
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
  const asking = useMemo(() => links.filter((l) => l.status === 'ask'), [links])
  return { status, connected: status === 'connected', entities, devices, areas, kept, links, asking, things: plan.things, pick, forget, source }
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
      <HomeNoir source={home.source} keep={home.kept} />
      {home.connected && <HomeEffects devices={home.devices} areas={home.areas} entities={home.entities} layer={layer} floorY={FLOOR_Y} pins={pins} selected={selected} onPress={onPress} />}
    </>
  )
}

/** Over the viewer: the connect button, the devices panel, and the questions the linking left. */
export function HomeOverlay({ home, title, pins, selected, layer, onSelect, onLayer, onGroup }: {
  home: HomeLayer
  title: string
  pins: PinRefs
  selected: string | null
  layer: FieldKind | null
  onSelect: (entityId: string | null) => void
  onLayer: (layer: FieldKind | null) => void
  /** A grouped pin was clicked: the devices under it, for the camera to zoom in on. */
  onGroup?: (entityIds: string[]) => void
}) {
  const call = useHass((s) => s.call)
  return (
    <>
      {home.connected && (
        <HomePanel title={title} devices={home.devices} areas={home.areas} entities={home.entities} selected={selected} lastCall={null} notice={null}
          layer={layer} pins={pins} onSelect={onSelect} call={(d, s, data) => call(d, s, data)} onLayer={onLayer} {...(onGroup ? { onGroup } : {})} />
      )}
      <ConnectCard home={home} />
      {/* the questions sit where a device's controls open, so not while one is open */}
      {home.connected && !selected && home.asking.length > 0 && <AskCard home={home} />}
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

/** The links the matching left open: which of these is it? */
function AskCard({ home }: { home: HomeLayer }) {
  const call = useHass((s) => s.call)
  const byId = useMemo(() => new Map(home.things.map((t) => [t.id, t])), [home.things])
  const [index, setIndex] = useState(0)
  const link = home.asking[Math.min(index, home.asking.length - 1)]
  const hovered = useRef<string | null>(null)
  useEffect(() => () => void (hovered.current && useViewer.getState().setHoveredId(null)), [])
  if (!link) return null
  const e = home.entities[link.entityId]
  const name = e?.attributes.friendly_name ?? link.entityId
  const canBlink = ['light', 'switch', 'fan', 'media_player'].includes(domainOf(link.entityId))
  const hover = (id: string | null) => {
    hovered.current = id
    useViewer.getState().setHoveredId(id as never)
  }
  return (
    <div className="pointer-events-auto absolute top-4 right-4 z-30 grid w-[min(20rem,calc(100vw-2rem))] gap-3 rounded-2xl border border-border/60 bg-background/95 p-4 text-sm shadow-lg backdrop-blur">
      <div className="flex items-baseline justify-between gap-2">
        <b className="font-medium">Which one is {name}?</b>
        <span className="font-mono text-muted-foreground text-xs">{Math.min(index, home.asking.length - 1) + 1}/{home.asking.length}</span>
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
              <button
                className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-foreground/8"
                onBlur={() => hover(null)}
                onClick={() => {
                  hover(null)
                  home.pick(link.entityId, c.thingId)
                }}
                onFocus={() => hover(c.thingId)}
                onMouseEnter={() => hover(c.thingId)}
                onMouseLeave={() => hover(null)}
                type="button"
              >
                <span className="truncate">{t?.label ?? c.thingId}</span>
                <span className="shrink-0 text-muted-foreground text-xs">{t?.rooms.map((r) => r.name).join(', ')}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex justify-between gap-2">
        <Button className="rounded-full" onClick={() => home.pick(link.entityId, null)} size="sm" variant="ghost">Not in the plan</Button>
        {home.asking.length > 1 && (
          <Button className="rounded-full" onClick={() => setIndex((i) => (i + 1) % home.asking.length)} size="sm" variant="ghost">Later</Button>
        )}
      </div>
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

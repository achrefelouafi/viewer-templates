import type { ViewerSource } from '@pascal-app/viewer/ui'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, EdgesGeometry, Float32BufferAttribute, LineSegments, Matrix4, type Mesh, type Object3D, Vector3 } from 'three'
import { attribute, float, length, positionWorld, smoothstep } from 'three/tsl'
import { LineBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { isDark } from '../../theme'
import { type InkHouse, inkHouse } from './house'
import { develop, ink, setInkTheme } from './ink'

/**
 * The home as a plan in ink, the guided tour's X-ray from the Pascal template held for good: walls
 * as frosted glass, furniture as pale ghosts, outlines drafted out from the middle of the house.
 * Only what Home Assistant drives keeps its colours: the nodes in `keep`, and everything drawn
 * outside the graph (the devices' own bodies and their effects).
 *
 * Turning it off opens colour back out from the middle of the house and hands the viewer its own
 * meshes back. The paper or noir palette follows the light or dark switch (`theme.ts`).
 */

type Node = Record<string, unknown> & { id: string; type: string; parentId?: string | null }

/** Seconds: the plan closing in from the edges, and colour opening back out. */
const CLOSE_S = 1.4
const OPEN_S = 1.2
const DRAFT_S = 2.4
const FURNITURE = new Set(['item', 'cabinet', 'cabinet-module', 'shelf', 'stair', 'column'])
/** Creases sharper than this (degrees) are drawn on furniture. */
const CREASE = 35

const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}
const smoothBetween = (a: number, b: number, x: number) => smooth((x - a) / (b - a))

/** Lines with a strength per end, in one floor's own frame. */
class Pen {
  positions: number[] = []
  strengths: number[] = []
  line(a: Vector3, b: Vector3, sa: number, sb = sa) {
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
    this.strengths.push(sa, sb)
  }
  geometry() {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('aStrength', new Float32BufferAttribute(this.strengths, 1))
    return geometry
  }
}

/** Walls, openings and room outlines of one floor, from the graph, in the floor's frame. */
function graphLines(levelId: string, nodes: Readonly<Record<string, Node>>, keep: (id: string) => boolean, pen: Pen) {
  const storey = num(nodes[levelId]?.height, 2.7)
  const all = Object.values(nodes)
  for (const wall of all) {
    if (wall.type !== 'wall' || wall.parentId !== levelId) continue
    const start = wall.start as [number, number] | undefined
    const end = wall.end as [number, number] | undefined
    if (!Array.isArray(start) || !Array.isArray(end)) continue
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const span = Math.hypot(dx, dz)
    if (span < 0.05) continue
    const along = [dx / span, dz / span] as const
    const across = [-along[1], along[0]] as const
    const at = (u: number, y: number, w: number) => new Vector3(start[0] + along[0] * u + across[0] * w, y, start[1] + along[1] * u + across[1] * w)
    const height = num(wall.height, storey)
    const t = num(wall.thickness, 0.15) / 2
    // Top edges crisp, verticals fading towards the floor.
    for (const w of [-t, t]) {
      pen.line(at(0, height, w), at(span, height, w), 1)
      pen.line(at(0, 0, w), at(span, 0, w), 0.18)
      pen.line(at(0, 0, w), at(0, height, w), 0.18, 1)
      pen.line(at(span, 0, w), at(span, height, w), 0.18, 1)
    }
    pen.line(at(0, height, -t), at(0, height, t), 1)
    pen.line(at(span, height, -t), at(span, height, t), 1)
    const fade = (y: number) => 0.18 + 0.82 * smoothBetween(height * 0.55, height - 0.05, y)
    for (const opening of all) {
      if ((opening.type !== 'door' && opening.type !== 'window') || ((opening.wallId as string | undefined) ?? opening.parentId) !== wall.id) continue
      // A connected door or window is drawn in colour: no ink over it.
      if (keep(opening.id)) continue
      const position = opening.position as [number, number, number] | undefined
      if (!Array.isArray(position)) continue
      const width = num(opening.width, 0.9)
      const tall = num(opening.height, opening.type === 'door' ? 2.1 : 1.2)
      const [u0, u1] = [position[0] - width / 2, position[0] + width / 2]
      const [y0, y1] = [position[1] - tall / 2, position[1] + tall / 2]
      for (const w of [-t - 0.003, t + 0.003]) {
        const corners = [at(u0, y0, w), at(u1, y0, w), at(u1, y1, w), at(u0, y1, w)]
        const ys = [y0, y0, y1, y1]
        for (let i = 0; i < 4; i++) {
          if (opening.type === 'door' && i === 0) continue // a door has no sill
          pen.line(corners[i]!, corners[(i + 1) % 4]!, fade(ys[i]!), fade(ys[(i + 1) % 4]!))
        }
      }
    }
  }
  for (const zone of all) {
    if (zone.type !== 'zone' || zone.parentId !== levelId || zone.visible === false) continue
    const polygon = (Array.isArray(zone.polygon) ? zone.polygon : []) as [number, number][]
    polygon.forEach(([x, z], i) => {
      const [x2, z2] = polygon[(i + 1) % polygon.length]!
      pen.line(new Vector3(x, 0.03, z), new Vector3(x2, 0.03, z2), 0.32)
    })
  }
}

const centre = new Vector3()
const size = new Vector3()
const inverse = new Matrix4()
const a = new Vector3()
const b = new Vector3()
/** Crease lines per geometry, kept between builds. */
const creases = new Map<string, Float32Array>()

/** Furniture creases on one floor, from the viewer's own meshes, into the floor's frame. */
function furnitureLines(levelId: string, level: Object3D, nodes: Readonly<Record<string, Node>>, source: ViewerSource, keep: (id: string) => boolean, pen: Pen) {
  level.updateWorldMatrix(true, false)
  inverse.copy(level.matrixWorld).invert()
  for (const node of Object.values(nodes)) {
    if (!FURNITURE.has(node.type) && !(node.type.includes(':') && !node.type.includes('tree'))) continue
    if (keep(node.id)) continue
    let host: string | null | undefined = node.parentId
    for (let guard = 0; host && guard < 8 && nodes[host]?.type !== 'level'; guard++) host = nodes[host]?.parentId
    if (host !== levelId) continue
    const object = source.objectFor(node.id)
    if (!object) continue
    object.updateWorldMatrix(true, true)
    object.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) return
      let edges = creases.get(mesh.geometry.uuid)
      if (!edges) {
        const built = new EdgesGeometry(mesh.geometry, CREASE)
        edges = built.getAttribute('position').array as Float32Array
        built.dispose()
        creases.set(mesh.geometry.uuid, edges)
      }
      for (let i = 0; i < edges.length; i += 6) {
        a.set(edges[i]!, edges[i + 1]!, edges[i + 2]!).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse)
        b.set(edges[i + 3]!, edges[i + 4]!, edges[i + 5]!).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse)
        pen.line(a, b, 0.55)
      }
    })
  }
}

/** The ink: drafted out from the middle of the house, thinned where colour has come back. */
function lineMaterial() {
  const material = new LineBasicNodeMaterial()
  // biome-ignore lint/suspicious/noExplicitAny: TSL typings, as in ink.ts
  const r: any = length(positionWorld.xz.sub(ink.draftCentre))
  const drafted = float(1).sub(smoothstep(ink.draft.sub(1.5), ink.draft, r))
  const pen = float(1).add(r.sub(ink.draft).add(0.9).div(0.7).pow(2).negate().exp().mul(1.4))
  material.colorNode = ink.ink
  material.opacityNode = attribute('aStrength', 'float').mul(0.85).mul(pen).clamp(0, 1)
    .mul(drafted).mul(ink.lines).mul(float(1).sub(develop(positionWorld).x))
  material.transparent = true
  material.depthWrite = false
  return material
}

function buildHouse(source: ViewerSource, renderer: WebGPURenderer, lines: LineBasicNodeMaterial, keep: (id: string) => boolean) {
  const house = inkHouse(source, renderer, keep)
  const nodes = source.nodes as unknown as Readonly<Record<string, Node>>
  for (const floor of house.floors) {
    const pen = new Pen()
    graphLines(floor.levelId, nodes, keep, pen)
    furnitureLines(floor.levelId, floor.object, nodes, source, keep, pen)
    if (!pen.positions.length) continue
    const line = new LineSegments(pen.geometry(), lines)
    line.matrixAutoUpdate = false
    line.renderOrder = 40
    line.frustumCulled = false
    line.raycast = () => {}
    floor.group.add(line)
    house.parts.push({ object: line, levelId: floor.levelId, cutaway: false })
  }
  return house
}

type Show = {
  house: InkHouse | null
  /** 1: the house in its own colours, 0: the plan. Eased when written to the front. */
  house01: number
  draft: number
  reach: number
  settle: number
}

/**
 * @param active the plan look on (default) or the viewer's own render.
 * @param keep the node ids Home Assistant drives: these stay in colour.
 */
export function HomeSketch({ source, keep, active = true }: { source: ViewerSource; keep: ReadonlySet<string>; active?: boolean }) {
  const invalidate = useThree((state) => state.invalidate)
  const renderer = useThree((state) => state.gl) as unknown as WebGPURenderer
  const lines = useMemo(lineMaterial, [])
  const group = useRef<Object3D>(null)
  const show = useRef<Show>({ house: null, house01: 1, draft: 0, reach: 1, settle: 0 })
  const sourceRef = useRef(source)
  sourceRef.current = source
  const keepRef = useRef(keep)
  keepRef.current = keep
  const activeRef = useRef(active)
  activeRef.current = active

  // The paper or noir palette follows the light or dark switch.
  useEffect(() => {
    const apply = () => {
      setInkTheme(isDark() ? 'noir' : 'paper')
      invalidate()
    }
    apply()
    addEventListener('pascal-theme', apply)
    const system = matchMedia('(prefers-color-scheme: dark)')
    system.addEventListener('change', apply)
    return () => {
      removeEventListener('pascal-theme', apply)
      system.removeEventListener('change', apply)
    }
  }, [invalidate])

  useEffect(() => invalidate(), [active, invalidate])

  // A new set of connected nodes: draw the plan again around them.
  useEffect(() => {
    const s = show.current
    if (!s.house) return
    s.house.dispose()
    s.house = null
    invalidate()
  }, [keep, invalidate])

  useEffect(() => () => {
    show.current.house?.dispose()
    show.current.house = null
    ink.houseRadius.value = 1e5
    ink.roomOn.value = 0
    lines.dispose()
  }, [lines])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const s = show.current
    const root = group.current
    if (!root) return
    const on = activeRef.current

    if (on && !s.house) {
      // Only once the viewer has drawn the house: an empty extent means nothing to copy yet.
      const house = buildHouse(sourceRef.current, renderer, lines, (id) => keepRef.current.has(id))
      // The first sync copies what the viewer draws now (and holds the originals back).
      house.sync()
      if (house.extent.isEmpty()) {
        house.dispose()
        invalidate()
        return
      }
      s.house = house
      root.add(house.root)
      ink.roomOn.value = 0
      s.draft = 0
      ink.lines.value = 1
    }
    const house = s.house
    if (!house) {
      if (s.settle > 0) {
        s.settle--
        invalidate()
      }
      return
    }
    house.sync()
    // The house's middle and reach, from everything copied so far: the viewer keeps adding meshes
    // after the first frame, and the outlines draft out across all of them.
    house.extent.getCenter(centre)
    house.extent.getSize(size)
    ink.draftCentre.value.set(centre.x, centre.z)
    ink.houseCentre.value.set(centre.x, centre.z)
    s.reach = Math.max(4, Math.hypot(size.x, size.z) / 2 + 2)

    let busy = false
    if (on && s.house01 > 0) {
      s.house01 = Math.max(0, s.house01 - dt / CLOSE_S)
      busy = true
    } else if (!on) {
      s.house01 = Math.min(1, s.house01 + dt / OPEN_S)
      busy = true
      if (s.house01 >= 1) {
        house.dispose()
        s.house = null
        ink.houseRadius.value = 1e5
        s.settle = 3
        invalidate()
        return
      }
    }

    // The front: colour shrinks into the middle of the house, or grows back out of it.
    const e = house.extent
    const c = ink.houseCentre.value
    const reach = Math.max(...[e.min.x, e.max.x].flatMap((x) => [e.min.z, e.max.z].map((z) => Math.hypot(x - c.x, z - c.y))))
      + (ink.houseFeather.value as number)
    const h = smooth(s.house01)
    ink.houseRadius.value = h >= 1 ? 1e5 : h * reach
    ink.houseGlow.value = Math.sin(Math.PI * h) ** 0.6

    if (s.draft < 1) {
      s.draft = Math.min(1, s.draft + dt / DRAFT_S)
      busy = true
    }
    ink.draft.value = (1 - (1 - s.draft) ** 3) * s.reach
    if (busy) invalidate()
  })

  return <group name="home-sketch" ref={group} />
}

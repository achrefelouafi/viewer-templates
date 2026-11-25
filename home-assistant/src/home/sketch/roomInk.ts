import type { ViewerSource } from '@pascal-app/viewer/ui'
import { Color, type Material, Matrix4, Vector2, Vector3, Vector4 } from 'three'
import { bool, Break, clamp, dot, exp, float, Fn, If, int, length, Loop, max, mix, output, positionWorld, select, smoothstep, step, uniform, uniformArray, vec2, vec4 } from 'three/tsl'
import { MeshStandardNodeMaterial, type NodeMaterial, type WebGPURenderer } from 'three/webgpu'

/**
 * The guided tour's room in colour (`pascal/src/tour/ink.ts`), for the Home Assistant wireframe:
 * the room the visitor picked develops back into the viewer's own materials, a circle growing from
 * its centre inside its outline, with a thin line of ink at the moving front. Only the room part of
 * the tour's develop is here: the rest of the house stays in the wireframe.
 *
 * The wireframe's materials draw outside the developed part (`outsideRoom`), the colour copies
 * (`developedMaterial`) inside it; one write to `roomInk` per frame moves both.
 */

/** Room outlines with more corners than this fall back to their bounding box. */
export const MAX_OUTLINE = 32

/** Where colour has come in: the colour copy draws here, the wireframe everywhere else. */
const SEAM = 0.5

export const roomInk = {
  on: uniform(0),
  // vec4s: arrays of vec2 pad differently between the WebGPU and WebGL2 backends.
  outline: uniformArray(Array.from({ length: MAX_OUTLINE }, () => new Vector4()), 'vec4'),
  corners: uniform(0),
  /** The room's floor and ceiling heights in the world. */
  floor: uniform(new Vector2(-1e4, 1e4)),
  centre: uniform(new Vector2()),
  radius: uniform(0),
  glow: uniform(0),
  /** The front's line, in the wireframe's edge colour. */
  ink: uniform(new Color('#2b2b2b')),
}

/** Room outline in world x/z, closed, at most `MAX_OUTLINE` corners (else its bounding box). */
export function setRoomOutline(points: readonly [number, number][]) {
  let shape = points
  if (shape.length > MAX_OUTLINE) {
    const xs = points.map((p) => p[0])
    const zs = points.map((p) => p[1])
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
    shape = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
  }
  const array = roomInk.outline.array as Vector4[]
  shape.forEach(([x, z], i) => array[i]!.set(x, z, 0, 0))
  roomInk.corners.value = shape.length
}

/**
 * A TSL node. three's TSL typings can't follow swizzles and mixed float/vec maths through
 * generic code like this, so the graph below is typed loosely; the shaders are checked when built.
 */
// biome-ignore lint/suspicious/noExplicitAny: see above
type N = any

/** Signed distance to the room outline, positive inside. */
const roomDistance: (p: N) => N = Fn(([p]: [N]) => {
  const corners: N = int(roomInk.corners)
  const inside = float(0).toVar()
  const d = float(1e4).toVar()
  Loop({ start: int(0), end: int(MAX_OUTLINE), type: 'int', condition: '<' }, ({ i }: { i: N }) => {
    If(i.greaterThanEqual(corners), () => {
      Break()
    })
    const j: N = select(i.equal(0), corners.sub(1), i.sub(1))
    const a: N = (roomInk.outline.element(i) as N).xy.toVar()
    const b: N = (roomInk.outline.element(j) as N).xy.toVar()
    const crosses = a.y.greaterThan(p.y).notEqual(b.y.greaterThan(p.y))
    const at = b.x.sub(a.x).mul(p.y.sub(a.y)).div(b.y.sub(a.y)).add(a.x)
    If(crosses.and(p.x.lessThan(at)), () => {
      inside.assign(float(1).sub(inside))
    })
    const pa = p.sub(a)
    const ba = b.sub(a)
    const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-6)), 0, 1)
    d.assign(d.min(length(pa.sub(ba.mul(h)))))
  })
  return select(corners.lessThan(3), float(-1e4), select(inside.greaterThan(0.5), d, d.negate()))
}) as N

const square = (x: N): N => x.mul(x)

/** x: how developed this point is (0 wireframe, 1 colour). y: the glow of the moving front. */
const develop: (w: N) => N = Fn(([w]: [N]) => {
  // Inside the outline up to its walls' inner faces, never the far side of a wall (a wall is at
  // least 6 cm thick), on its floor, inside its front.
  const inRoom: N = smoothstep(-0.06, 0, roomDistance(w.xz))
    .mul(step(roomInk.floor.x, w.y)).mul(step(w.y, roomInk.floor.y)).mul(roomInk.on)
  const dr: N = length(w.xz.sub(roomInk.centre))
  const room = inRoom.mul(float(1).sub(smoothstep(roomInk.radius.sub(0.9), roomInk.radius, dr)))
  const ring = inRoom.mul(exp(square(dr.sub(roomInk.radius).add(0.45).div(0.06)).negate())).mul(roomInk.glow).mul(0.7)
  return vec2(room, clamp(ring, 0, 1))
}) as N

/** The wireframe's mask: true where the room has not developed. */
export function outsideRoom(): N {
  return (develop(positionWorld) as N).x.lessThan(SEAM)
}

/** Fields three's renderer manages per material, never copied. */
const OWN_KEYS = new Set(['uuid', 'id', 'type', 'version', '_listeners'])

/** The material as a node material of its own, as three's renderer converts it, never shared. */
function nodeCopy(source: Material, renderer: WebGPURenderer | null): NodeMaterial {
  if ((source as NodeMaterial).isNodeMaterial) return (source as NodeMaterial).clone()
  const library = (renderer as unknown as { library?: { getMaterialNodeClass(type: string): (new () => NodeMaterial) | null } } | null)?.library
  const NodeClass = library?.getMaterialNodeClass(source.type) ?? MeshStandardNodeMaterial
  const material = new NodeClass()
  const target = material as unknown as Record<string, unknown>
  for (const key in source) {
    if (OWN_KEYS.has(key)) continue
    const value = (source as unknown as Record<string, unknown>)[key]
    if (typeof value === 'function') continue
    target[key] = value
  }
  material.name = source.name
  return material
}

/**
 * The viewer's material as it is, drawn only where the room has developed: everything of the
 * original (transparency, depth, sides, MRT), so the room is the viewer's own render; the moving
 * front adds a thin line of ink.
 */
export function developedMaterial(source: Material, renderer: WebGPURenderer | null): NodeMaterial {
  const material = nodeCopy(source, renderer)
  const base: N = material.outputNode ?? output
  const d: N = develop(positionWorld)
  material.outputNode = vec4(mix(base.rgb, roomInk.ink, d.y.mul(0.65)), base.a)
  const own = (source as NodeMaterial).maskNode as N
  const seam: N = d.x.greaterThanEqual(SEAM)
  material.maskNode = own ? bool(own).and(seam) : seam
  material.userData = { ...material.userData, __tourNoir: true }
  material.needsUpdate = true
  return material
}

type GraphNode = { id: string; type: string; parentId?: string | null; polygon?: unknown; ceilingHeight?: unknown; height?: unknown }

export type DevelopRoom = {
  id: string
  levelId: string | null
  outline: [number, number][]
  centre: [number, number]
  /** Distance from the centre to the farthest corner, plus a margin: how far its front grows. */
  reach: number
  floorY: number
  height: number
}

const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

function levelOf(nodes: Readonly<Record<string, GraphNode | undefined>>, id: string): string | null {
  let node = nodes[id]
  for (let guard = 0; node && guard < 32; guard++) {
    if (node.type === 'level') return node.id
    node = node.parentId ? nodes[node.parentId] : undefined
  }
  return null
}

/** A room (zone) in the world now: its outline through its level's transform. */
export function roomOf(source: ViewerSource, zoneId: string): DevelopRoom | null {
  const nodes = source.nodes as unknown as Readonly<Record<string, GraphNode | undefined>>
  const zone = nodes[zoneId]
  const raw = zone?.polygon as [number, number][] | { points?: [number, number][] } | undefined
  const polygon = Array.isArray(raw) ? raw : (raw?.points ?? [])
  if (!zone || polygon.length < 3) return null
  const levelId = levelOf(nodes, zoneId)
  const level = levelId ? source.objectFor(levelId) : undefined
  level?.updateWorldMatrix(true, false)
  const matrix = level?.matrixWorld ?? new Matrix4()
  const p = new Vector3()
  const outline = polygon.map(([x, z]) => {
    p.set(x, 0, z).applyMatrix4(matrix)
    return [p.x, p.z] as [number, number]
  })
  const floorY = p.set(0, 0, 0).applyMatrix4(matrix).y
  const centre = centroid(outline)
  return {
    id: zoneId,
    levelId,
    outline,
    centre,
    reach: Math.max(...outline.map(([x, z]) => Math.hypot(x - centre[0], z - centre[1]))) + 0.6,
    floorY,
    height: num(zone.ceilingHeight, num(levelId ? nodes[levelId]?.height : undefined, 2.7)),
  }
}

/** Whether a world point (x, z) is inside an outline. */
export function insideOutline(outline: readonly [number, number][], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, zi] = outline[i]!
    const [xj, zj] = outline[j]!
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function centroid(outline: [number, number][]): [number, number] {
  let area = 0
  let x = 0
  let z = 0
  outline.forEach(([x1, z1], i) => {
    const [x2, z2] = outline[(i + 1) % outline.length]!
    const cross = x1 * z2 - x2 * z1
    area += cross
    x += (x1 + x2) * cross
    z += (z1 + z2) * cross
  })
  if (Math.abs(area) < 1e-6) {
    const n = outline.length
    return [outline.reduce((s, q) => s + q[0], 0) / n, outline.reduce((s, q) => s + q[1], 0) / n]
  }
  return [x / (3 * area), z / (3 * area)]
}

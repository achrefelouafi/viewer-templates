import * as THREE from 'three'
import { dot, float, floor, fract, mix, positionWorld, sin, uniform, vec3 } from 'three/tsl'
import { MeshStandardNodeMaterial, type NodeMaterial, type WebGPURenderer } from 'three/webgpu'
import type { BuildElement } from './elements'
import { nodeCopy } from './ink'
import { notWarmup, type WarmItem } from './warmup'

/**
 * The Sand template's hardening: each piece builds up out of sand from its foot to its top (a flat
 * piece, a slab or a ceiling, spreads from its centre instead), and its own materials follow the
 * sand up, so the real textures rise through it.
 *
 * Two fronts per piece, `sand` (the top of the sand so far) and `real` (the top of the real
 * surface), along its build coordinate: its height, or a flat piece's distance from its centre.
 * Behind `real` the piece draws in its own materials; between the two a sand-coloured twin of its
 * meshes draws; past `sand`, nothing yet. Both fronts are grainy, so the edge reads as sand.
 *
 * The materials are shared, one copy per real material for the whole page (and one sand material):
 * each mesh carries its piece's fronts in `userData.__sandFront`, and the shaders read them per
 * object as three draws it. So a build compiles a handful of shaders, not one per piece, and
 * `prepareSandMaterials` can build them all while the project loads.
 */

/** Share of a piece's track over which the sand rises, and when the real surface starts after it. */
export const SAND_RISE = 0.6
const REAL_FROM = 0.3

const NO_RAYCAST = () => {}

// biome-ignore lint/suspicious/noExplicitAny: three's TSL typings can't follow this graph
type N = any

/** A piece's fronts and build coordinate, read by the shared shaders per object. */
type Front = { sand: number; real: number; flat: number; cx: number; cz: number }
const NONE: Front = { sand: 1e4, real: 1e4, flat: 0, cx: 0, cz: 0 }
const frontOf = (object: THREE.Object3D): Front => (object.userData.__sandFront as Front | undefined) ?? NONE

const sandFront: N = (uniform(1e4) as N).onObjectUpdate(({ object }: { object: THREE.Object3D }) => frontOf(object).sand)
const realFront: N = (uniform(1e4) as N).onObjectUpdate(({ object }: { object: THREE.Object3D }) => frontOf(object).real)
const flatness: N = (uniform(0) as N).onObjectUpdate(({ object }: { object: THREE.Object3D }) => frontOf(object).flat)
const _centre = new THREE.Vector2()
const centre: N = (uniform(new THREE.Vector2()) as N).onObjectUpdate(({ object }: { object: THREE.Object3D }) => {
  const front = frontOf(object)
  return _centre.set(front.cx, front.cz)
})

/** How far along its build a point is: its height, or a flat piece's distance from its centre. */
const coord = (): N => mix(positionWorld.y, (positionWorld.xz as N).sub(centre).length(), flatness)

/** A grain-sized jitter (±`amount` / 2): a hash of the point snapped to 3 cm cells. */
function grain(amount: number): N {
  const cell: N = floor(positionWorld.mul(33))
  const h: N = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453))
  return h.sub(0.5).mul(amount)
}

let sandMaterial: MeshStandardNodeMaterial | null = null

/** The sand between the two fronts, a touch lighter (drier) near its top. One for the page. */
function sand(): THREE.Material {
  if (sandMaterial) return sandMaterial
  const material = new MeshStandardNodeMaterial({ color: '#d9b77a', roughness: 1, metalness: 0 })
  const c: N = coord()
  material.maskNode = c.lessThan(sandFront.add(grain(0.1))).and(c.greaterThanEqual(realFront.add(grain(0.08)))).and(notWarmup())
  const top: N = float(1).sub(sandFront.sub(c).div(0.35).clamp(0, 1))
  material.colorNode = mix(vec3(0.85, 0.72, 0.48), vec3(0.96, 0.88, 0.7), top.mul(0.7))
  material.userData.__sandReveal = true
  sandMaterial = material
  return material
}

/** What a copy depends on: the material, its version and its textures. */
function lookOf(material: THREE.Material): string {
  const t = material as THREE.Material & Partial<Record<'map' | 'normalMap' | 'roughnessMap' | 'aoMap', THREE.Texture | null>>
  return [material.uuid, material.version, t.map?.uuid, t.normalMap?.uuid, t.roughnessMap?.uuid, t.aoMap?.uuid].join(':')
}

const copies = new Map<string, NodeMaterial>()

/** The material, drawn only behind its piece's real front. One copy per look, for the page. */
function realOf(source: THREE.Material, renderer: WebGPURenderer | null): THREE.Material {
  if (source.userData?.__sandReveal) return source
  const key = lookOf(source)
  const known = copies.get(key)
  if (known) return known
  const material = nodeCopy(source, renderer)
  const mask: N = coord().lessThan(realFront.add(grain(0.08))).and(notWarmup())
  const theirs = (source as NodeMaterial).maskNode as N
  material.maskNode = theirs ? theirs.and(mask) : mask
  material.userData = { ...material.userData, __sandReveal: true }
  material.needsUpdate = true
  copies.set(key, material)
  return material
}

const realsOf = (own: THREE.Material | THREE.Material[], renderer: WebGPURenderer | null) =>
  Array.isArray(own) ? own.map((m) => realOf(m, renderer)) : realOf(own, renderer)

const isOurs = (material: THREE.Material | THREE.Material[]) =>
  (Array.isArray(material) ? material : [material]).some((m) => m?.userData?.__sandReveal === true)

/**
 * Builds the shared materials for these meshes ahead of a run, and returns what to draw to compile
 * them (see `Warmup`): each copy on its mesh's geometry, and the sand on it too.
 */
export function prepareSandMaterials(meshes: Iterable<THREE.Mesh>, renderer: WebGPURenderer | null): WarmItem[] {
  const items: WarmItem[] = []
  for (const mesh of meshes) {
    if (isOurs(mesh.material)) continue
    const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh === true
    items.push({ geometry: mesh.geometry, material: realsOf(mesh.material, renderer), instanced })
    items.push({ geometry: mesh.geometry, material: sand(), instanced })
  }
  return items
}

/** A flat piece builds outwards from its centre; anything else from its foot up. */
function shapeOf(element: BuildElement) {
  const { min, max } = element.box
  const height = max.y - min.y
  const flat = height < 0.45 && Math.max(element.size.x, element.size.z) > height * 3
  return flat
    ? { flat: true, from: 0, to: Math.hypot(element.size.x, element.size.z) / 2 }
    : { flat: false, from: min.y, to: max.y }
}

type Entry = {
  start: number
  duration: number
  from: number
  to: number
  front: Front
  meshes: Array<{ mesh: THREE.Mesh; own: THREE.Material | THREE.Material[]; twin: THREE.Mesh }>
}

export class SandReveal {
  private readonly entries: Entry[] = []

  constructor(
    elements: readonly BuildElement[],
    tracks: ReadonlyMap<string, { start: number; duration: number }>,
    meshesOf: (element: BuildElement) => THREE.Mesh[],
    private readonly renderer: WebGPURenderer | null,
  ) {
    for (const element of elements) {
      const track = tracks.get(element.id)
      if (!track) continue
      const shape = shapeOf(element)
      const front: Front = { sand: -1e4, real: -1e4, flat: shape.flat ? 1 : 0, cx: element.center.x, cz: element.center.z }
      const entry: Entry = { start: track.start, duration: track.duration, from: shape.from, to: shape.to, front, meshes: [] }
      for (const mesh of meshesOf(element)) {
        const twin = twinOf(mesh)
        twin.userData.__sandFront = front
        mesh.userData.__sandFront = front
        mesh.add(twin)
        entry.meshes.push({ mesh, own: mesh.material, twin })
      }
      this.entries.push(entry)
    }
  }

  update(time: number) {
    for (const entry of this.entries) {
      const u = (time - entry.start) / entry.duration
      const done = u >= 1
      const span = Math.max(0.05, entry.to - entry.from)
      const rise = Math.min(1, Math.max(0, u / SAND_RISE))
      const real = Math.min(1, Math.max(0, (u - REAL_FROM) / (1 - REAL_FROM)))
      // Past the end (and the grain) at 1, before the start at 0.
      entry.front.sand = rise <= 0 ? -1e4 : entry.from - 0.06 + (span + 0.12) * rise
      entry.front.real = real <= 0 ? -1e4 : entry.from - 0.06 + (span + 0.12) * (1 - (1 - real) ** 2)
      for (const item of entry.meshes) {
        const { mesh } = item
        if (done) {
          if (isOurs(mesh.material)) mesh.material = item.own
          item.twin.visible = false
          continue
        }
        if (!isOurs(mesh.material)) {
          // Pascal may have given it a new material since: that one is its own now.
          item.own = mesh.material
          mesh.material = realsOf(item.own, this.renderer)
        }
        item.twin.visible = u > 0
        if (item.twin.geometry !== mesh.geometry) item.twin.geometry = mesh.geometry
        item.twin.layers.mask = mesh.layers.mask
      }
    }
  }

  dispose() {
    for (const entry of this.entries) {
      for (const item of entry.meshes) {
        if (isOurs(item.mesh.material)) item.mesh.material = item.own
        delete item.mesh.userData.__sandFront
        item.twin.removeFromParent()
      }
    }
    // The shared materials stay: the next run (or replay) draws with them at once.
  }
}

/** The sand-coloured twin: same geometry (and instances), sitting exactly on its mesh. */
function twinOf(mesh: THREE.Mesh): THREE.Mesh {
  const instanced = mesh as THREE.InstancedMesh
  let twin: THREE.Mesh
  if (instanced.isInstancedMesh) {
    const copy = new THREE.InstancedMesh(instanced.geometry, sand(), instanced.count)
    copy.instanceMatrix = instanced.instanceMatrix
    copy.frustumCulled = false
    twin = copy
  } else {
    twin = new THREE.Mesh(mesh.geometry, sand())
    twin.frustumCulled = mesh.frustumCulled
  }
  twin.raycast = NO_RAYCAST
  twin.userData = { __sandReveal: true }
  twin.layers.mask = mesh.layers.mask
  twin.castShadow = false
  twin.receiveShadow = true
  twin.visible = false
  return twin
}

import { sceneRegistry } from '@pascal-app/core'
import { getSceneTheme, SCENE_LAYER, SITE_GROUND, useViewer } from '@pascal-app/viewer'
import type { ViewerSource } from '@pascal-app/viewer/ui'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  bool,
  clamp,
  dot,
  Fn,
  float,
  If,
  int,
  Loop,
  length,
  max,
  min,
  mrt,
  output,
  positionWorld,
  select,
  step,
  uniform,
  uniformArray,
  vec2,
  vec4,
} from 'three/tsl'
import {
  LineBasicNodeMaterial,
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  MeshPhongNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  MeshToonNodeMaterial,
} from 'three/webgpu'
import { useTourLook } from './look'

/**
 * The guided tour's look: the house as a wireframe, the way the Pascal Noir editor draws it
 * (ghosted walls and furniture with bright edges, dark floors on a near-black ground; the
 * paper version in light mode, following `<html class="dark">`), with the current room in its
 * own colours. On arrival the colour spreads from the room's centre in a growing circle, clipped
 * to the room; when the tour moves on it draws back before the next room fills.
 *
 * Pascal's own renderer stays on (its lights, shadows, ink edges and post-processing): the tour
 * swaps the scene theme and the surface materials, and puts everything back on exit. The room in
 * colour is a twin of each mesh near it, drawn with the mesh's own material and masked to the
 * circle, while the wireframe material is masked away inside it.
 *
 * Every material here is single-sided: a double-sided node material inside Pascal's MRT scene pass
 * poisons the WebGPU render context (see `glassMaterial` in `@pascal-app/viewer`'s materials).
 */

const EDGE_THRESHOLD_DEG = 35
const RESCAN_INTERVAL_S = 0.5
const NO_RAYCAST = () => {}

type Palette = {
  bg: string
  ground: string
  wall: string
  wallOpacity: number
  edge: string
  wallEdgeOpacity: number
  item: string
  itemOpacity: number
  itemEdgeOpacity: number
  floor: string
  glass: string
  glassOpacity: number
}

const PALETTES: Record<'noir' | 'paper', Palette> = {
  // Neutral black and greys, no blue cast.
  noir: {
    bg: '#080808',
    ground: '#0b0b0b',
    wall: '#c2c2c2',
    wallOpacity: 0.2,
    edge: '#f2f2f2',
    wallEdgeOpacity: 0.2,
    item: '#c2c2c2',
    itemOpacity: 0.2,
    itemEdgeOpacity: 0.2,
    floor: '#2d2d2d',
    glass: '#c2c2c2',
    glassOpacity: 0.2,
  },
  // Neutral whites and greys, no warm cast.
  paper: {
    bg: '#f2f2f2',
    ground: '#f2f2f2',
    wall: '#ffffff',
    wallOpacity: 0.2,
    edge: '#2b2b2b',
    wallEdgeOpacity: 0.2,
    item: '#ffffff',
    itemOpacity: 0.2,
    itemEdgeOpacity: 0.2,
    floor: '#e4e4e4',
    glass: '#ffffff',
    glassOpacity: 0.2,
  },
}

/** Pascal's scene theme for the tour: the Noir editor's background, ground and light rig. */
function tourAppearance(dark: boolean) {
  const base = getSceneTheme(dark ? 'night' : 'paper')
  const palette = PALETTES[dark ? 'noir' : 'paper']
  return {
    ...base,
    background: palette.bg,
    backgroundSky: null,
    ground: palette.ground,
    ambient: { color: '#ffffff', intensity: dark ? 0.55 : 1.1 },
    hemi: dark
      ? { sky: '#ffffff', ground: '#0b0b0b', intensity: 0.9 }
      : { sky: '#ffffff', ground: '#d6d6d6', intensity: 1.2 },
    lights: [
      { position: [-9, 16, 8] as [number, number, number], color: '#ffffff', intensity: dark ? 2.2 : 2.4, castShadow: true },
      { position: [10, 6, -10] as [number, number, number], color: '#ffffff', intensity: dark ? 0.6 : 0.5 },
    ],
    toneMappingExposure: 1,
    postprocessing: { ambientOcclusion: true, colorGrading: false },
  }
}

type NoirRole = 'wall' | 'floor' | 'item' | 'glass' | 'ground'

type NodeLike = {
  id?: string
  type?: string
  parentId?: string | null
}

/**
 * The outline of a mesh as the eye reads it: creases sharper than `thresholdDeg` and open borders,
 * without the lines between triangles of one flat surface. Like `EdgesGeometry`, but a seam where
 * flat triangles meet without sharing vertices (a wall cut around a window, a panel split into
 * strips) is dropped too: the far side of such an edge is checked for another triangle in the same
 * plane, and when it is covered all along, the surface simply continues there.
 */
function flatEdges(geometry: THREE.BufferGeometry, thresholdDeg: number): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(edgeLines(geometry, thresholdDeg), 3))
  return result
}

function positionVersion(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position')
  return 'isInterleavedBufferAttribute' in position ? position.data.version : position.version
}

function hasEdgeLines(geometry: THREE.BufferGeometry, thresholdDeg: number): boolean {
  const cached = EDGE_CACHE.get(geometry)
  return !!cached && cached.version === positionVersion(geometry) && cached.threshold === thresholdDeg
}

/** The edge segments, worked out once per geometry: baked batches and instanced items share theirs. */
function edgeLines(geometry: THREE.BufferGeometry, thresholdDeg: number): Float32Array {
  if (hasEdgeLines(geometry, thresholdDeg)) return EDGE_CACHE.get(geometry)!.lines
  const lines = computeFlatEdges(geometry, thresholdDeg)
  EDGE_CACHE.set(geometry, { version: positionVersion(geometry), threshold: thresholdDeg, lines })
  return lines
}

const EDGE_CACHE = new WeakMap<THREE.BufferGeometry, { version: number; threshold: number; lines: Float32Array }>()
const _v0 = new THREE.Vector3()
const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _along = new THREE.Vector3()
const _out = new THREE.Vector3()
const _centroid = new THREE.Vector3()
const _toCentroid = new THREE.Vector3()

function computeFlatEdges(geometry: THREE.BufferGeometry, thresholdDeg: number): Float32Array {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const triangleCount = Math.floor((index ? index.count : position.count) / 3)
  const vertex = (i: number) => (index ? index.getX(i) : i)
  const precision = 1e4
  const weld = new Map<string, number>()
  const points: THREE.Vector3[] = []
  const welded = (i: number) => {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const key = `${Math.round(x * precision)},${Math.round(y * precision)},${Math.round(z * precision)}`
    let id = weld.get(key)
    if (id === undefined) {
      id = points.length
      points.push(new THREE.Vector3(x, y, z))
      weld.set(key, id)
    }
    return id
  }

  type Tri = { v: [number, number, number]; normal: THREE.Vector3; plane: string }
  const triangles: Tri[] = []
  const planes = new Map<string, number[]>()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  for (let t = 0; t < triangleCount; t++) {
    const v: [number, number, number] = [welded(vertex(t * 3)), welded(vertex(t * 3 + 1)), welded(vertex(t * 3 + 2))]
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue
    ab.subVectors(points[v[1]]!, points[v[0]]!)
    ac.subVectors(points[v[2]]!, points[v[0]]!)
    const normal = new THREE.Vector3().crossVectors(ab, ac)
    if (normal.lengthSq() < 1e-14) continue
    normal.normalize()
    const d = normal.dot(points[v[0]]!)
    const plane = `${Math.round(normal.x * 50)},${Math.round(normal.y * 50)},${Math.round(normal.z * 50)},${Math.round(d * 100)}`
    const id = triangles.length
    triangles.push({ v, normal, plane })
    const group = planes.get(plane)
    if (group) group.push(id)
    else planes.set(plane, [id])
  }

  // Each edge with the triangles on it.
  const edges = new Map<string, { a: number; b: number; faces: number[] }>()
  for (let t = 0; t < triangles.length; t++) {
    const { v } = triangles[t]!
    for (let k = 0; k < 3; k++) {
      const a = v[k]!
      const b = v[(k + 1) % 3]!
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      const edge = edges.get(key)
      if (edge) edge.faces.push(t)
      else edges.set(key, { a, b, faces: [t] })
    }
  }

  // Each triangle's bounds, padded past its barycentric tolerance. `inTriangle` tests the point's
  // projection onto the triangle's plane, so the same projection is checked against the bounds:
  // most of a big flat group is ruled out without the full test, and the answer never changes.
  const bounds = new Float64Array(triangles.length * 6)
  for (let t = 0; t < triangles.length; t++) {
    const [ia, ib, ic] = triangles[t]!.v
    const a = points[ia]!
    const b = points[ib]!
    const c = points[ic]!
    const minX = Math.min(a.x, b.x, c.x)
    const minY = Math.min(a.y, b.y, c.y)
    const minZ = Math.min(a.z, b.z, c.z)
    const maxX = Math.max(a.x, b.x, c.x)
    const maxY = Math.max(a.y, b.y, c.y)
    const maxZ = Math.max(a.z, b.z, c.z)
    const pad = 1e-2 * (maxX - minX + maxY - minY + maxZ - minZ) + 1e-6
    bounds.set([minX - pad, minY - pad, minZ - pad, maxX + pad, maxY + pad, maxZ + pad], t * 6)
  }
  const nearTriangle = (p: THREE.Vector3, t: number) => {
    const tri = triangles[t]!
    const a = points[tri.v[0]]!
    const n = tri.normal
    const off = n.x * (p.x - a.x) + n.y * (p.y - a.y) + n.z * (p.z - a.z)
    const x = p.x - n.x * off
    const y = p.y - n.y * off
    const z = p.z - n.z * off
    const o = t * 6
    return x >= bounds[o]! && y >= bounds[o + 1]! && z >= bounds[o + 2]! &&
      x <= bounds[o + 3]! && y <= bounds[o + 4]! && z <= bounds[o + 5]!
  }

  const inTriangle = (p: THREE.Vector3, tri: Tri) => {
    const a = points[tri.v[0]]!
    const b = points[tri.v[1]]!
    const c = points[tri.v[2]]!
    const v0 = _v0.subVectors(c, a)
    const v1 = _v1.subVectors(b, a)
    const v2 = _v2.subVectors(p, a)
    const d00 = v0.dot(v0)
    const d01 = v0.dot(v1)
    const d02 = v0.dot(v2)
    const d11 = v1.dot(v1)
    const d12 = v1.dot(v2)
    const denominator = d00 * d11 - d01 * d01
    if (Math.abs(denominator) < 1e-18) return false
    const u = (d11 * d02 - d01 * d12) / denominator
    const w = (d00 * d12 - d01 * d02) / denominator
    const tolerance = -1e-4
    return u >= tolerance && w >= tolerance && u + w <= 1 - tolerance
  }

  /** True when the surface carries on flat past this border edge of `face`. */
  const continuesFlat = (a: THREE.Vector3, b: THREE.Vector3, face: number) => {
    const tri = triangles[face]!
    const group = planes.get(tri.plane)
    if (!group || group.length < 2 || group.length > 4096) return false
    const along = _along.subVectors(b, a)
    const length = along.length()
    if (length < 1e-6) return false
    const out = _out.crossVectors(tri.normal, along).normalize()
    // Point away from the face's own interior.
    const centroid = _centroid.copy(points[tri.v[0]]!).add(points[tri.v[1]]!).add(points[tri.v[2]]!).divideScalar(3)
    if (out.dot(_toCentroid.subVectors(centroid, a)) > 0) out.negate()
    const step = Math.min(0.002, length * 0.05)
    const sample = _sample
    for (const f of SAMPLE_AT) {
      sample.copy(a).addScaledVector(along, f).addScaledVector(out, step)
      let covered = false
      for (const other of group) {
        if (other !== face && nearTriangle(sample, other) && inTriangle(sample, triangles[other]!)) {
          covered = true
          break
        }
      }
      if (!covered) return false
    }
    return true
  }

  const crease = Math.cos(THREE.MathUtils.degToRad(thresholdDeg))
  const lines: number[] = []
  for (const { a, b, faces } of edges.values()) {
    let draw: boolean
    if (faces.length === 1) {
      draw = !continuesFlat(points[a]!, points[b]!, faces[0]!)
    } else {
      draw = false
      const first = triangles[faces[0]!]!.normal
      for (let i = 1; i < faces.length && !draw; i++) {
        if (first.dot(triangles[faces[i]!]!.normal) <= crease) draw = true
      }
    }
    if (!draw) continue
    const pa = points[a]!
    const pb = points[b]!
    lines.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z)
  }
  return new Float32Array(lines)
}

const SAMPLE_AT = [0.1, 0.3, 0.5, 0.7, 0.9]
const _meshBox = new THREE.Box3()
const _sample = new THREE.Vector3()

type MeshStash = {
  material: THREE.Material | THREE.Material[]
  castShadow: boolean
  receiveShadow: boolean
  role: NoirRole
  geometryUuid: string
  edge: THREE.LineSegments | null
}

type NodeOwner = {
  id: string
  kind: string
  levelId: string | null
}

function useDarkTheme(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setDark(root.classList.contains('dark')))
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

function findNodeLevelId(nodeId: string, nodes: Record<string, NodeLike | undefined>): string | null {
  let current = nodes[nodeId]
  for (let guard = 0; current && guard < 16; guard++) {
    if (current.type === 'level') return current.id ?? nodeId
    if (!current.parentId) return null
    const nextId = current.parentId
    current = nodes[nextId]
    if (current?.type === 'level') return nextId
  }
  return null
}

function buildLiveOwnerMap(nodes: Record<string, NodeLike | undefined>): Map<THREE.Object3D, NodeOwner> {
  const map = new Map<THREE.Object3D, NodeOwner>()
  for (const [id, obj] of sceneRegistry.nodes) {
    const node = nodes[id]
    if (!node?.type) continue
    map.set(obj, { id, kind: node.type, levelId: node.type === 'level' ? id : findNodeLevelId(id, nodes) })
  }
  return map
}

const STRUCTURAL_KINDS = new Set([
  'wall',
  'ceiling',
  'roof',
  'roof-segment',
  'column',
  'beam',
  'chimney',
  'dormer',
  'cupola',
  'lean-to-extension',
  'stair',
  'stair-segment',
  'elevator',
  'door',
  'window',
  'skylight',
  'fence',
  'fence-gate',
  'fence-opening',
  'block',
  'gutter',
  'downspout',
  'box-vent',
  'ridge-vent',
  'turbine-vent',
  'eyebrow-vent',
  'solar-panel',
  'separator',
])

const FLOOR_KINDS = new Set(['slab', 'floor'])

const ITEM_KINDS = new Set([
  'item',
  'procedural-item',
  'cabinet',
  'cabinet-module',
  'shelf',
  'imported-mesh',
  'hvac-equipment',
  'duct-segment',
  'duct-fitting',
  'duct-terminal',
  'pipe-segment',
  'pipe-fitting',
  'pipe-trap',
  'lineset',
  'liquid-line',
])

const SKIP_KINDS = new Set([
  'zone',
  'spawn',
  'guide',
  'scan',
  'measurement',
  'construction-dimension',
  'structural-grid',
])

const HELPER_NAMES = new Set([
  'wall-collision',
  'curtain-wall-shadow',
  'ceiling-grid',
  'collider',
  'cutout',
])

function materialLooksGlass(mat: THREE.Material | THREE.Material[] | null | undefined, kind: string | null): boolean {
  if (!mat) return false
  const list = Array.isArray(mat) ? mat : [mat]
  if (list.length === 0) return false
  let hasGlass = false
  for (const entry of list) {
    if (!entry) continue
    if (entry.userData?.isGlass === true || /glass|glaz/i.test(entry.name)) {
      hasGlass = true
      continue
    }
    if (
      entry.transparent &&
      entry.opacity < 0.6 &&
      (kind === 'window' || kind === 'skylight' || kind === 'door' || kind === 'elevator' || kind === 'wall')
    ) {
      hasGlass = true
      continue
    }
    // Mixed multi-material mesh with opaque non-glass parts (e.g. a whole wall): not pure glass.
    return false
  }
  return hasGlass
}

/** One of the tour's own materials, never a mesh's own. */
function isTourMaterial(mat: THREE.Material | THREE.Material[] | null | undefined): boolean {
  const list = Array.isArray(mat) ? mat : mat ? [mat] : []
  return list.some((entry) => entry?.userData?.__tourNoir === true)
}

function materialIsInvisibleHitbox(mat: THREE.Material | THREE.Material[] | null | undefined): boolean {
  if (!mat) return true
  const list = Array.isArray(mat) ? mat : [mat]
  return list.length > 0 && list.every((entry) => entry && entry.visible === false)
}

function isUnderTourNoir(obj: THREE.Object3D): boolean {
  for (let at: THREE.Object3D | null = obj; at; at = at.parent) {
    if (at.userData?.__tourNoir || at.userData?.__tourNoirEdge) return true
  }
  return false
}

function isSiteEnvironmentObject(
  obj: THREE.Object3D,
  liveOwners: Map<THREE.Object3D, NodeOwner>,
): boolean {
  if (obj.userData?.[SITE_GROUND] === 'solid' || obj.userData?.[SITE_GROUND] === 'veil') return true
  // Direct ground/horizon/property-line children of a `site` group (live or baked GLB),
  // stopping before descending into buildings/levels/items hosted on the site.
  const parent = obj.parent
  if (!parent) return false
  const parentOwner = liveOwners.get(parent)
  if (parentOwner?.kind === 'site') {
    return !liveOwners.has(obj) && !(obj.type === 'Group' && obj.children.length > 0)
  }
  if (parent.userData?.kind === 'site' && !obj.userData?.pascalId) {
    return !(obj.type === 'Group' && obj.children.length > 0)
  }
  return false
}

function classifyMesh(
  mesh: THREE.Mesh,
  liveOwners: Map<THREE.Object3D, NodeOwner>,
): { role: NoirRole; levelId: string | null } | null {
  if (!mesh.layers.isEnabled(SCENE_LAYER)) return null
  if (HELPER_NAMES.has(mesh.name)) return null
  const pos = mesh.geometry?.getAttribute('position')
  if (!pos || pos.count === 0) return null

  const ud = mesh.userData as {
    glbBatch?: boolean
    role?: string
    slotId?: string
    __bakedMaterial?: THREE.Material | THREE.Material[]
    bakedMaterial?: THREE.Material | THREE.Material[]
    kind?: string
    pascalId?: string
  }

  // Find owning node (live registry or baked GLB extras) and enclosing level.
  let kind: string | null = ud.kind ?? null
  let levelId: string | null = null
  for (let at: THREE.Object3D | null = mesh; at; at = at.parent) {
    const live = liveOwners.get(at)
    if (live) {
      if (!kind && live.kind !== 'level' && live.kind !== 'building' && live.kind !== 'site') {
        kind = live.kind
      }
      if (!levelId && live.levelId) levelId = live.levelId
      if (live.kind === 'level') {
        levelId = live.id
        break
      }
    }
    const atUd = at.userData as { kind?: string; pascalId?: string } | undefined
    if (atUd?.kind === 'level' && atUd.pascalId) {
      levelId ??= atUd.pascalId
      break
    }
    if (!kind && atUd?.pascalId && atUd.kind && atUd.kind !== 'building' && atUd.kind !== 'site') {
      kind = atUd.kind
    }
  }

  if (kind && SKIP_KINDS.has(kind)) return null

  // 1. Baked GLB merged batches carry Pascal's own `SurfaceRole` (`glb-merge.ts`).
  if (ud.glbBatch && ud.role) {
    if (ud.role === 'glazing') return { role: 'glass', levelId }
    if (ud.role === 'floor') return { role: 'floor', levelId }
    if (ud.role === 'furnishing') return { role: 'item', levelId }
    return { role: 'wall', levelId }
  }

  // 2. Glass check (slotId, baked original material, or live material).
  const sourceMat = ud.__bakedMaterial ?? ud.bakedMaterial ?? mesh.material
  if (ud.slotId === 'glass' || materialLooksGlass(sourceMat, kind)) {
    return { role: 'glass', levelId }
  }

  // 3. Kind classification (works identically for live `sceneRegistry` and baked GLB `userData.kind`).
  if (kind) {
    if (FLOOR_KINDS.has(kind)) return { role: 'floor', levelId }
    if (ITEM_KINDS.has(kind)) return { role: 'item', levelId }
    if (STRUCTURAL_KINDS.has(kind)) return { role: 'wall', levelId }
    // Plugin / custom architectural items default to furnishing so they read crisply with shadows.
    if (kind.includes(':')) return { role: 'item', levelId }
  }

  // 4. Fallback for unattributed meshes under the building: opaque items/fixtures.
  return { role: 'item', levelId }
}

/** Room outlines longer than this are simplified to fit the reveal's uniform array. */
const MAX_ROOM_POINTS = 64
/** The colour stops at the room's outline; this only catches the inner faces of its walls, metres. */
const ROOM_MARGIN = 0.02
/** Room height when its level gives none, metres. */
const DEFAULT_STOREY = 2.7
/** Colour spreading through a room, and drawing back when the tour moves on. */
const SPREAD_S = 1.5
const DRAW_BACK_S = 0.5

const easeOut = (t: number) => 1 - (1 - t) ** 3

/**
 * Where the current room is in colour, as one mask every material shares: inside the room's
 * outline (with a margin for its walls), between its floor and ceiling, and within the circle
 * spreading from its centre. Uniforms, so moving the circle or the room recompiles nothing.
 */
function createReveal() {
  const points = uniformArray(Array.from({ length: MAX_ROOM_POINTS }, () => new THREE.Vector2()), 'vec2')
  const count = uniform(0, 'int')
  const centre = uniform(new THREE.Vector2())
  const radius = uniform(0)
  const bottom = uniform(0)
  const top = uniform(0)
  const on = uniform(0)
  // The outline's bounds plus its margin: no point outside them can be in the room.
  const boundsMin = uniform(new THREE.Vector2())
  const boundsMax = uniform(new THREE.Vector2())

  const inside = Fn(() => {
    const p = positionWorld.xz
    const crossings = float(0).toVar()
    const nearest = float(1e6).toVar()
    const inStorey = step(bottom, positionWorld.y).mul(step(positionWorld.y, top))
    const inCircle = step(length(p.sub(centre)), radius)
    // The outline loop runs only where its answer can still matter: everywhere else the mask is 0
    // whatever the loop finds, so skipping it changes no pixel.
    const worthTesting = on.greaterThan(0.5)
      .and(inStorey.greaterThan(0.5))
      .and(inCircle.greaterThan(0.5))
      .and(p.x.greaterThanEqual(boundsMin.x)).and(p.y.greaterThanEqual(boundsMin.y))
      .and(p.x.lessThanEqual(boundsMax.x)).and(p.y.lessThanEqual(boundsMax.y))
    If(worthTesting, () => {
      Loop({ start: int(0), end: count, type: 'int', condition: '<' }, ({ i }) => {
        const a = vec2(points.element(i) as never)
        const b = vec2(points.element(select(i.equal(int(0)), count.sub(int(1)), i.sub(int(1))) as never) as never)
        If(step(p.y, a.y).notEqual(step(p.y, b.y)), () => {
          const x = b.x.sub(a.x).mul(p.y.sub(a.y)).div(b.y.sub(a.y)).add(a.x)
          If(p.x.lessThan(x), () => {
            crossings.assign(float(1).sub(crossings))
          })
        })
        const ab = b.sub(a)
        const t = clamp(dot(p.sub(a), ab).div(max(dot(ab, ab), float(1e-6))), 0, 1)
        nearest.assign(min(nearest, length(p.sub(a.add(ab.mul(t))))))
      })
    })
    const inRoom = max(crossings, step(nearest, float(ROOM_MARGIN)))
    return on.mul(inRoom).mul(inStorey).mul(inCircle)
  })()

  const box = new THREE.Box3()
  return {
    /** True where the room shows in colour. */
    coloured: inside.greaterThan(0.5),
    /** True everywhere else: where the wireframe shows. */
    wireframe: inside.lessThan(0.5),
    /** The room's extent in world space, for picking the meshes that need a colour twin. */
    box,
    /** Fully grown radius for the current room. */
    reach: 0,
    get radius() {
      return radius.value
    },
    set radius(value: number) {
      radius.value = value
    },
    setRoom(room: WorldRoom | null) {
      if (!room) {
        on.value = 0
        count.value = 0
        radius.value = 0
        box.makeEmpty()
        this.reach = 0
        return
      }
      const step = Math.max(1, Math.ceil(room.outline.length / MAX_ROOM_POINTS))
      const kept = room.outline.filter((_, i) => i % step === 0).slice(0, MAX_ROOM_POINTS)
      const array = points.array as THREE.Vector2[]
      for (let i = 0; i < MAX_ROOM_POINTS; i++) array[i]!.copy(kept[i] ?? kept[0]!)
      count.value = kept.length
      let cx = 0
      let cz = 0
      for (const point of kept) {
        cx += point.x
        cz += point.y
      }
      centre.value.set(cx / kept.length, cz / kept.length)
      let reach = 0
      for (const point of kept) reach = Math.max(reach, point.distanceTo(centre.value))
      this.reach = reach + ROOM_MARGIN + 0.1
      bottom.value = room.bottom - 0.05
      top.value = room.top + 0.1
      box.min.set(Infinity, room.bottom - 0.05, Infinity)
      box.max.set(-Infinity, room.top + 0.1, -Infinity)
      for (const point of kept) {
        box.min.x = Math.min(box.min.x, point.x - ROOM_MARGIN)
        box.min.z = Math.min(box.min.z, point.y - ROOM_MARGIN)
        box.max.x = Math.max(box.max.x, point.x + ROOM_MARGIN)
        box.max.z = Math.max(box.max.z, point.y + ROOM_MARGIN)
      }
      // A centimetre of slack, so float rounding at the margin's edge never drops a pixel.
      boundsMin.value.set(box.min.x - 0.01, box.min.z - 0.01)
      boundsMax.value.set(box.max.x + 0.01, box.max.z + 0.01)
      radius.value = 0
      on.value = 1
    },
  }
}

type Reveal = ReturnType<typeof createReveal>

type WorldRoom = { outline: THREE.Vector2[]; bottom: number; top: number }

type ZoneLike = { type?: string; polygon?: Array<[number, number]>; floor?: { elevation?: number }; parentId?: string | null }
type LevelLike = { type?: string; height?: number; baseElevation?: number }

/** A room's outline and storey in world space, through its level's placement. */
function worldRoom(zoneId: string, source: ViewerSource): WorldRoom | null {
  const zone = source.nodes[zoneId] as unknown as ZoneLike | undefined
  if (!zone?.polygon || zone.polygon.length < 3) return null
  const levelId = zone.parentId ?? null
  const levelNode = (levelId ? source.nodes[levelId] : undefined) as unknown as LevelLike | undefined
  const levelObject = levelId ? source.objectFor(levelId) : undefined
  const matrix = new THREE.Matrix4()
  if (levelObject) {
    levelObject.updateWorldMatrix(true, false)
    matrix.copy(levelObject.matrixWorld)
  } else {
    matrix.makeTranslation(0, levelNode?.baseElevation ?? 0, 0)
  }
  const floor = zone.floor?.elevation ?? 0
  const height = levelNode?.height ?? DEFAULT_STOREY
  const point = new THREE.Vector3()
  const outline = zone.polygon.map(([x, z]) => {
    point.set(x, floor, z).applyMatrix4(matrix)
    return new THREE.Vector2(point.x, point.z)
  })
  const bottom = point.set(zone.polygon[0]![0], floor, zone.polygon[0]![1]).applyMatrix4(matrix).y
  return { outline, bottom, top: bottom + height }
}

const NODE_CLASSES: Record<string, new () => THREE.Material> = {
  MeshStandardMaterial: MeshStandardNodeMaterial,
  MeshPhysicalMaterial: MeshPhysicalNodeMaterial,
  MeshBasicMaterial: MeshBasicNodeMaterial,
  MeshLambertMaterial: MeshLambertNodeMaterial,
  MeshPhongMaterial: MeshPhongNodeMaterial,
  MeshToonMaterial: MeshToonNodeMaterial,
}
const UNCOPIED = new Set(['id', 'uuid', 'type', 'maskNode', 'userData', '_listeners'])

/**
 * The mesh's own material, shown only where the room is in colour. A plain material becomes its
 * node twin the way the renderer converts it (`NodeLibrary.fromMaterial`), so it can take a mask.
 */
function colourCopy(material: THREE.Material, reveal: Reveal): THREE.Material | null {
  const source = material as THREE.Material & { isNodeMaterial?: boolean; maskNode?: unknown }
  const NodeClass = source.isNodeMaterial
    ? (material.constructor as new () => THREE.Material)
    : NODE_CLASSES[material.type]
  if (!NodeClass) return null
  const copy = new NodeClass() as THREE.Material & { maskNode?: unknown }
  for (const key in material) {
    if (UNCOPIED.has(key)) continue
    ;(copy as unknown as Record<string, unknown>)[key] = (material as unknown as Record<string, unknown>)[key]
  }
  copy.maskNode = source.maskNode ? bool(source.maskNode as never).and(reveal.coloured) : reveal.coloured
  copy.userData = { ...material.userData, __tourNoir: true }
  return copy
}

function createKit(palette: Palette, reveal: Reveal) {
  const wall = new MeshStandardNodeMaterial({
    color: palette.wall,
    roughness: 0.6,
    metalness: 0,
    transparent: true,
    opacity: palette.wallOpacity,
    depthWrite: false,
  })
  const item = new MeshStandardNodeMaterial({
    color: palette.item,
    roughness: 0.6,
    metalness: 0,
    transparent: true,
    opacity: palette.itemOpacity,
    depthWrite: false,
  })
  const floor = new MeshStandardNodeMaterial({
    color: palette.floor,
    roughness: 0.95,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  // Glass outside the room is ghosted like a wall: no tint, no reflections.
  const glass = new MeshStandardNodeMaterial({
    color: palette.glass,
    roughness: 0.6,
    metalness: 0,
    transparent: true,
    opacity: palette.glassOpacity,
    depthWrite: false,
  })
  // The site's ground in the Noir near-black, whatever finish the project gives it.
  const ground = new MeshStandardNodeMaterial({ color: palette.ground, roughness: 1, metalness: 0 })
  const wallEdge = new LineBasicNodeMaterial({ color: palette.edge, transparent: true, opacity: palette.wallEdgeOpacity, depthWrite: false })
  const itemEdge = new LineBasicNodeMaterial({ color: palette.edge, transparent: true, opacity: palette.itemEdgeOpacity, depthWrite: false })
  // Lines write nothing to the scene pass's normals and diffuse colour (as Pascal's own dust and
  // light glows do), so the screen-space ink doesn't double the edges.
  for (const line of [wallEdge, itemEdge]) line.mrtNode = mrt({ output, diffuseColor: vec4(0), normal: vec4(0) })
  // The wireframe gives way where the room is in colour.
  for (const material of [wall, item, floor, glass, wallEdge, itemEdge]) material.maskNode = reveal.wireframe
  for (const material of [wall, item, floor, glass, ground, wallEdge, itemEdge]) material.userData.__tourNoir = true
  return {
    wall, item, floor, glass, ground, wallEdge, itemEdge,
    paint(next: Palette) {
      wall.color.set(next.wall)
      wall.opacity = next.wallOpacity
      item.color.set(next.item)
      item.opacity = next.itemOpacity
      floor.color.set(next.floor)
      ground.color.set(next.ground)
      glass.color.set(next.glass)
      glass.opacity = next.glassOpacity
      wallEdge.color.set(next.edge)
      wallEdge.opacity = next.wallEdgeOpacity
      itemEdge.color.set(next.edge)
      itemEdge.opacity = next.itemEdgeOpacity
    },
    dispose() {
      for (const material of [wall, item, floor, glass, ground, wallEdge, itemEdge]) material.dispose()
    },
  }
}

type Kit = ReturnType<typeof createKit>

/** three's drawing pipeline, as far as the tour touches it: which objects a render skips. */
type CullingPipeline = { isCulled?: (object: THREE.Object3D, camera: THREE.Camera) => boolean }

function surfaceFor(kit: Kit, role: NoirRole): THREE.Material {
  if (role === 'ground') return kit.ground
  return role === 'wall' ? kit.wall : role === 'item' ? kit.item : role === 'floor' ? kit.floor : kit.glass
}

/**
 * Works out the tour's edges in idle time once the scene is drawn, so starting the tour finds them
 * ready instead of freezing the page while it computes them. Same meshes, same edges: `TourNoir`
 * reads them from the cache.
 */
export function TourEdgePrewarm({ source }: { source: ViewerSource }) {
  const { scene } = useThree()
  const liveSource = useRef(source)
  liveSource.current = source
  useEffect(() => {
    let cancelled = false
    let handle = 0
    const hasIdle = typeof window.requestIdleCallback === 'function'
    const idle = (fn: (budget: () => number) => void) => {
      if (hasIdle) {
        handle = window.requestIdleCallback((deadline) => fn(() => deadline.timeRemaining()), { timeout: 500 })
      } else {
        handle = window.setTimeout(() => {
          const until = performance.now() + 8
          fn(() => until - performance.now())
        }, 50)
      }
    }
    const queue: THREE.BufferGeometry[] = []
    const collect = () => {
      const nodes = liveSource.current.nodes as unknown as Record<string, NodeLike | undefined>
      const owners = buildLiveOwnerMap(nodes)
      const seen = new Set<THREE.BufferGeometry>()
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh || !mesh.geometry || seen.has(mesh.geometry)) return
        if (isUnderTourNoir(obj) || isSiteEnvironmentObject(obj, owners)) return
        if (materialIsInvisibleHitbox(mesh.material) || !mesh.visible || isTourMaterial(mesh.material)) return
        const role = classifyMesh(mesh, owners)?.role
        if (role !== 'wall' && role !== 'item') return
        seen.add(mesh.geometry)
        if (!hasEdgeLines(mesh.geometry, EDGE_THRESHOLD_DEG)) queue.push(mesh.geometry)
      })
    }
    const work = (budget: () => number) => {
      if (cancelled) return
      // One geometry at least per slice, and up to 8 ms while the browser reports little idle time,
      // so a long queue still moves on a busy page.
      const sliceEnd = performance.now() + 8
      do {
        const geometry = queue.shift()
        if (!geometry) return
        if (geometry.getAttribute('position')) edgeLines(geometry, EDGE_THRESHOLD_DEG)
      } while (budget() > 2 || performance.now() < sliceEnd)
      if (queue.length) idle(work)
    }
    // Let the first frames of the scene settle before using spare time.
    const start = window.setTimeout(() => {
      if (cancelled) return
      collect()
      idle(work)
    }, 1500)
    return () => {
      cancelled = true
      window.clearTimeout(start)
      if (hasIdle) window.cancelIdleCallback(handle)
      else window.clearTimeout(handle)
    }
  }, [scene])
  return null
}

export function TourNoir({ source }: { source: ViewerSource }) {
  const { scene, invalidate, gl } = useThree()
  const dark = useDarkTheme()
  const palette = PALETTES[dark ? 'noir' : 'paper']
  const liveSource = useRef(source)
  liveSource.current = source

  const reveal = useMemo(() => createReveal(), [])
  const kit = useMemo(
    () => createKit(PALETTES[document.documentElement.classList.contains('dark') ? 'noir' : 'paper'], reveal),
    [reveal],
  )
  const stash = useRef({
    meshes: new Map<THREE.Mesh, MeshStash>(),
    hidden: new Map<THREE.Object3D, boolean>(),
    twins: new Map<THREE.Mesh, THREE.Mesh>(),
    colours: new Map<THREE.Material, THREE.Material | null>(),
    elapsed: 0,
    room: null as string | null,
    spreadFrom: 0,
    spreadAt: 0,
  })

  // The Noir theme and Pascal's ink edges; the visitor's own look comes back on exit. Textures stay
  // as the visitor had them, so the room in colour shows its real finishes. Set on the store
  // directly, so nothing is written to the visitor's saved preferences.
  const appearance = useMemo(() => tourAppearance(dark), [dark])
  useLayoutEffect(() => {
    const before = useViewer.getState()
    const saved = { edges: before.edges, shadows: before.shadows }
    const apply = () => useViewer.setState({ edges: 'soft', shadows: true, sceneAppearance: appearance as never })
    apply()
    // Anything that resolves the look again (a theme pick, a project preference) would bring the
    // saved theme back mid-tour; put the Noir one back on.
    const unsubscribe = useViewer.subscribe((state) => {
      if (state.sceneAppearance !== (appearance as never)) apply()
    })
    return () => {
      unsubscribe()
      useViewer.setState({ edges: saved.edges, shadows: saved.shadows })
      // Resolve the visitor's own scene theme again from their preferences.
      useViewer.getState().showSceneTheme(useViewer.getState().previewSceneTheme)
    }
  }, [appearance])

  useEffect(() => {
    kit.paint(palette)
    invalidate()
  }, [kit, palette, invalidate])

  const colourFor = (material: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] | null => {
    const { colours } = stash.current
    const one = (entry: THREE.Material) => {
      if (!colours.has(entry)) colours.set(entry, colourCopy(entry, reveal))
      return colours.get(entry) ?? null
    }
    if (!Array.isArray(material)) return one(material)
    const list = material.map(one)
    return list.every(Boolean) ? (list as THREE.Material[]) : null
  }

  const removeTwin = (mesh: THREE.Mesh) => {
    const { twins } = stash.current
    twins.get(mesh)?.removeFromParent()
    twins.delete(mesh)
  }

  /** A twin of the mesh in its own material, for the meshes the current room reaches. */
  const syncTwin = (mesh: THREE.Mesh, saved: MeshStash) => {
    const { twins } = stash.current
    if (saved.role === 'ground') return
    const meshBox = _meshBox.setFromObject(mesh)
    const near = reveal.reach > 0 && !reveal.box.isEmpty() && meshBox.intersectsBox(reveal.box)
    const existing = twins.get(mesh)
    if (!near) {
      if (existing) removeTwin(mesh)
      return
    }
    const material = colourFor(saved.material)
    if (!material) {
      if (existing) removeTwin(mesh)
      return
    }
    if (existing && existing.geometry === mesh.geometry) {
      existing.material = material
      return
    }
    if (existing) removeTwin(mesh)
    const instanced = mesh as THREE.InstancedMesh
    let twin: THREE.Mesh
    if (instanced.isInstancedMesh) {
      const copy = new THREE.InstancedMesh(mesh.geometry, material, instanced.count)
      copy.instanceMatrix = instanced.instanceMatrix
      copy.instanceColor = instanced.instanceColor
      twin = copy
    } else if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      return
    } else {
      twin = new THREE.Mesh(mesh.geometry, material)
    }
    twin.raycast = NO_RAYCAST
    twin.userData = { __tourNoir: true }
    twin.layers.mask = mesh.layers.mask
    // The colour spreads as a circle; a shadow from it would show the circle's cut edge on the floor.
    twin.castShadow = false
    twin.receiveShadow = saved.receiveShadow
    twin.renderOrder = mesh.renderOrder
    twin.frustumCulled = mesh.frustumCulled
    mesh.add(twin)
    twins.set(mesh, twin)
  }

  const syncTwins = () => {
    for (const [mesh, saved] of stash.current.meshes) syncTwin(mesh, saved)
  }

  const scan = () => {
    const nodes = liveSource.current.nodes as unknown as Record<string, NodeLike | undefined>
    const owners = buildLiveOwnerMap(nodes)
    const { meshes } = stash.current
    const { hidden } = stash.current
    scene.traverse((obj) => {
      if (isUnderTourNoir(obj)) return
      if (isSiteEnvironmentObject(obj, owners)) {
        // The site's boundary line goes. The ground stays, in the theme's ground colour: hiding it
        // would read as looking underground.
        if ((obj as THREE.Line).isLine) {
          if (!hidden.has(obj)) hidden.set(obj, obj.visible)
          obj.visible = false
        }
        const ground = obj as THREE.Mesh
        // A baked project's ground carries no role; only the veil (shown below grade) is left alone.
        if (ground.isMesh && obj.userData?.[SITE_GROUND] !== 'veil' && !meshes.has(ground)) {
          meshes.set(ground, {
            material: ground.material,
            castShadow: ground.castShadow,
            receiveShadow: ground.receiveShadow,
            role: 'ground',
            geometryUuid: ground.geometry.uuid,
            edge: null,
          })
          ground.material = kit.ground
        }
        return
      }
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      const known = meshes.get(mesh)
      if (known) {
        if (mesh.geometry?.uuid !== known.geometryUuid) {
          // Rebuilt geometry: its edges and its colour twin are drawn again.
          known.edge?.removeFromParent()
          known.edge?.geometry.dispose()
          known.edge = addEdges(mesh, known.role)
          known.geometryUuid = mesh.geometry.uuid
          syncTwin(mesh, known)
        }
        return
      }
      if (materialIsInvisibleHitbox(mesh.material) || !mesh.visible || isTourMaterial(mesh.material)) return
      const classified = classifyMesh(mesh, owners)
      if (!classified) return
      const { role } = classified
      const saved: MeshStash = {
        material: mesh.material,
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
        role,
        geometryUuid: mesh.geometry.uuid,
        edge: addEdges(mesh, role),
      }
      meshes.set(mesh, saved)
      mesh.material = surfaceFor(kit, role)
      mesh.castShadow = false
      mesh.receiveShadow = role === 'floor'
      syncTwin(mesh, saved)
    })
    invalidate()
  }

  const addEdges = (mesh: THREE.Mesh, role: NoirRole): THREE.LineSegments | null => {
    if (role !== 'wall' && role !== 'item') return null
    const edges = flatEdges(mesh.geometry, EDGE_THRESHOLD_DEG)
    if (!edges.getAttribute('position')?.count) {
      edges.dispose()
      return null
    }
    const line = new THREE.LineSegments(edges, role === 'wall' ? kit.wallEdge : kit.itemEdge)
    line.raycast = NO_RAYCAST
    line.userData = { __tourNoir: true }
    line.layers.mask = mesh.layers.mask
    mesh.add(line)
    return line
  }

  // Restyle on mount; restore every mesh before the viewer's own materials come back.
  useLayoutEffect(() => {
    const state = stash.current
    scan()
    return () => {
      for (const mesh of [...state.twins.keys()]) removeTwin(mesh)
      for (const [mesh, saved] of state.meshes) {
        saved.edge?.removeFromParent()
        saved.edge?.geometry.dispose()
        if (mesh.material === surfaceFor(kit, saved.role)) mesh.material = saved.material
        mesh.castShadow = saved.castShadow
        mesh.receiveShadow = saved.receiveShadow
      }
      state.meshes.clear()
      for (const copy of state.colours.values()) copy?.dispose()
      state.colours.clear()
      for (const [obj, visible] of state.hidden) obj.visible = visible
      state.hidden.clear()
      kit.dispose()
      invalidate()
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: mount and unmount only
  }, [])

  // Pascal culls what its walls, slabs and roofs hide from the eye (`attachOcclusionCuller` in
  // `@pascal-app/viewer`, through the renderer's drawing pipeline). In the tour the walls are see-
  // through and the room's near walls drop away, so that would hide furniture in plain view (a
  // toilet behind a near wall, depending on the angle). The tour draws with frustum culling only,
  // and gives Pascal's culling back on exit.
  const pipeline = (gl as unknown as { drawingPipeline?: CullingPipeline }).drawingPipeline
  const culling = useRef<{ own: CullingPipeline['isCulled']; before: CullingPipeline['isCulled'] } | null>(null)
  useEffect(() => {
    const frustumOnly = pipeline && Object.getPrototypeOf(pipeline)?.isCulled
    if (!pipeline || typeof frustumOnly !== 'function') return
    const own: CullingPipeline['isCulled'] = function (this: unknown, object, camera) {
      return frustumOnly.call(this, object, camera)
    }
    culling.current = { own, before: pipeline.isCulled }
    pipeline.isCulled = own
    invalidate()
    return () => {
      if (pipeline.isCulled === own) pipeline.isCulled = culling.current?.before
      culling.current = null
      invalidate()
    }
  }, [pipeline, invalidate])

  // Pascal swaps materials when it rebuilds or relights a mesh; keep the tour's on, and pick up
  // meshes that arrive late (items loading, walls rebuilt). The colour circle grows on arrival and
  // draws back when the tour moves on.
  useFrame((_, delta) => {
    const state = stash.current
    for (const [mesh, saved] of state.meshes) {
      // Pascal takes some meshes out of the scene for a moment and puts them back: their colour
      // twin and edges are children and travel with them, so a detached mesh is simply left be.
      // Dropping it would lose its own material (the next scan would take the tour's for it).
      if (!mesh.parent) continue
      const surface = surfaceFor(kit, saved.role)
      if (mesh.material !== surface) {
        if (!isTourMaterial(mesh.material)) {
          saved.material = mesh.material
          syncTwin(mesh, saved)
        }
        mesh.material = surface
      }
    }
    for (const obj of state.hidden.keys()) obj.visible = false
    // Pascal attaches its culler again when the bake's batches are rebuilt: keep it off.
    if (pipeline && culling.current && pipeline.isCulled !== culling.current.own) {
      culling.current.before = pipeline.isCulled
      pipeline.isCulled = culling.current.own
    }

    const look = useTourLook.getState()
    const now = performance.now() / 1000
    if (look.roomId !== state.room) {
      if (reveal.radius > 0.01) {
        // Draw the colour back before the next room.
        reveal.radius = Math.max(0, reveal.radius - (reveal.reach / DRAW_BACK_S) * delta)
      } else {
        state.room = look.roomId
        reveal.setRoom(state.room ? worldRoom(state.room, liveSource.current) : null)
        state.spreadAt = 0
        syncTwins()
        scan()
      }
      invalidate()
    } else if (state.room && look.arrived && reveal.reach > 0) {
      if (!state.spreadAt) {
        state.spreadAt = now
        state.spreadFrom = reveal.radius
      }
      const t = Math.min(1, (now - state.spreadAt) / SPREAD_S)
      const next = state.spreadFrom + (reveal.reach - state.spreadFrom) * easeOut(t)
      if (Math.abs(next - reveal.radius) > 1e-4) {
        reveal.radius = next
        invalidate()
      }
    }

    state.elapsed += delta
    if (state.elapsed >= RESCAN_INTERVAL_S) {
      state.elapsed = 0
      scan()
    }
  })

  return null
}

import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import {
  hasMaterialsForGroups,
  OVERLAY_LAYER,
  setSurfaceRaycastLayers,
  SHADOW_ONLY_LAYER,
  SITE_GROUND,
} from '@pascal-app/viewer'
import {
  Box3,
  type BufferGeometry,
  type Camera,
  type InstancedMesh,
  type Intersection,
  type Material,
  MathUtils,
  Matrix4,
  type Mesh,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  Raycaster,
  type Scene,
  Vector2,
  Vector3,
} from 'three'
import type { MeshBVH } from 'three-mesh-bvh'
import type { AxisLock, Vec3 } from './store'

/** Screen-space radius (CSS px) within which the cursor snaps to a mesh vertex or endpoint. */
export const SNAP_RADIUS_PX = 10

/** Meshes with at most this many vertices are scanned directly; denser meshes use BVH or the hit face. */
const MAX_FULL_SCAN_VERTICES = 2000
/** Upper bound on BVH leaf triangles inspected during dense-mesh vertex snapping. */
const MAX_BVH_SNAP_TRIANGLES = 512

const HELPER_NAMES = new Set([
  'wall-collision',
  'collision-mesh',
  'curtain-wall-shadow',
  'ceiling-grid',
  'collider',
  'cutout',
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

const _raycaster = new Raycaster()
setSurfaceRaycastLayers(_raycaster.layers)

const _ndc = new Vector2()
const _proj = new Vector3()
const _camSpace = new Vector3()
const _worldPos = new Vector3()
const _localHit = new Vector3()
const _localSnapBox = new Box3()
const _invMatrix = new Matrix4()
const _instanceMatrix = new Matrix4()
const _worldMatrix = new Matrix4()
const _scale = new Vector3()

export interface MeasureHit {
  point: Vec3
  snapped: boolean
}

let cachedNodesRef: unknown = null
let cachedLiveKinds: WeakMap<Object3D, string> | null = null

function getLiveKindMap(): WeakMap<Object3D, string> {
  const nodes = useScene.getState().nodes
  if (cachedLiveKinds && cachedNodesRef === nodes) return cachedLiveKinds
  const map = new WeakMap<Object3D, string>()
  for (const [id, obj] of sceneRegistry.nodes) {
    const node = nodes[id as AnyNodeId]
    if (node) map.set(obj, node.type)
  }
  cachedNodesRef = nodes
  cachedLiveKinds = map
  return map
}

/**
 * Resolves the scene mesh root to raycast against:
 * - Baked GLB path: the top-level ancestor of `glbObjects` under `scene`.
 * - Live parametric path: `<group name="scene-renderer">` mounted by `SceneRenderer`.
 */
export function resolveMeasureRoot(
  scene: Scene,
  glbActive: boolean,
  glbObjects: ReadonlyMap<string, Object3D>,
): Object3D | null {
  if (glbActive) {
    let root: Object3D | null = glbObjects.values().next().value ?? null
    while (root?.parent && root.parent !== scene) root = root.parent
    return root
  }
  return scene.getObjectByName('scene-renderer') ?? null
}

/** Metres per CSS pixel at `worldPoint`, matching both perspective and orthographic projections. */
export function worldUnitsPerPixelAt(worldPoint: Vector3, camera: Camera, viewportHeight: number): number {
  const height = Math.max(viewportHeight, 1)
  if ((camera as PerspectiveCamera).isPerspectiveCamera) {
    const perspective = camera as PerspectiveCamera
    const depth = Math.abs(_camSpace.copy(worldPoint).applyMatrix4(perspective.matrixWorldInverse).z)
    return (2 * Math.max(depth, 0.05) * Math.tan(MathUtils.degToRad(perspective.getEffectiveFOV() * 0.5))) / height
  }
  if ((camera as OrthographicCamera).isOrthographicCamera) {
    const ortho = camera as OrthographicCamera
    return (ortho.top - ortho.bottom) / Math.max(ortho.zoom * height, 1)
  }
  return 0.01
}

function isMaterialVisible(material: Material | Material[] | undefined): boolean {
  if (!material) return false
  return Array.isArray(material) ? material.some((entry) => entry && entry.visible) : material.visible
}

function shouldSkipSubtree(object: Object3D): boolean {
  if (!object.visible) return true
  if (object.layers.isEnabled(SHADOW_ONLY_LAYER)) return true
  if (object.layers.isEnabled(OVERLAY_LAYER)) return true
  const ud = object.userData
  if (ud.__measureTool === true || ud.__tourNoir === true || ud.__tourNoirEdge === true) return true
  return false
}

function intersectSurface(raycaster: Raycaster, root: Object3D): Intersection[] {
  const hits: Intersection[] = []
  const visit = (current: Object3D) => {
    if (shouldSkipSubtree(current)) return
    let result: unknown
    if (current.layers.test(raycaster.layers) && hasMaterialsForGroups(current)) {
      result = current.raycast(raycaster, hits)
    }
    if (result === false) return
    const children = current.children
    for (let i = 0; i < children.length; i++) {
      visit(children[i]!)
    }
  }
  visit(root)
  hits.sort((a, b) => a.distance - b.distance)
  return hits
}

function owningKind(object: Object3D, liveKinds: WeakMap<Object3D, string> | null): string | null {
  for (let current: Object3D | null = object; current; current = current.parent) {
    const bakedKind = current.userData.kind as string | undefined
    if (bakedKind && bakedKind !== 'level' && bakedKind !== 'building' && bakedKind !== 'site') {
      return bakedKind
    }
    const liveKind = liveKinds?.get(current)
    if (liveKind && liveKind !== 'level' && liveKind !== 'building' && liveKind !== 'site') {
      return liveKind
    }
  }
  return null
}

function isValidSurfaceHit(hit: Intersection, liveKinds: WeakMap<Object3D, string> | null): hit is Intersection<Mesh> {
  const mesh = hit.object as Mesh
  if (!mesh.isMesh) return false
  if (mesh.userData.glbBatch === true) return false
  if (mesh.userData[SITE_GROUND] === 'veil') return false
  if (HELPER_NAMES.has(mesh.name)) return false
  if (!isMaterialVisible(mesh.material)) return false
  const pos = mesh.geometry?.getAttribute('position')
  if (!pos || pos.count === 0) return false
  const kind = owningKind(mesh, liveKinds)
  if (kind && SKIP_KINDS.has(kind)) return false
  return true
}

function screenDistancePx(
  worldPoint: Vector3,
  camera: Camera,
  pointerPxX: number,
  pointerPxY: number,
  width: number,
  height: number,
): number {
  _proj.copy(worldPoint).project(camera)
  if (_proj.z < -1 || _proj.z > 1) return Number.POSITIVE_INFINITY
  const sx = ((_proj.x + 1) * 0.5) * width
  const sy = ((1 - _proj.y) * 0.5) * height
  return Math.hypot(sx - pointerPxX, sy - pointerPxY)
}

function findSnappedVertex(
  hit: Intersection<Mesh>,
  camera: Camera,
  pointerPxX: number,
  pointerPxY: number,
  width: number,
  height: number,
  existingEndpoints: readonly Vec3[],
): Vec3 | null {
  let bestDist = SNAP_RADIUS_PX
  let bestPoint: Vec3 | null = null

  const considerWorld = (wx: number, wy: number, wz: number) => {
    _worldPos.set(wx, wy, wz)
    const d = screenDistancePx(_worldPos, camera, pointerPxX, pointerPxY, width, height)
    if (d < bestDist) {
      bestDist = d
      bestPoint = [wx, wy, wz]
    }
  }

  // 1. Existing measurement endpoints allow chaining measurements seamlessly.
  for (let i = 0; i < existingEndpoints.length; i++) {
    const ep = existingEndpoints[i]!
    considerWorld(ep[0], ep[1], ep[2])
  }

  const mesh = hit.object
  const geometry = mesh.geometry as BufferGeometry & { boundsTree?: MeshBVH }
  const position = geometry.getAttribute('position')
  if (!position) return bestPoint

  mesh.updateWorldMatrix(true, false)
  if (hit.instanceId !== undefined && (mesh as InstancedMesh).isInstancedMesh) {
    ;(mesh as InstancedMesh).getMatrixAt(hit.instanceId, _instanceMatrix)
    _worldMatrix.multiplyMatrices(mesh.matrixWorld, _instanceMatrix)
  } else {
    _worldMatrix.copy(mesh.matrixWorld)
  }

  const considerLocal = (lx: number, ly: number, lz: number) => {
    _worldPos.set(lx, ly, lz).applyMatrix4(_worldMatrix)
    const d = screenDistancePx(_worldPos, camera, pointerPxX, pointerPxY, width, height)
    if (d < bestDist) {
      bestDist = d
      bestPoint = [_worldPos.x, _worldPos.y, _worldPos.z]
    }
  }

  // 2. Always check the 3 vertices of the directly hit triangle.
  if (hit.face) {
    const { a, b, c } = hit.face
    if (a < position.count) considerLocal(position.getX(a), position.getY(a), position.getZ(a))
    if (b < position.count) considerLocal(position.getX(b), position.getY(b), position.getZ(b))
    if (c < position.count) considerLocal(position.getX(c), position.getY(c), position.getZ(c))
  }

  // 3. Check nearby mesh vertices within a generous local-space box around the hit point.
  const worldPerPx = worldUnitsPerPixelAt(hit.point, camera, height)
  const worldRadius = Math.max(worldPerPx * SNAP_RADIUS_PX * 3, 0.05)
  _scale.setFromMatrixScale(_worldMatrix)
  const minScale = Math.max(Math.min(Math.abs(_scale.x), Math.abs(_scale.y), Math.abs(_scale.z)), 1e-4)
  const localRadius = worldRadius / minScale

  _invMatrix.copy(_worldMatrix).invert()
  _localHit.copy(hit.point).applyMatrix4(_invMatrix)
  _localSnapBox.min.set(_localHit.x - localRadius, _localHit.y - localRadius, _localHit.z - localRadius)
  _localSnapBox.max.set(_localHit.x + localRadius, _localHit.y + localRadius, _localHit.z + localRadius)

  if (position.count <= MAX_FULL_SCAN_VERTICES) {
    const rSq = localRadius * localRadius
    for (let i = 0; i < position.count; i++) {
      const lx = position.getX(i)
      const ly = position.getY(i)
      const lz = position.getZ(i)
      const dx = lx - _localHit.x
      const dy = ly - _localHit.y
      const dz = lz - _localHit.z
      if (dx * dx + dy * dy + dz * dz <= rSq) {
        considerLocal(lx, ly, lz)
      }
    }
  } else if (geometry.boundsTree && typeof geometry.boundsTree.shapecast === 'function') {
    let tested = 0
    geometry.boundsTree.shapecast({
      intersectsBounds: (box) => tested < MAX_BVH_SNAP_TRIANGLES && box.intersectsBox(_localSnapBox),
      intersectsTriangle: (tri) => {
        tested += 1
        considerLocal(tri.a.x, tri.a.y, tri.a.z)
        considerLocal(tri.b.x, tri.b.y, tri.b.z)
        considerLocal(tri.c.x, tri.c.y, tri.c.z)
        return tested >= MAX_BVH_SNAP_TRIANGLES
      },
    })
  }

  return bestPoint
}

/**
 * Raycasts the active scene root at the given canvas CSS pixel coordinates and snaps to
 * the nearest mesh vertex (or existing measurement endpoint) within `SNAP_RADIUS_PX`.
 */
export function pickMeasurePoint(
  root: Object3D,
  camera: Camera,
  pointerPxX: number,
  pointerPxY: number,
  width: number,
  height: number,
  glbActive: boolean,
  existingEndpoints: readonly Vec3[],
): MeasureHit | null {
  if (width < 1 || height < 1) return null
  _ndc.set((pointerPxX / width) * 2 - 1, -(pointerPxY / height) * 2 + 1)
  _raycaster.setFromCamera(_ndc, camera)

  const hits = intersectSurface(_raycaster, root)
  const liveKinds = glbActive ? null : getLiveKindMap()
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!
    if (!isValidSurfaceHit(hit, liveKinds)) continue
    const snapped = findSnappedVertex(hit, camera, pointerPxX, pointerPxY, width, height, existingEndpoints)
    if (snapped) return { point: snapped, snapped: true }
    return { point: [hit.point.x, hit.point.y, hit.point.z], snapped: false }
  }
  return null
}

/** Constrains `rawB` onto whichever world axis (X, Y, or Z) has the largest delta from `a`. */
export function constrainToDominantAxis(a: Vec3, rawB: Vec3): { point: Vec3; axis: Exclude<AxisLock, null> } {
  const dx = rawB[0] - a[0]
  const dy = rawB[1] - a[1]
  const dz = rawB[2] - a[2]
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  const adz = Math.abs(dz)
  if (adx >= ady && adx >= adz) {
    return { point: [rawB[0], a[1], a[2]], axis: 'x' }
  }
  if (ady >= adx && ady >= adz) {
    return { point: [a[0], rawB[1], a[2]], axis: 'y' }
  }
  return { point: [a[0], a[1], rawB[2]], axis: 'z' }
}

export function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

export function formatMetres(a: Vec3, b: Vec3): string {
  return `${distanceBetween(a, b).toFixed(2)} m`
}

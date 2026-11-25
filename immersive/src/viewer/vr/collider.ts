import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { BATCHED_LAYER, SCENE_LAYER } from '@pascal-app/viewer'
import {
  Box3,
  BoxGeometry,
  type BufferAttribute,
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  type InterleavedBufferAttribute,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'

export const VR_SPAWN_EYE_HEIGHT = 1.65

export interface VrColliderWorld {
  mesh: Mesh
  minY: number
  bounds: Box3 | null
  dispose: () => void
}

export interface VrSpawn {
  position: [number, number, number]
  yaw: number
}

// Excluded from VR collision so visitors can walk through doorways without mid-frame BVH rebuilds,
// and aren't blocked by helper volumes, roofs, ceilings, guides or scans.
const COLLIDER_EXCLUDED_KINDS = new Set([
  'zone',
  'spawn',
  'ceiling',
  'roof',
  'door',
  'window',
  'guide',
  'scan',
])

const SKIPPED_MESH_NAMES = new Set(['cutout', 'collision-mesh'])
const FALLBACK_THICKNESS = 0.08
const GROUND_MIN = 2000
const RAYCAST_CLEARANCE = 25

const colliderMaterial = new MeshBasicMaterial({ visible: false })
const DOWN = new Vector3(0, -1, 0)
const UP = new Vector3(0, 1, 0)
const spawnPos = new Vector3()
const spawnQuat = new Quaternion()
const spawnEuler = new Euler(0, 0, 0, 'YXZ')

function isEffectivelyVisible(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

function hasIgnoredAncestor(object: Object3D): boolean {
  let current: Object3D | null = object
  while (current) {
    const ud = current.userData
    if (ud.vrIgnore || ud.proceduralMotion || ud.pascalProceduralRest) return true
    current = current.parent
  }
  return false
}

function isMaterialVisible(material: Material | Material[] | undefined): boolean {
  if (!material) return false
  return Array.isArray(material) ? material.some((entry) => entry.visible) : material.visible
}

function buildRegistryKindMap(): WeakMap<Object3D, string> {
  const map = new WeakMap<Object3D, string>()
  const nodes = useScene.getState().nodes
  for (const [id, obj] of sceneRegistry.nodes) {
    const node = nodes[id as AnyNodeId]
    if (node) map.set(obj, node.type)
  }
  return map
}

function kindOf(object: Object3D, registryKinds: WeakMap<Object3D, string> | null): string | undefined {
  let current: Object3D | null = object
  while (current) {
    const kind = (current.userData.kind as string | undefined) ?? registryKinds?.get(current)
    if (kind) return kind
    current = current.parent
  }
  return undefined
}

function toFloat32Position(source: BufferAttribute | InterleavedBufferAttribute): Float32BufferAttribute {
  const array = new Float32Array(source.count * 3)
  for (let i = 0; i < source.count; i++) {
    array[i * 3] = source.getX(i)
    array[i * 3 + 1] = source.getY(i)
    array[i * 3 + 2] = source.getZ(i)
  }
  return new Float32BufferAttribute(array, 3)
}

function boxFloorGeometry(cx: number, topY: number, cz: number, width: number, depth: number): BufferGeometry {
  const box = new BoxGeometry(width, FALLBACK_THICKNESS, depth).toNonIndexed()
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', box.getAttribute('position').clone())
  box.dispose()
  geometry.applyMatrix4(new Matrix4().makeTranslation(cx, topY - FALLBACK_THICKNESS / 2, cz))
  return geometry
}

function addFallbackFloors(
  scene: Object3D,
  geometries: BufferGeometry[],
  registryKinds: WeakMap<Object3D, string> | null,
) {
  const sceneBounds = new Box3()
  for (const geometry of geometries) {
    geometry.computeBoundingBox()
    if (geometry.boundingBox) sceneBounds.union(geometry.boundingBox)
  }
  if (sceneBounds.isEmpty()) return

  const center = new Vector3()
  const levelPos = new Vector3()
  let lowestLevelY = Number.POSITIVE_INFINITY

  scene.traverse((object) => {
    const kind = (object.userData.kind as string | undefined) ?? registryKinds?.get(object)
    if (kind !== 'level') return
    object.updateWorldMatrix(true, false)
    object.getWorldPosition(levelPos)
    lowestLevelY = Math.min(lowestLevelY, levelPos.y)
  })

  sceneBounds.getCenter(center)
  const groundY = Number.isFinite(lowestLevelY) ? lowestLevelY : sceneBounds.min.y
  geometries.push(boxFloorGeometry(center.x, groundY, center.z, GROUND_MIN, GROUND_MIN))
}

/**
 * Build a single static BVH collider mesh from the rendered Three.js scene.
 * Works identically on baked GLB scenes and live parametric scenes.
 */
export function buildVrColliderWorld(scene: Object3D, glbActive: boolean): VrColliderWorld | null {
  scene.updateWorldMatrix(true, true)
  const registryKinds = glbActive ? null : buildRegistryKindMap()
  const geometries: BufferGeometry[] = []

  scene.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    if (mesh.userData.glbBatch) return
    if (SKIPPED_MESH_NAMES.has(mesh.name)) return
    if (!mesh.layers.isEnabled(SCENE_LAYER) && !mesh.layers.isEnabled(BATCHED_LAYER)) return
    if (!isEffectivelyVisible(mesh)) return
    if (!isMaterialVisible(mesh.material)) return
    if (hasIgnoredAncestor(mesh)) return

    const kind = kindOf(mesh, registryKinds)
    if (kind && COLLIDER_EXCLUDED_KINDS.has(kind)) return

    const position = mesh.geometry?.getAttribute('position')
    if (!position || position.count < 3) return

    const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', toFloat32Position(source.getAttribute('position')))
    if (mesh.geometry.index) source.dispose()
    geometry.applyMatrix4(mesh.matrixWorld)
    geometries.push(geometry)
  })

  if (geometries.length === 0) return null
  addFallbackFloors(scene, geometries, registryKinds)

  const merged = mergeGeometries(geometries, false)
  for (const geometry of geometries) geometry.dispose()
  if (!merged || merged.getAttribute('position') == null) {
    merged?.dispose()
    return null
  }

  Object.assign(merged, { computeBoundsTree, disposeBoundsTree })
  computeBoundsTree.call(merged, { targetLeafSize: 12, strategy: 0 })
  merged.computeBoundingBox()

  const mesh = new Mesh(merged, colliderMaterial)
  mesh.raycast = acceleratedRaycast
  mesh.visible = true
  mesh.userData = {
    type: 'STATIC',
    friction: 0.8,
    restitution: 0.05,
    excludeFloatHit: false,
    excludeCollisionCheck: false,
    vrIgnore: true,
  }
  mesh.updateMatrixWorld(true)

  return {
    mesh,
    minY: merged.boundingBox?.min.y ?? 0,
    bounds: merged.boundingBox?.clone() ?? null,
    dispose: () => {
      disposeBoundsTree.call(merged)
      merged.dispose()
    },
  }
}

/** Resolve the walkthrough spawn marker's eye position + yaw, or drop onto the floor near scene center. */
export function resolveVrSpawn(scene: Object3D, world: VrColliderWorld | null, glbActive: boolean): VrSpawn {
  if (glbActive) {
    let spawn: Object3D | null = null
    scene.traverse((object) => {
      if (object.userData.kind === 'spawn') spawn = object
    })
    if (spawn) {
      const node = spawn as Object3D
      node.updateWorldMatrix(true, false)
      node.getWorldPosition(spawnPos)
      node.getWorldQuaternion(spawnQuat)
      spawnEuler.setFromQuaternion(spawnQuat, 'YXZ')
      return {
        position: [spawnPos.x, spawnPos.y + VR_SPAWN_EYE_HEIGHT, spawnPos.z],
        yaw: spawnEuler.y,
      }
    }
  } else {
    const nodes = useScene.getState().nodes
    const spawns = Object.values(nodes)
      .filter((node) => node.type === 'spawn')
      .sort((a, b) => a.id.localeCompare(b.id))
    const placed = spawns[0]
    if (placed && placed.type === 'spawn') {
      const spawnObject = sceneRegistry.nodes.get(placed.id)
      if (spawnObject) {
        spawnObject.updateWorldMatrix(true, false)
        spawnObject.getWorldPosition(spawnPos)
        spawnEuler.setFromRotationMatrix(spawnObject.matrixWorld, 'YXZ')
        return {
          position: [spawnPos.x, spawnPos.y + VR_SPAWN_EYE_HEIGHT, spawnPos.z],
          yaw: spawnEuler.y,
        }
      }
      return {
        position: [placed.position[0], placed.position[1] + VR_SPAWN_EYE_HEIGHT, placed.position[2]],
        yaw: placed.rotation,
      }
    }
  }

  // Fallback: raycast down onto the walkable collider near the scene's horizontal center.
  if (world) {
    const center = world.bounds?.getCenter(new Vector3()) ?? new Vector3(0, 0, 0)
    const topY = (world.bounds?.max.y ?? 10) + RAYCAST_CLEARANCE
    const raycaster = new Raycaster(new Vector3(center.x, topY, center.z), DOWN)
    const hits = raycaster.intersectObject(world.mesh, false)
    const floorHit = hits.find((hit) => {
      if (!hit.face) return true
      const normal = hit.face.normal.clone().transformDirection(world.mesh.matrixWorld)
      return normal.dot(UP) > 0.2
    })
    if (floorHit) {
      return {
        position: [floorHit.point.x, floorHit.point.y + VR_SPAWN_EYE_HEIGHT, floorHit.point.z],
        yaw: 0,
      }
    }
  }

  return { position: [0, VR_SPAWN_EYE_HEIGHT, 0], yaw: 0 }
}

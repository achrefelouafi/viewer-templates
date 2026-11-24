import { sceneRegistry, useScene } from '@pascal-app/core'
import { getVisibleWallMaterials, getWallFinishRefs, hideFromScene, showInScene, useViewer } from '@pascal-app/viewer'
import type { ViewerSource } from '@pascal-app/viewer/ui'
import { Box3, Group, InstancedMesh, type Material, Matrix4, Mesh, type Object3D, Vector3 } from 'three'
import type { NodeMaterial, WebGPURenderer } from 'three/webgpu'
import { developedMaterial, type SurfaceClass, xrayMaterial } from './ink'

/**
 * The house in ink, ported from the Pascal template's guided tour. Every mesh the viewer draws gets a twin: an exact copy
 * of it (its own material, drawn only where colour has developed) and an X-ray copy (glass, a
 * ghost, a sheet; drawn everywhere else). The originals are held off the scene layer through the
 * viewer's own visibility API and handed back after.
 *
 * The viewer keeps changing what it draws: walls swap materials with the wall mode and the camera,
 * meshes are rebuilt, doors open, levels above the selected one turn shadow-only. So the twins are
 * not a snapshot: `sync` runs every frame and follows each original's geometry, transform,
 * material and visibility, and `rescan` picks up meshes the viewer adds.
 *
 * `keep` names the nodes that stay in their own colours whatever the ink does: the ones a Home
 * Assistant entity drives. Their meshes are left to the viewer; one drawn through an item batch
 * gets a copy wearing its own material, since its batch is held back.
 */

type Node = Record<string, unknown> & { id: string; type: string; parentId?: string | null }

/** Layers the viewer uses (`@pascal-app/viewer` lib/layers): drawn, shadow-only, batched. */
const SCENE_LAYER = 0
const SHADOW_ONLY_LAYER = 4
const BATCHED_LAYER = 5

/** Kinds cut away when the tour reads a floor from above, so its rooms show (a dollhouse). */
const CUTAWAY = new Set(['ceiling', 'roof', 'roof-segment'])
const FURNITURE = new Set(['item', 'cabinet', 'cabinet-module', 'shelf'])
const OPENINGS = new Set(['door', 'window'])
/** Left as the viewer draws them: room fills, reference scans and guides, the arrival point. */
const LEFT_ALONE = new Set(['zone', 'scan', 'guide', 'spawn'])
/** A bake merges static meshes per role (viewer glb-scene `ROLE_BY_KIND`): back to a kind. */
const KIND_BY_ROLE: Record<string, string> = { wall: 'wall', floor: 'slab', ceiling: 'ceiling', roof: 'roof', glazing: 'window', joinery: 'door' }

function surfaceOf(kind: string): SurfaceClass {
  if (kind === 'site') return 'ground'
  if (kind === 'slab' || kind === 'floor') return 'floor'
  if (kind.includes('tree')) return 'planting'
  if (FURNITURE.has(kind) || OPENINGS.has(kind)) return 'ghost'
  if (kind === 'fence' || kind.startsWith('pool:')) return 'ghost'
  // Plugin kinds (`pkg:kind`) are things standing in the house.
  if (kind.includes(':')) return 'ghost'
  return 'shell'
}

const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

/** The level a node stands on, walking up its parents. */
export function levelOf(nodes: Readonly<Record<string, Node>>, id: string): string | null {
  let current: Node | undefined = nodes[id]
  for (let guard = 0; current && guard < 16; guard++) {
    if (current.type === 'level') return current.id
    current = current.parentId ? nodes[current.parentId] : undefined
  }
  return null
}

function depthOf(nodes: Readonly<Record<string, Node>>, id: string) {
  let depth = 0
  for (let current = nodes[id]; current?.parentId && depth < 32; current = nodes[current.parentId]) depth++
  return depth
}

/** The nearest kind a bake stamped on a mesh or its ancestors (glTF extras). */
function bakedKind(mesh: Object3D, stop: Object3D | null): string | null {
  if (mesh.userData.glbBatch) return KIND_BY_ROLE[mesh.userData.role as string] ?? null
  for (let o: Object3D | null = mesh; o && o !== stop; o = o.parent) {
    const kind = o.userData.kind
    if (typeof kind === 'string' && kind !== 'level' && kind !== 'building') return kind
  }
  return null
}

/** Part of a bake: the GLB stamps Pascal ids on its nodes (glTF extras). */
function baked(object: Object3D) {
  for (let o: Object3D | null = object; o; o = o.parent) if (typeof o.userData.pascalId === 'string') return true
  return false
}

/** Whether an object is still in a scene. */
function attached(object: Object3D) {
  let o: Object3D = object
  while (o.parent) o = o.parent
  return (o as { isScene?: boolean }).isScene === true
}

/** Drawn as itself, up to its level: the level's own display is the tour's to decide. */
function ownVisible(mesh: Object3D, level: Object3D | null) {
  for (let o: Object3D | null = mesh; o && o !== level; o = o.parent) if (!o.visible) return false
  return true
}

type Twin = {
  original: Mesh
  node: Node
  levelId: string | null
  surface: SurfaceClass
  cutaway: boolean
  /** A wall the viewer's cutaway dresses per camera: the twin always wears its whole palette. */
  wall: boolean
  /** Connected to Home Assistant: the copy wears the original material, never X-ray. */
  kept?: boolean
  /** Drawn by an `item-batch` in the viewer, not by itself: never held, its batch is. */
  batched?: boolean
  /** Its layers as the viewer would draw it now, before the tour held it back. */
  baseMask: number
  /** The material the twin was dressed from, to notice the viewer swapping it. */
  source: Material | Material[] | null
  /** Exactly the original, where colour has developed; null for floors and the ground. */
  solid: Mesh | null
  /** The X-ray, where it hasn't (floors and the ground: both, blended). */
  xray: Mesh
}

export type FloorFrame = { levelId: string; order: number; group: Group; object: Object3D }
export type FloorRule = 'show' | 'shadow' | 'hide'
/** Outlines and other parts of the drawing that follow a floor. */
export type Part = { object: Object3D; levelId: string | null; cutaway: boolean }

export type InkHouse = {
  root: Group
  /** Per floor, in its own frame (the outlines). */
  floors: FloorFrame[]
  parts: Part[]
  /** Everything copied, in the world. */
  extent: Box3
  /** The floor the tour reads from above (`null` the whole house). */
  setFloor: (levelId: string | null) => void
  /** Follows the viewer: picks up meshes it rebuilt, then mirrors every original onto its twin. */
  sync: () => void
  /** Hands the originals back without removing the twins (a dev probe). */
  release: () => void
  dispose: () => void
}

const sameMaterials = (a: Material | Material[] | null, b: Material | Material[]) => {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return a.every((m, i) => m === b[i])
}

const box = new Box3()

/** Twins the house the viewer draws now into ink, and holds the originals back. */
export function inkHouse(source: ViewerSource, renderer: WebGPURenderer | null, keep: (nodeId: string) => boolean = () => false): InkHouse {
  const nodes = () => source.nodes as unknown as Readonly<Record<string, Node>>
  const root = new Group()
  root.name = 'home-ink'
  const twinsGroup = new Group()
  twinsGroup.name = 'home-ink:twins'
  root.add(twinsGroup)

  const floors = new Map<string, FloorFrame>()
  const levels = Object.values(nodes()).filter((node) => node.type === 'level').sort((a, b) => num(a.level, 0) - num(b.level, 0))
  levels.forEach((level, order) => {
    const object = source.objectFor(level.id)
    if (!object) return
    object.updateWorldMatrix(true, false)
    const group = new Group()
    group.name = `home-ink:${level.id}`
    group.matrixAutoUpdate = false
    group.matrix.copy(object.matrixWorld)
    root.add(group)
    floors.set(level.id, { levelId: level.id, order, group, object })
  })

  const storeyOf = (levelId: string | null): [number, number] => {
    const floor = levelId ? floors.get(levelId) : undefined
    if (!floor) return [0, 2.7]
    return [new Vector3().setFromMatrixPosition(floor.object.matrixWorld).y, num(nodes()[floor.levelId]?.height, 2.7)]
  }
  const developed = new Map<string, NodeMaterial>()
  const xrays = new Map<string, NodeMaterial>()
  const solidOf = (material: Material) => {
    let variant = developed.get(material.uuid)
    if (!variant) {
      variant = developedMaterial(material, renderer)
      developed.set(material.uuid, variant)
    }
    return variant
  }
  const xrayOf = (material: Material, surface: SurfaceClass, levelId: string | null) => {
    const key = `${material.uuid}|${surface}|${levelId}`
    let variant = xrays.get(key)
    if (!variant) {
      variant = xrayMaterial(material, surface, storeyOf(levelId), renderer)
      xrays.set(key, variant)
    }
    return variant
  }

  /** What the original should wear in the drawing: a wall whole, whatever the wall mode. */
  const sourceMaterial = (twin: Twin): Material | Material[] => {
    if (twin.wall) {
      const viewer = useViewer.getState()
      const node = useScene.getState().nodes[twin.node.id as keyof ReturnType<typeof useScene.getState>['nodes']]
      if (node?.type === 'wall') {
        try {
          return getVisibleWallMaterials(node, viewer.shading, viewer.textures, viewer.colorPreset, viewer.sceneTheme,
            useScene.getState().materials, getWallFinishRefs(twin.original.geometry))
        } catch {
          // Fall back to what the wall wears now.
        }
      }
    }
    return twin.original.material as Material | Material[]
  }

  const dress = (twin: Twin) => {
    const material = sourceMaterial(twin)
    if (sameMaterials(twin.source, material)) return
    twin.source = material
    const list = Array.isArray(material) ? material : [material]
    const pick = <T,>(each: (m: Material) => T) => (Array.isArray(material) ? list.map(each) : each(material))
    twin.xray.material = pick((m) => xrayOf(m, twin.surface, twin.levelId)) as Material | Material[]
    if (twin.solid) twin.solid.material = (twin.kept ? material : pick(solidOf)) as Material | Material[]
  }

  const twins = new Map<Mesh, Twin>()
  /** BatchedMeshes held back while their items are twinned one by one. */
  const held = new Set<Mesh>()
  const extent = new Box3()

  const makeMesh = (original: Mesh) => {
    let copy: Mesh
    if ((original as InstancedMesh).isInstancedMesh) {
      const instanced = original as InstancedMesh
      const twin = new InstancedMesh(instanced.geometry, [], instanced.count)
      twin.instanceMatrix = instanced.instanceMatrix
      twin.instanceColor = instanced.instanceColor
      twin.frustumCulled = false
      copy = twin
    } else {
      copy = new Mesh(original.geometry, [])
      copy.frustumCulled = original.frustumCulled
    }
    copy.matrixAutoUpdate = false
    copy.raycast = () => {}
    copy.renderOrder = original.renderOrder
    copy.receiveShadow = original.receiveShadow
    twinsGroup.add(copy)
    return copy
  }

  /** Every mesh the viewer draws for the graph, each under the deepest node that holds it. */
  const rescan = () => {
    const graph = nodes()
    const owner = new Map<Mesh, Node>()
    const ordered = Object.values(graph)
      .map((node) => ({ node, depth: depthOf(graph, node.id) }))
      .sort((a, b) => b.depth - a.depth)
    for (const { node } of ordered) {
      source.objectFor(node.id)?.traverse((child) => {
        if ((child as Mesh).isMesh && !owner.has(child as Mesh)) owner.set(child as Mesh, node)
      })
    }
    for (const [mesh, node] of owner) {
      if (twins.has(mesh) || held.has(mesh) || LEFT_ALONE.has(node.type) || (mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh) continue
      const layers = mesh.layers
      // Items, doors and windows are drawn by a BatchedMesh per material (`item-batch`): its
      // instances can't be copied as one mesh, so it is held back and the meshes it stands for,
      // still in place with their own materials, are twinned one by one. A merged wall mesh or a
      // bake's merged mesh is an ordinary mesh: it is twinned, and the meshes it merged are not.
      if ((mesh as { isBatchedMesh?: boolean }).isBatchedMesh) {
        held.add(mesh)
        hideFromScene(mesh, 'isolated')
        continue
      }
      const batchedItem = layers.isEnabled(BATCHED_LAYER) && node.type !== 'wall' && !baked(mesh)
      const kept = keep(node.id)
      // Connected and drawn by itself: the viewer's own mesh, untouched.
      if (kept && !batchedItem) continue
      if (layers.isEnabled(BATCHED_LAYER) && !batchedItem) continue
      // Overlays and room fills live on layers of their own and stay the viewer's.
      if (!batchedItem && !layers.isEnabled(SCENE_LAYER) && !layers.isEnabled(SHADOW_ONLY_LAYER)) continue
      const levelId = node.type === 'level' ? node.id : levelOf(graph, node.id)
      const kind = bakedKind(mesh, source.objectFor(node.id)?.parent ?? null) ?? node.type
      const surface = surfaceOf(kind === 'level' || kind === 'building' ? 'wall' : kind)
      // A whole level held shadow-only by the viewer's level display is still drawn mesh by mesh
      // once that level is shown again; a mesh made only for shadows stays one.
      const levelHeld = batchedItem || (!layers.isEnabled(SCENE_LAYER) && mesh.visible && levelId !== null)
      const baseMask = levelHeld ? (layers.mask | (1 << SCENE_LAYER)) & ~(1 << SHADOW_ONLY_LAYER) & ~(1 << BATCHED_LAYER) : layers.mask
      const opaque = surface === 'floor' || surface === 'ground'
      const twin: Twin = {
        original: mesh,
        node,
        levelId,
        surface,
        cutaway: CUTAWAY.has(kind) || CUTAWAY.has(node.type),
        wall: node.type === 'wall' && source.objectFor(node.id) === mesh,
        baseMask,
        source: null,
        kept,
        solid: opaque && !kept ? null : makeMesh(mesh),
        xray: makeMesh(mesh),
      }
      dress(twin)
      twins.set(mesh, twin)
      twin.batched = batchedItem
      // A batched item draws through its batch, held back above; holding the item itself would
      // change what the batch system sees.
      if (!batchedItem) hideFromScene(mesh, 'isolated')
      mesh.updateWorldMatrix(true, false)
      if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox()
      if (mesh.geometry.boundingBox && !(mesh as InstancedMesh).isInstancedMesh && node.type !== 'site') {
        extent.union(box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld))
      }
    }
  }

  const drop = (twin: Twin) => {
    twin.xray.removeFromParent()
    twin.solid?.removeFromParent()
    if (!twin.batched) showInScene(twin.original, 'isolated')
    twins.delete(twin.original)
  }

  let floorLimit = Number.POSITIVE_INFINITY
  const orderOf = (levelId: string | null) => (levelId ? floors.get(levelId)?.order ?? 0 : 0)
  /** The level display, as the viewer's own (levels above the shown one cast shadows only). */
  const ruleOf = (levelId: string | null, cutaway: boolean): FloorRule => {
    if (levelId === null) return 'show'
    if (nodes()[levelId]?.visible === false) return 'hide'
    const order = orderOf(levelId)
    if (order > floorLimit || (order === floorLimit && cutaway)) return 'shadow'
    return 'show'
  }

  const parts: Part[] = []
  let registryRevision = -1
  let geometryRevision = -1

  const sync = () => {
    // The viewer rebuilt or added meshes: twin the new ones (and hold them back).
    const revision = (sceneRegistry as unknown as { revision?: number }).revision ?? 0
    const geometry = useViewer.getState().geometryRevision
    if (revision !== registryRevision || geometry !== geometryRevision) {
      registryRevision = revision
      geometryRevision = geometry
      for (const twin of [...twins.values()]) if (!attached(twin.original)) drop(twin)
      rescan()
    }
    for (const batch of [...held]) {
      if (!attached(batch)) held.delete(batch)
      else if (batch.layers.isEnabled(SCENE_LAYER)) hideFromScene(batch, 'isolated')
    }
    for (const twin of twins.values()) {
      const { original, xray, solid } = twin
      if (!attached(original)) {
        drop(twin)
        continue
      }
      // The viewer may give the original back (its isolation ends): hold it again.
      if (!twin.batched && original.layers.isEnabled(SCENE_LAYER)) hideFromScene(original, 'isolated')
      dress(twin)
      const floor = twin.levelId ? floors.get(twin.levelId)?.object ?? null : null
      const shown = ownVisible(original, floor) && (twin.batched || !original.layers.isEnabled(BATCHED_LAYER))
      const rule = shown ? ruleOf(twin.levelId, twin.cutaway) : 'hide'
      const drawn = rule === 'show' && (twin.baseMask & (1 << SCENE_LAYER)) !== 0
      for (const copy of solid ? [solid, xray] : [xray]) {
        if (copy.geometry !== original.geometry) copy.geometry = original.geometry
        copy.matrix.copy(original.matrixWorld)
        copy.matrixWorldNeedsUpdate = true
        if ((original as InstancedMesh).isInstancedMesh) {
          const a = original as InstancedMesh
          const b = copy as InstancedMesh
          b.count = a.count
          b.instanceMatrix = a.instanceMatrix
          b.instanceColor = a.instanceColor
        }
      }
      // The exact copy carries the shadows, whole: the light is the viewer's.
      const caster = solid ?? xray
      caster.visible = rule !== 'hide'
      caster.castShadow = original.castShadow
      caster.layers.mask = rule === 'shadow' ? 1 << SHADOW_ONLY_LAYER : twin.baseMask & ~(1 << BATCHED_LAYER)
      if (solid) {
        xray.visible = drawn && !twin.kept
        xray.castShadow = false
        xray.layers.mask = twin.baseMask & ~(1 << BATCHED_LAYER) & ~(1 << SHADOW_ONLY_LAYER)
      }
    }
    for (const part of parts) part.object.visible = ruleOf(part.levelId, part.cutaway) === 'show'
    // The outlines follow their floor (stacked, exploded, stepped aside).
    for (const floor of floors.values()) {
      if (!floor.group.matrix.equals(floor.object.matrixWorld)) {
        floor.group.matrix.copy(floor.object.matrixWorld)
        floor.group.matrixWorldNeedsUpdate = true
      }
    }
  }

  return {
    root,
    floors: [...floors.values()],
    parts,
    extent,
    setFloor(levelId) {
      floorLimit = levelId === null ? Number.POSITIVE_INFINITY : floors.get(levelId)?.order ?? Number.POSITIVE_INFINITY
    },
    sync,
    release() {
      for (const twin of twins.values()) if (!twin.batched) showInScene(twin.original, 'isolated')
      for (const batch of held) showInScene(batch, 'isolated')
    },
    dispose() {
      for (const twin of [...twins.values()]) drop(twin)
      for (const batch of held) showInScene(batch, 'isolated')
      held.clear()
      root.removeFromParent()
      for (const material of [...developed.values(), ...xrays.values()]) material.dispose()
    },
  }
}

export type Room = {
  id: string
  outline: [number, number][]
  centre: [number, number]
  /** Distance from the centre to the farthest corner, plus a margin: how far its front grows. */
  reach: number
  floorY: number
  height: number
}

/** A room (zone) in the world now: its outline through its level's transform. */
export function roomOf(source: ViewerSource, zoneId: string): Room | null {
  const nodes = source.nodes as unknown as Readonly<Record<string, Node>>
  const zone = nodes[zoneId]
  const polygon = (Array.isArray(zone?.polygon) ? zone.polygon : []) as [number, number][]
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
    outline,
    centre,
    reach: Math.max(...outline.map(([x, z]) => Math.hypot(x - centre[0], z - centre[1]))) + 0.6,
    floorY,
    height: num(zone.ceilingHeight, num(levelId ? nodes[levelId]?.height : undefined, 2.7)),
  }
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

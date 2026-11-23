import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { BATCHED_LAYER, SCENE_LAYER, SITE_GROUND, temporarilyShowShadowOnly, useViewer } from '@pascal-app/viewer'
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  type CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  type InstancedMesh,
  type InterleavedBufferAttribute,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type Scene,
  type Texture,
  Vector2,
  Vector3,
} from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { WebGPURenderer } from 'three/webgpu'
import { convertTextureForAr, MAX_AR_TEXTURE_SIZE } from './textures'

export type ArScaleMode = 'tabletop' | 'lifesize'

export interface BuiltArModel {
  /** Base-centred (0, 0, 0) unscaled building group in metres. */
  group: Group
  /** Full 1:1 bounding box dimensions in metres. */
  size: Vector3
  /** Largest horizontal side (max(width, depth)) in metres. */
  maxHorizontal: number
  /** Uniform scale factor that fits `maxHorizontal` into ~0.6 m (capped at 1). */
  tabletopScale: number
  /** Number of merged meshes in `group`. */
  meshCount: number
  /** Disposes all geometries, materials, and CanvasTextures owned by this model. */
  dispose: () => void
}

/** Target largest horizontal dimension (m) in Tabletop scale. */
export const TABLETOP_TARGET_METERS = 0.6

/** Un-attributed ground planes wider than this (m) are treated as infinite backdrop ground. */
const BACKDROP_GROUND_SPAN_METERS = 500

const AR_EXCLUDED_KINDS = new Set([
  'zone',
  'spawn',
  'guide',
  'scan',
  'measurement',
  'construction-dimension',
  'structural-grid',
])

const SKIPPED_MESH_NAMES = new Set([
  'cutout',
  'collision-mesh',
  'wall-collision',
  'curtain-wall-shadow',
  'ceiling-grid',
  'collider',
  'Background.mesh',
])

const MERGE_ATTRIBUTES = ['position', 'normal', 'uv', 'uv1', 'color'] as const

type MaterialLike = Material & {
  color?: Color
  map?: Texture | null
  normalMap?: Texture | null
  normalScale?: Vector2
  roughness?: number
  roughnessMap?: Texture | null
  metalness?: number
  metalnessMap?: Texture | null
  emissive?: Color
  emissiveMap?: Texture | null
  emissiveIntensity?: number
  aoMap?: Texture | null
  aoMapIntensity?: number
  alphaMap?: Texture | null
  alphaTest?: number
  opacity?: number
  transparent?: boolean
  vertexColors?: boolean
}

interface CollectedPart {
  mesh: Mesh
  material: MaterialLike
  worldMatrix: Matrix4
  groupStart?: number
  groupCount?: number
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

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
    if (
      ud.vrIgnore ||
      ud.proceduralMotion ||
      ud.pascalProceduralRest ||
      ud.__measureTool === true ||
      ud.__tourNoir === true ||
      ud.__tourNoirEdge === true
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

function isMaterialVisible(material: Material | Material[] | undefined): boolean {
  if (!material) return false
  return Array.isArray(material) ? material.some((entry) => Boolean(entry?.visible)) : material.visible
}

function isBackdropMaterial(material: Material | Material[] | undefined): boolean {
  if (!material) return false
  const list = Array.isArray(material) ? material : [material]
  return list.some((entry) => entry?.userData?.noRooms === true || entry?.userData?.daylightSky === true)
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

function isGiantBackdropPlane(mesh: Mesh, kind: string | undefined): boolean {
  if (kind && kind !== 'site') return false
  const geometry = mesh.geometry
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const localBox = geometry.boundingBox
  if (!localBox || localBox.isEmpty()) return false
  const worldBox = localBox.clone().applyMatrix4(mesh.matrixWorld)
  const size = worldBox.getSize(new Vector3())
  return Math.max(size.x, size.z) > BACKDROP_GROUND_SPAN_METERS
}

function toFloat32Attribute(source: BufferAttribute | InterleavedBufferAttribute): Float32BufferAttribute {
  const count = source.count
  const itemSize = source.itemSize
  const out = new Float32Array(count * itemSize)
  for (let i = 0; i < count; i++) {
    const base = i * itemSize
    out[base] = source.getX(i)
    if (itemSize > 1) out[base + 1] = source.getY(i)
    if (itemSize > 2) out[base + 2] = source.getZ(i)
    if (itemSize > 3) out[base + 3] = source.getW(i)
  }
  return new Float32BufferAttribute(out, itemSize)
}

function flipTriangleWinding(geometry: BufferGeometry) {
  const index = geometry.index
  if (index) {
    const arr = index.array as Uint16Array | Uint32Array
    for (let i = 0; i + 2 < arr.length; i += 3) {
      const b = arr[i + 1]!
      arr[i + 1] = arr[i + 2]!
      arr[i + 2] = b
    }
    index.needsUpdate = true
  }
}

/**
 * Extracts a normalized, indexed Float32 BufferGeometry slice (full geometry or one material group)
 * with worldMatrix baked into positions/normals and winding corrected for negative determinants.
 */
function extractNormalizedPart(part: CollectedPart): BufferGeometry | null {
  const source = part.mesh.geometry
  const posAttr = source.getAttribute('position')
  if (!posAttr || posAttr.count < 3) return null

  const presentNames = MERGE_ATTRIBUTES.filter((name) => {
    const attr = source.getAttribute(name)
    return attr != null && attr.count === posAttr.count
  })

  const out = new BufferGeometry()
  if (part.groupStart !== undefined && part.groupCount !== undefined) {
    // Remap only the vertices referenced by this material group so we don't duplicate the whole mesh.
    const srcIndex = source.index
    const start = Math.max(0, part.groupStart)
    const end = srcIndex
      ? Math.min(srcIndex.count, start + part.groupCount)
      : Math.min(posAttr.count, start + part.groupCount)
    const rawCount = end - start
    if (rawCount < 3) return null

    const remap = new Map<number, number>()
    const oldIndices: number[] = []
    const newIndices = new Uint32Array(rawCount)

    for (let i = 0; i < rawCount; i++) {
      const oldIdx = srcIndex ? srcIndex.getX(start + i) : start + i
      let mapped = remap.get(oldIdx)
      if (mapped === undefined) {
        mapped = oldIndices.length
        remap.set(oldIdx, mapped)
        oldIndices.push(oldIdx)
      }
      newIndices[i] = mapped
    }

    const vertCount = oldIndices.length
    for (const name of presentNames) {
      const srcAttr = source.getAttribute(name) as BufferAttribute | InterleavedBufferAttribute
      const itemSize = srcAttr.itemSize
      const arr = new Float32Array(vertCount * itemSize)
      for (let i = 0; i < vertCount; i++) {
        const oldIdx = oldIndices[i]!
        const base = i * itemSize
        arr[base] = srcAttr.getX(oldIdx)
        if (itemSize > 1) arr[base + 1] = srcAttr.getY(oldIdx)
        if (itemSize > 2) arr[base + 2] = srcAttr.getZ(oldIdx)
        if (itemSize > 3) arr[base + 3] = srcAttr.getW(oldIdx)
      }
      out.setAttribute(name, new Float32BufferAttribute(arr, itemSize))
    }
    out.setIndex(new BufferAttribute(newIndices, 1))
  } else {
    for (const name of presentNames) {
      const srcAttr = source.getAttribute(name) as BufferAttribute | InterleavedBufferAttribute
      out.setAttribute(name, toFloat32Attribute(srcAttr))
    }
    const vertCount = posAttr.count
    if (source.index) {
      const srcIdx = source.index
      const idx = new Uint32Array(srcIdx.count)
      for (let i = 0; i < srcIdx.count; i++) idx[i] = srcIdx.getX(i)
      out.setIndex(new BufferAttribute(idx, 1))
    } else {
      const idx = new Uint32Array(vertCount)
      for (let i = 0; i < vertCount; i++) idx[i] = i
      out.setIndex(new BufferAttribute(idx, 1))
    }
  }

  out.applyMatrix4(part.worldMatrix)
  if (part.worldMatrix.determinant() < 0) {
    flipTriangleWinding(out)
  }
  if (!out.getAttribute('normal')) {
    out.computeVertexNormals()
  }
  return out
}

async function convertMaterial(
  source: MaterialLike,
  renderer: WebGPURenderer,
  textureCache: Map<string, CanvasTexture | null>,
  ownedTextures: Set<CanvasTexture>,
): Promise<MeshStandardMaterial> {
  const isGlass = source.userData?.isGlass === true
  const transparent = Boolean(source.transparent)
  const alphaTest = typeof source.alphaTest === 'number' ? source.alphaTest : 0
  const opacity = typeof source.opacity === 'number' ? source.opacity : 1
  const needsDiffuseAlpha = transparent || alphaTest > 0

  const track = (tex: CanvasTexture | null): CanvasTexture | null => {
    if (tex) ownedTextures.add(tex)
    return tex
  }

  const [map, normalMap, roughnessMap, metalnessMap, emissiveMap, aoMap, alphaMap] = await Promise.all([
    convertTextureForAr(source.map, renderer, textureCache, MAX_AR_TEXTURE_SIZE, needsDiffuseAlpha),
    convertTextureForAr(source.normalMap, renderer, textureCache, MAX_AR_TEXTURE_SIZE, false),
    convertTextureForAr(source.roughnessMap, renderer, textureCache, MAX_AR_TEXTURE_SIZE, false),
    convertTextureForAr(source.metalnessMap, renderer, textureCache, MAX_AR_TEXTURE_SIZE, false),
    convertTextureForAr(source.emissiveMap, renderer, textureCache, MAX_AR_TEXTURE_SIZE, false),
    convertTextureForAr(source.aoMap, renderer, textureCache, MAX_AR_TEXTURE_SIZE, false),
    convertTextureForAr(source.alphaMap, renderer, textureCache, MAX_AR_TEXTURE_SIZE, true),
  ])

  const standard = new MeshStandardMaterial({
    name: source.name || 'ar-material',
    color: source.color instanceof Color ? source.color.clone() : new Color(0xffffff),
    map: track(map),
    normalMap: track(normalMap),
    roughnessMap: track(roughnessMap),
    metalnessMap: track(metalnessMap),
    emissiveMap: track(emissiveMap),
    aoMap: track(aoMap),
    alphaMap: track(alphaMap),
    roughness: typeof source.roughness === 'number' ? source.roughness : isGlass ? 0.1 : 0.9,
    metalness: typeof source.metalness === 'number' ? source.metalness : isGlass ? 0.1 : 0,
    emissive: source.emissive instanceof Color ? source.emissive.clone() : new Color(0x000000),
    emissiveIntensity: typeof source.emissiveIntensity === 'number' ? source.emissiveIntensity : 1,
    aoMapIntensity: typeof source.aoMapIntensity === 'number' ? source.aoMapIntensity : 1,
    opacity,
    transparent,
    alphaTest,
    depthWrite: transparent ? source.depthWrite : true,
    side: source.side,
    vertexColors: Boolean(source.vertexColors),
  })

  if (source.normalScale instanceof Vector2) {
    standard.normalScale.copy(source.normalScale)
  }

  return standard
}

/**
 * Builds a self-contained, merged, base-centred AR model from the rendered Three.js scene.
 * Works identically for baked GLB scenes (including live glbReplace overlays) and live graphs.
 */
export async function buildArModel(
  scene: Scene,
  renderer: WebGPURenderer,
  glbActive: boolean,
  onProgress?: (progress: number) => void,
): Promise<BuiltArModel> {
  onProgress?.(0.02)

  // If the user is in stacked mode (e.g. switched to 2D where ViewerStage auto-selected a floor
  // and moved roofs/ceilings to SHADOW_ONLY_LAYER), temporarily restore those shadow-only meshes
  // so the AR model keeps its roof. Solo floor mode stays untouched.
  const restoreShadowOnly =
    useViewer.getState().levelMode === 'stacked' ? temporarilyShowShadowOnly(scene) : null

  const collected: CollectedPart[] = []
  const instanceMatrix = new Matrix4()

  try {
    scene.updateWorldMatrix(true, true)
    const registryKinds = glbActive ? null : buildRegistryKindMap()

    scene.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      if (mesh.userData.glbBatch === true) return
      if (mesh.userData[SITE_GROUND]) return
      if (SKIPPED_MESH_NAMES.has(mesh.name)) return
      if (!mesh.layers.isEnabled(SCENE_LAYER) && !mesh.layers.isEnabled(BATCHED_LAYER)) return
      if (!isEffectivelyVisible(mesh)) return
      if (!isMaterialVisible(mesh.material)) return
      if (isBackdropMaterial(mesh.material)) return
      if (hasIgnoredAncestor(mesh)) return

      const kind = kindOf(mesh, registryKinds)
      if (kind && AR_EXCLUDED_KINDS.has(kind)) return
      if (isGiantBackdropPlane(mesh, kind)) return

      const geometry = mesh.geometry
      const pos = geometry?.getAttribute('position')
      if (!pos || pos.count < 3) return

      const isInstanced = (mesh as InstancedMesh).isInstancedMesh === true
      const instanceCount = isInstanced ? (mesh as InstancedMesh).count : 1
      if (instanceCount <= 0) return

      const pushForMatrix = (worldMatrix: Matrix4) => {
        if (Array.isArray(mesh.material)) {
          const groups = geometry.groups
          if (groups.length > 0) {
            for (const grp of groups) {
              const mat = mesh.material[grp.materialIndex ?? 0] as MaterialLike | undefined
              if (!mat || !mat.visible || isBackdropMaterial(mat)) continue
              collected.push({
                mesh,
                material: mat,
                worldMatrix,
                groupStart: grp.start,
                groupCount: grp.count,
              })
            }
          } else {
            const mat = mesh.material[0] as MaterialLike | undefined
            if (mat && mat.visible && !isBackdropMaterial(mat)) {
              collected.push({ mesh, material: mat, worldMatrix })
            }
          }
        } else {
          collected.push({ mesh, material: mesh.material as MaterialLike, worldMatrix })
        }
      }

      if (isInstanced) {
        const instanced = mesh as InstancedMesh
        for (let i = 0; i < instanceCount; i++) {
          instanced.getMatrixAt(i, instanceMatrix)
          const world = new Matrix4().multiplyMatrices(mesh.matrixWorld, instanceMatrix)
          pushForMatrix(world)
        }
      } else {
        pushForMatrix(mesh.matrixWorld.clone())
      }
    })
  } finally {
    restoreShadowOnly?.()
  }

  if (collected.length === 0) {
    throw new Error('No visible 3D geometry found in this scene.')
  }

  onProgress?.(0.15)
  await yieldFrame()

  // Convert unique materials (including offscreen KTX2 decompression & 1024px texture capping).
  const uniqueSources = new Map<string, MaterialLike>()
  for (const part of collected) {
    if (!uniqueSources.has(part.material.uuid)) {
      uniqueSources.set(part.material.uuid, part.material)
    }
  }

  const convertedMaterials = new Map<string, MeshStandardMaterial>()
  const textureCache = new Map<string, CanvasTexture | null>()
  const ownedTextures = new Set<CanvasTexture>()
  const ownedMaterials: MeshStandardMaterial[] = []

  const sourceList = [...uniqueSources.entries()]
  for (let i = 0; i < sourceList.length; i++) {
    const [uuid, srcMat] = sourceList[i]!
    const mat = await convertMaterial(srcMat, renderer, textureCache, ownedTextures)
    convertedMaterials.set(uuid, mat)
    ownedMaterials.push(mat)
    onProgress?.(0.15 + ((i + 1) / Math.max(1, sourceList.length)) * 0.55)
    if (i % 4 === 3) await yieldFrame()
  }

  // Bucket extracted geometry slices by converted material + attribute signature so mergeGeometries succeeds.
  const buckets = new Map<string, { material: MeshStandardMaterial; parts: BufferGeometry[] }>()
  for (let i = 0; i < collected.length; i++) {
    const part = collected[i]!
    const mat = convertedMaterials.get(part.material.uuid)
    if (!mat) continue
    const geom = extractNormalizedPart(part)
    if (!geom) continue

    const sig = MERGE_ATTRIBUTES.filter((name) => geom.getAttribute(name) != null).join(',')
    const key = `${mat.uuid}|${sig}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { material: mat, parts: [] }
      buckets.set(key, bucket)
    }
    bucket.parts.push(geom)

    if (i % 60 === 59) {
      onProgress?.(0.7 + ((i + 1) / collected.length) * 0.15)
      await yieldFrame()
    }
  }

  const group = new Group()
  group.name = 'PascalArModel'
  const ownedGeometries: BufferGeometry[] = []
  const totalBounds = new Box3()

  let bucketIndex = 0
  for (const { material, parts } of buckets.values()) {
    let finalGeoms: BufferGeometry[]
    if (parts.length === 1) {
      finalGeoms = parts
    } else {
      const merged = mergeGeometries(parts, false)
      if (merged) {
        for (const p of parts) p.dispose()
        finalGeoms = [merged]
      } else {
        finalGeoms = parts
      }
    }

    // Weld vertices that share every attribute: baked meshes arrive largely unindexed, and each
    // vertex costs about 100 bytes of text in a USDZ, which can't be compressed.
    finalGeoms = finalGeoms.map((geom) => {
      const welded = mergeVertices(geom, 1e-4)
      if (welded !== geom) geom.dispose()
      return welded
    })

    for (const geom of finalGeoms) {
      // Only enable vertexColors when the merged geometry actually carries a color attribute.
      let meshMat = material
      if (material.vertexColors && !geom.getAttribute('color')) {
        const clonedMat = material.clone()
        clonedMat.vertexColors = false
        ownedMaterials.push(clonedMat)
        meshMat = clonedMat
      }

      geom.computeBoundingBox()
      if (geom.boundingBox) totalBounds.union(geom.boundingBox)
      ownedGeometries.push(geom)

      const mesh = new Mesh(geom, meshMat)
      mesh.name = `ARMesh_${bucketIndex++}`
      mesh.castShadow = false
      mesh.receiveShadow = false
      group.add(mesh)
    }
  }

  if (ownedGeometries.length === 0 || totalBounds.isEmpty()) {
    for (const g of ownedGeometries) g.dispose()
    for (const m of ownedMaterials) m.dispose()
    for (const t of ownedTextures) t.dispose()
    throw new Error('Could not build AR geometry from this scene.')
  }

  // Recentre so the model's base centre sits at (0, 0, 0).
  const center = totalBounds.getCenter(new Vector3())
  const offsetX = -center.x
  const offsetY = -totalBounds.min.y
  const offsetZ = -center.z
  for (const geom of ownedGeometries) {
    geom.translate(offsetX, offsetY, offsetZ)
    geom.computeBoundingBox()
    geom.computeBoundingSphere()
  }

  const size = totalBounds.getSize(new Vector3())
  const maxHorizontal = Math.max(size.x, size.z)
  const tabletopScale = maxHorizontal > 0 ? Math.min(1, TABLETOP_TARGET_METERS / maxHorizontal) : 1

  onProgress?.(1)

  const dispose = () => {
    for (const g of ownedGeometries) g.dispose()
    for (const m of ownedMaterials) m.dispose()
    for (const t of ownedTextures) t.dispose()
    ownedGeometries.length = 0
    ownedMaterials.length = 0
    ownedTextures.clear()
  }

  return {
    group,
    size,
    maxHorizontal,
    tabletopScale,
    meshCount: group.children.length,
    dispose,
  }
}

export function scaleFactorForMode(model: BuiltArModel, mode: ArScaleMode): number {
  return mode === 'tabletop' ? model.tabletopScale : 1
}

/**
 * Creates a session-owned clone of a BuiltArModel's Group (cloning geometries, materials, and
 * CanvasTexture wrappers while sharing the underlying 2D canvas images) so a separate WebGLRenderer
 * context can upload and dispose GPU resources cleanly without corrupting the cached model.
 */
export function cloneArGroupForWebGl(source: Group): { group: Group; dispose: () => void } {
  const cloned = new Group()
  cloned.name = source.name
  const geometries: BufferGeometry[] = []
  const materials: MeshStandardMaterial[] = []
  const textures: CanvasTexture[] = []
  const materialMap = new Map<Material, MeshStandardMaterial>()

  const cloneTexture = (tex: Texture | null): Texture | null => {
    if (!tex) return null
    const copy = tex.clone()
    copy.needsUpdate = true
    textures.push(copy as CanvasTexture)
    return copy
  }

  for (const child of source.children) {
    const mesh = child as Mesh
    if (!mesh.isMesh) continue
    const geom = mesh.geometry.clone()
    geometries.push(geom)

    const srcMat = mesh.material as MeshStandardMaterial
    let mat = materialMap.get(srcMat)
    if (!mat) {
      mat = srcMat.clone()
      mat.map = cloneTexture(srcMat.map)
      mat.normalMap = cloneTexture(srcMat.normalMap)
      mat.roughnessMap = cloneTexture(srcMat.roughnessMap)
      mat.metalnessMap = cloneTexture(srcMat.metalnessMap)
      mat.emissiveMap = cloneTexture(srcMat.emissiveMap)
      mat.aoMap = cloneTexture(srcMat.aoMap)
      mat.alphaMap = cloneTexture(srcMat.alphaMap)
      mat.needsUpdate = true
      materialMap.set(srcMat, mat)
      materials.push(mat)
    }

    const clonedMesh = new Mesh(geom, mat)
    clonedMesh.name = mesh.name
    cloned.add(clonedMesh)
  }

  return {
    group: cloned,
    dispose: () => {
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
      for (const t of textures) t.dispose()
      geometries.length = 0
      materials.length = 0
      textures.length = 0
    },
  }
}

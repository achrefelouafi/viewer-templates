import {
  type AnyNode,
  calculateLevelMiters,
  getLevelElevations,
  getWallPlanFootprint,
  levelFloorWorldY,
  type WallNode,
  worldToFloorplanLocalPoint,
} from '@pascal-app/core'
import type { ViewerNodes } from '@pascal-app/viewer/ui'
import { type Object3D, Vector3 } from 'three'
import { SNAP_RADIUS_PX } from './raycast'
import type { Vec3 } from './store'

export type PlanPoint = readonly [number, number]

export interface PlanBuildingFrame {
  position: readonly [number, number, number]
  rotationY: number
}

type CoreNodes = Parameters<typeof getLevelElevations>[0]

const _worldPos = new Vector3()

/** Resolves the level currently shown by `FloorplanPreview` (selected level or lowest level). */
export function resolveActivePlanLevelId(nodes: ViewerNodes, selectedLevelId: string | null): string | null {
  const levels = Object.values(nodes as Record<string, AnyNode>)
    .filter((node): node is Extract<AnyNode, { type: 'level' }> => node.type === 'level')
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
  if (selectedLevelId && levels.some((level) => level.id === selectedLevelId)) {
    return selectedLevelId
  }
  return levels[0]?.id ?? null
}

/** Extracts the building's world position and Y rotation for converting world ↔ floorplan-local coordinates. */
export function resolvePlanBuildingFrame(nodes: ViewerNodes, levelId: string | null): PlanBuildingFrame {
  const record = nodes as Record<string, AnyNode | undefined>
  const level = levelId ? record[levelId] : undefined
  const building = level?.parentId ? record[level.parentId] : undefined
  if (building?.type !== 'building') {
    return { position: [0, 0, 0], rotationY: 0 }
  }
  return { position: building.position, rotationY: building.rotation[1] }
}

/**
 * Resolves the world Y elevation for points placed on the 2D plan:
 * uses the level's standing floor height (`levelFloorWorldY`), shifted to match the live 3D level
 * object when available (so split-view exploded levels line up in 3D too).
 */
export function resolveLevelWorldY(
  nodes: ViewerNodes,
  levelId: string | null,
  levelObject: Object3D | undefined,
): number {
  if (!levelId) return 0
  const coreNodes = nodes as unknown as CoreNodes
  const frame = resolvePlanBuildingFrame(nodes, levelId)
  const elevation = getLevelElevations(coreNodes).get(levelId)
  const planeY = frame.position[1] + (elevation?.baseY ?? 0)
  const floorY = levelFloorWorldY(coreNodes, levelId) ?? planeY
  const slabOffset = floorY - planeY

  if (levelObject) {
    levelObject.updateWorldMatrix(true, false)
    levelObject.getWorldPosition(_worldPos)
    if (Number.isFinite(_worldPos.y)) {
      return _worldPos.y + slabOffset
    }
  }
  return floorY
}

/**
 * Collects deduplicated building-local `[x, y]` snap candidates on `levelId`:
 * every visible wall's centerline `start`/`end` plus its mitered 2D footprint corners
 * (matching `FloorplanPreview`'s document-mode wall geometry).
 */
export function collectLevelSnapPoints(nodes: ViewerNodes, levelId: string | null): readonly PlanPoint[] {
  if (!levelId) return []
  const walls: WallNode[] = []
  for (const node of Object.values(nodes as Record<string, AnyNode>)) {
    if (node.type === 'wall' && node.parentId === levelId && node.visible !== false) {
      walls.push(node)
    }
  }
  if (walls.length === 0) return []

  const seen = new Set<string>()
  const points: PlanPoint[] = []
  const push = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const key = `${Math.round(x * 1000)},${Math.round(y * 1000)}`
    if (seen.has(key)) return
    seen.add(key)
    points.push([x, y])
  }

  for (const wall of walls) {
    push(wall.start[0], wall.start[1])
    push(wall.end[0], wall.end[1])
  }

  try {
    const miters = calculateLevelMiters(walls)
    for (const wall of walls) {
      const footprint = getWallPlanFootprint(wall, miters)
      for (const corner of footprint) {
        push(corner.x, corner.y)
      }
    }
  } catch {
    // Wall centerline start/end points are already collected as fallback.
  }

  return points
}

/** Locks `rawB` onto whichever horizontal world axis (X or Z) has the larger delta from `a`, keeping `y = a[1]`. */
export function constrainToDominantXZAxis(a: Vec3, rawB: Vec3): { point: Vec3; axis: 'x' | 'z' } {
  const adx = Math.abs(rawB[0] - a[0])
  const adz = Math.abs(rawB[2] - a[2])
  if (adx >= adz) {
    return { point: [rawB[0], a[1], a[2]], axis: 'x' }
  }
  return { point: [a[0], a[1], rawB[2]], axis: 'z' }
}

/**
 * Finds the nearest snap candidate (wall endpoint/corner or existing measurement endpoint)
 * within `SNAP_RADIUS_PX` screen pixels of `(clientX, clientY)`, returning its building-local `{ x, y }`.
 */
export function findNearestPlanSnap(
  clientX: number,
  clientY: number,
  ctm: DOMMatrix,
  levelSnapPoints: readonly PlanPoint[],
  existingEndpoints: readonly Vec3[],
  frame: PlanBuildingFrame,
): { x: number; y: number } | null {
  let bestDist = SNAP_RADIUS_PX
  let best: { x: number; y: number } | null = null

  const testLocal = (lx: number, ly: number) => {
    const sx = ctm.a * lx + ctm.c * ly + ctm.e
    const sy = ctm.b * lx + ctm.d * ly + ctm.f
    const d = Math.hypot(sx - clientX, sy - clientY)
    if (d < bestDist) {
      bestDist = d
      best = { x: lx, y: ly }
    }
  }

  for (let i = 0; i < existingEndpoints.length; i++) {
    const ep = existingEndpoints[i]!
    const local = worldToFloorplanLocalPoint(ep[0], ep[2], frame.position, frame.rotationY)
    testLocal(local.x, local.y)
  }

  for (let i = 0; i < levelSnapPoints.length; i++) {
    const pt = levelSnapPoints[i]!
    testLocal(pt[0], pt[1])
  }

  return best
}

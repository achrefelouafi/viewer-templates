import {
  acquireSceneReadOnlyLease,
  emitter,
  loadPlugin,
  nodeMechanism,
  type NodeEvent,
  sceneRegistry,
  toggleMechanism,
  useScene,
} from '@pascal-app/core'
import { renderPlugin } from '@pascal-app/nodes/render'
import { configureViewer, useViewer, Viewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box3, type Object3D, Raycaster, Vector3 } from 'three'
import { PASCAL_BASE_URL } from '../config'
import { findAncestorOfType, type SceneResponse, zoneArea, zoneContains, zoneInfo } from '../pascal'
import { AxoControls, FIT_MARGIN } from './AxoControls'
import { measure } from './measure'
import { MeasureTool } from './MeasureTool'
import { type RoomLocation, RoomTagProjector } from './RoomTagProjector'
import type { FocusProps } from './Model'
import { navigation } from './navigation'
import type { PointerHover } from './semantics'
import { STYLE } from './style'

type SceneInput = Parameters<ReturnType<typeof useScene.getState>['setScene']>
type LiveViewerProps = FocusProps & {
  scene: SceneResponse
  onError: (error: unknown) => void
  onSceneReadyChange: (ready: boolean) => void
}

configureViewer({ assetsBaseUrl: PASCAL_BASE_URL })
const pluginReady = loadPlugin(renderPlugin)

export function LiveViewer({
  scene,
  levelId,
  onError,
  onHover,
  onSceneReadyChange,
  onSelectLevel,
  selectedRoomId,
  selectedThingId,
  pointedThingIds,
  onSelectRoom,
  onSelectThing,
}: LiveViewerProps) {
  const [loaded, setLoaded] = useState<SceneResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    let release: (() => void) | undefined
    // The API keeps kind-specific data loose; core migrates it when loading.
    const graph = scene.graph as unknown as {
      nodes: SceneInput[0]
      rootNodeIds: SceneInput[1]
    } & NonNullable<SceneInput[2]>
    onSceneReadyChange(false)
    void pluginReady.then(() => {
      if (cancelled) return
      release = acquireSceneReadOnlyLease()
      // No library or scene materials: every surface falls back to the "white" preset's tone
      // for its role, like the baked drawing.
      useScene.getState().setScene(graph.nodes, graph.rootNodeIds, {
        materials: {},
        collections: graph.collections,
        installedPlugins: graph.installedPlugins,
      })
      const viewer = useViewer.getState()
      viewer.resetSelection()
      // The drawing: orthographic, flat white surfaces, Pascal's own ink edges.
      viewer.setCameraMode('orthographic')
      viewer.setLevelMode('stacked')
      // Pascal's own cutaway: walls facing the camera drop so rooms read from outside.
      viewer.setWallMode('cutaway')
      viewer.setShowGrid(false)
      viewer.setShowMeasurements(false)
      viewer.setTextures(false)
      viewer.setShading('solid')
      viewer.setColorPreset('white')
      viewer.setEdges('strong')
      viewer.setInkOpacity(STYLE.lineOpacity)
      // The page's paper shows through; no ambient occlusion, so surfaces stay flat.
      viewer.setTransparentBackground(true)
      viewer.setRenderQuality('low')
      setLoaded(scene)
    }).catch((error: unknown) => !cancelled && onError(error))
    return () => {
      cancelled = true
      release?.()
    }
  }, [scene, onError, onSceneReadyChange])

  useEffect(() => {
    if (loaded !== scene) return
    const viewer = useViewer.getState()
    const building = levelId ? findAncestorOfType(scene.graph, levelId, 'building') : null
    // Pascal's own selection draws the picked (or pointed-at) item.
    const things = pointedThingIds.length ? pointedThingIds : selectedThingId ? [selectedThingId] : []
    const selection = {
      buildingId: building?.id ?? null,
      levelId,
      zoneId: null,
      selectedIds: [...things],
    } as Parameters<typeof viewer.setSelection>[0]
    viewer.setSelection(selection)
    viewer.setLevelMode(levelId ? 'solo' : 'stacked')
  }, [loaded, scene, levelId, selectedThingId, pointedThingIds])

  useEffect(() => {
    if (loaded !== scene) return
    const move = (event: NodeEvent) => {
      event.stopPropagation()
      if (measure.state.active) return onHover(null)
      const { clientX: x, clientY: y } = event.nativeEvent
      // Every floor shown: the drawing answers in floors, and a click goes into one.
      if (levelId === null) {
        // The hit node's own level: a wall names its floor, the roof its roof level.
        const floor = findAncestorOfType(scene.graph, event.node.id, 'level')?.id ?? null
        return onHover(floor ? { kind: 'level', id: floor, label: '', x, y } : null)
      }
      const level = findAncestorOfType(scene.graph, event.node.id, 'level')
      let room: PointerHover | null = null
      for (const node of Object.values(scene.graph.nodes)) {
        const zone = zoneInfo(node)
        if (!zone || findAncestorOfType(scene.graph, node.id, 'level')?.id !== level?.id) continue
        const object = sceneRegistry.nodes.get(node.id)
        if (!object) continue
        const point = object.worldToLocal(new Vector3(...event.position))
        if (zoneContains(zone, point.x, point.z)) {
          // The picked room needs no tag.
          if (node.id !== selectedRoomId) room = { kind: 'room', id: node.id, label: zone.name ?? 'Room', area: zoneArea(zone), x, y }
          break
        }
      }
      onHover(room)
    }
    const leave = () => onHover(null)
    const click = (event: NodeEvent) => {
      event.stopPropagation()
      if (event.nativeEvent.delta > 4 || measure.state.active) return
      if (levelId === null) {
        const floor = findAncestorOfType(scene.graph, event.node.id, 'level')?.id ?? null
        if (floor) onSelectLevel(floor)
        return
      }
      const room = roomAtPoint(scene, new Vector3(...event.position))
      // Until a room is picked, the drawing answers in rooms alone.
      if (!selectedRoomId || (room && room !== selectedRoomId)) {
        if (room) onSelectRoom(room)
        return
      }
      if (event.node.type === 'door' || event.node.type === 'window') {
        const mechanism = nodeMechanism(event.node)
        if (mechanism) toggleMechanism(mechanism, event.node)
      } else {
        onSelectThing(event.node.type === 'item' ? event.node.id : null)
      }
    }
    emitter.on('node:move', move)
    emitter.on('node:leave', leave)
    emitter.on('node:click', click)
    return () => {
      emitter.off('node:move', move)
      emitter.off('node:leave', leave)
      emitter.off('node:click', click)
      onHover(null)
    }
  }, [loaded, scene, levelId, onHover, onSelectLevel, onSelectRoom, onSelectThing, selectedRoomId])

  const locateRoom = useMemo(() => roomLocator(scene), [scene])
  const [ready, setReady] = useState(false)
  const handleReady = useCallback(
    (next: boolean) => {
      setReady(next)
      onSceneReadyChange(next)
    },
    [onSceneReadyChange],
  )
  // Frame the buildings once they are built; the graph's nodes mount lazily.
  const bounds = useMemo(() => (ready && loaded === scene ? liveBounds(scene) : null), [ready, loaded, scene])
  // A selected room is framed; closing it, or changing floor, frames the floor shown (or the
  // building) again.
  const framed = useRef<{ room: string | null; level: string | null } | null>(null)
  useEffect(() => {
    if (!ready || loaded !== scene) return
    const before = framed.current
    framed.current = { room: selectedRoomId, level: levelId }
    if (!before) return
    const box = selectedRoomId ? roomBox(scene, selectedRoomId) : null
    if (box) {
      if (before.room !== selectedRoomId) navigation.focus(box)
      return
    }
    if (before.room === selectedRoomId && before.level === levelId) return
    const floor = levelId ? sceneRegistry.nodes.get(levelId) : null
    const bounds = floor ? new Box3().setFromObject(floor) : null
    if (bounds && !bounds.isEmpty()) navigation.focus(bounds, FIT_MARGIN)
    else navigation.fit()
  }, [ready, loaded, scene, selectedRoomId, levelId])

  if (loaded !== scene) return null
  return (
    <Viewer
      daylight={false}
      defaultRender={{ shading: 'solid', textures: false, colorPreset: 'white' }}
      onRenderError={onError}
      onSceneReadyChange={handleReady}
      sceneReadyKey={`${scene.project.id}:${scene.revision.version}`}
      selectionManager="custom"
    >
      <AxoControls bounds={bounds} />
      <MeasureTool />
      <RoomTagProjector locate={locateRoom} />
      <HideGround scene={scene} />
      <ListingCutaway scene={scene} levelId={levelId} />
    </Viewer>
  )
}

const down = new Raycaster()
down.layers.enableAll()

/**
 * Finds a room in the runtime for its tag, with its floor surface's height: the zone sits at its
 * level's base, so the floor is measured on the slabs under the outline's middle, once they are built.
 */
function roomLocator(scene: SceneResponse) {
  const floors = new Map<string, number>()
  return (id: string): RoomLocation | null => {
    const object = sceneRegistry.nodes.get(id)
    const node = scene.graph.nodes[id]
    const zone = node && zoneInfo(node)
    if (!object || !zone) return null
    const base = object.getWorldPosition(new Vector3()).y
    let floor = floors.get(id)
    if (floor === undefined) {
      floor = base
      const slabs = [...(sceneRegistry.byType.slab ?? [])]
        .map((slab) => sceneRegistry.nodes.get(slab))
        .filter((slab): slab is Object3D => !!slab)
      const x = zone.polygon.reduce((sum, [px]) => sum + px, 0) / zone.polygon.length
      const z = zone.polygon.reduce((sum, [, pz]) => sum + pz, 0) / zone.polygon.length
      const origin = object.localToWorld(new Vector3(x, 0, z))
      origin.y = base + 1.5
      down.set(origin, new Vector3(0, -1, 0))
      down.far = 1.75
      const hit = down.intersectObjects(slabs, true)[0]
      if (hit) floor = hit.point.y
      // Slabs mount lazily: measure again until there are some.
      if (slabs.length) floors.set(id, floor)
    }
    return { object, floor }
  }
}

/** The buildings' world bounds, from the objects the runtime registered. */
function liveBounds(scene: SceneResponse): Box3 | null {
  const bounds = new Box3()
  for (const node of Object.values(scene.graph.nodes)) {
    if (node.type !== 'building') continue
    const object = sceneRegistry.nodes.get(node.id)
    if (object) bounds.expandByObject(object)
  }
  return bounds.isEmpty() ? null : bounds
}

/** A storey's height, for framing a room whose outline is flat. */
const ROOM_HEIGHT = 2.7

/** A room as a world box: its outline, one storey tall. */
function roomBox(scene: SceneResponse, id: string): Box3 | null {
  const node = scene.graph.nodes[id]
  const zone = node && zoneInfo(node)
  const object = sceneRegistry.nodes.get(id)
  if (!zone || !object) return null
  const box = new Box3()
  const corner = new Vector3()
  for (const [x, z] of zone.polygon) {
    box.expandByPoint(object.localToWorld(corner.set(x, 0, z)))
    box.expandByPoint(object.localToWorld(corner.set(x, ROOM_HEIGHT, z)))
  }
  return box.isEmpty() ? null : box
}

/** The highest shown room whose outline holds a world point. */
function roomAtPoint(scene: SceneResponse, point: Vector3): string | null {
  let best: { room: string; y: number } | null = null
  for (const node of Object.values(scene.graph.nodes)) {
    const zone = zoneInfo(node)
    if (!zone) continue
    const object = sceneRegistry.nodes.get(node.id)
    if (!object || !object.visible) continue
    const local = object.worldToLocal(point.clone())
    const y = object.getWorldPosition(new Vector3()).y
    if (y > point.y + 0.25 || (best && y <= best.y) || !zoneContains(zone, local.x, local.z)) continue
    best = { room: node.id, y }
  }
  return best?.room ?? null
}

/**
 * The drawing has no ground: hide what the site draws itself (its ground and parcel), keeping
 * the buildings it holds.
 */
function HideGround({ scene }: Pick<LiveViewerProps, 'scene'>) {
  const sites = useMemo(() => Object.values(scene.graph.nodes).filter((node) => node.type === 'site'), [scene.graph])
  useFrame(() => {
    for (const site of sites) {
      const object = sceneRegistry.nodes.get(site.id)
      if (!object) continue
      const kept = (site.children ?? [])
        .map((id) => sceneRegistry.nodes.get(id as string))
        .filter((child): child is Object3D => !!child)
      for (const child of object.children) {
        child.visible = kept.some((node) => isSelfOrAncestor(child, node))
      }
    }
  })
  return null
}

function isSelfOrAncestor(candidate: Object3D, object: Object3D) {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (current === candidate) return true
  }
  return false
}

function ListingCutaway({ scene, levelId }: Pick<LiveViewerProps, 'scene' | 'levelId'>) {
  const shells = useMemo(() => Object.values(scene.graph.nodes).filter((node) =>
    node.type === 'ceiling' || node.type === 'roof' || node.type === 'roof-segment'), [scene.graph])
  // Match the baked floor control's dollhouse view, including nodes that mount lazily.
  useFrame(() => {
    for (const node of shells) {
      const object = sceneRegistry.nodes.get(node.id)
      if (object) object.visible = node.visible !== false && levelId === null
    }
  })
  return null
}

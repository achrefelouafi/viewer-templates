import { type AnyNodeId, initSpatialGridSync, operateItem, sceneRegistry, toggleDoorOpenState, toggleWindowOpenState, useInteractive, useScene } from '@pascal-app/core'
import { InteractiveSystem, SceneEnvironment, useViewer, Viewer } from '@pascal-app/viewer'
import { SceneLoader, selectViewerLevel, useViewerFloorDisplay, type ViewerSource } from '@pascal-app/viewer/ui'
import { useThree } from '@react-three/fiber'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { SceneResponse } from '../pascal'
import { pluginInstallStateOf, publishedSceneSetup } from '../runtime/plugins'
import { CameraRig, type CameraView } from './CameraRig'
import type { Area, FieldKind } from './entities'
import { livePosition } from './effects/common'
import { HomeOverlay, HomeScene, useHomeLayer } from './HomeLayer'
import { ExplorePanel, useSceneLevels } from './explore/ExplorePanel'
import { useIsCompact } from './explore/useIsCompact'
import { ThemeSwitch } from './sketch/ThemeSwitch'

/* A Pascal project as the effects lab shows its home (src/lab/Lab.tsx), with the visitor's own
   Home Assistant in place of the lab's simulated one: the guided tour's wireframe in light or dark,
   walls up at midday, the devices panel, pins and effects on the items Home Assistant drives, and
   the camera flying to a device. Before the visitor connects, the plan shows as the wireframe with
   the connect card where the devices panel will be. The graph is always rebuilt live, as in the lab. */

type SetSceneArgs = Parameters<ReturnType<typeof useScene.getState>['setScene']>
type Graph = Parameters<typeof publishedSceneSetup>[0]

/** Looking down on the whole plan from the south-east, as the lab's opening view does. */
function viewOf(areas: Area[]): CameraView {
  if (!areas.length) return { position: new THREE.Vector3(13, 15, 19), target: new THREE.Vector3(0, 0.4, 0) }
  const x0 = Math.min(...areas.map((a) => a.bounds[0]))
  const z0 = Math.min(...areas.map((a) => a.bounds[1]))
  const x1 = Math.max(...areas.map((a) => a.bounds[2]))
  const z1 = Math.max(...areas.map((a) => a.bounds[3]))
  const size = Math.max(x1 - x0, z1 - z0, 6)
  const target = new THREE.Vector3((x0 + x1) / 2, 0.4, (z0 + z1) / 2)
  return { position: target.clone().add(new THREE.Vector3(size * 0.55, size * 0.75, size * 0.95)), target }
}

export function HomeProjectViewer({ scene, runtimeRevision }: { scene: SceneResponse; runtimeRevision: number }) {
  const { project } = scene
  const graph = useMemo(() => ({ ...scene.graph, installedPlugins: pluginInstallStateOf(scene.graph).installedPlugins }) as unknown as Graph, [scene.graph])
  const [mounted, setMounted] = useState(false)
  const [sceneReady, setSceneReady] = useState(false)

  // the lab's settings: walls up and midday light; light or dark only swaps the ink
  useEffect(() => {
    document.title = project.name || 'Home'
    const g = graph as unknown as { nodes: SetSceneArgs[0]; rootNodeIds: SetSceneArgs[1] }
    useScene.getState().setScene(g.nodes, g.rootNodeIds, publishedSceneSetup(graph))
    const stopGrid = initSpatialGridSync()
    const viewer = useViewer.getState()
    viewer.setProjectId(project.id)
    viewer.resetSelection()
    viewer.setWalkthroughMode(false)
    viewer.setCameraMode('perspective')
    viewer.setLevelMode('stacked')
    viewer.setWallMode('up')
    viewer.setShowGrid(false)
    viewer.setShowMeasurements(false)
    viewer.setTimeOfDay('midday')
    setMounted(true)
    return () => {
      stopGrid()
      useViewer.getState().setProjectId(null)
    }
  }, [graph, project.id, project.name, runtimeRevision])
  useEffect(() => () => useScene.getState().unloadScene(), [])

  return (
    <main className="relative h-full overflow-hidden" data-state={sceneReady ? 'ready' : 'loading'}>
      {mounted && <HomeStage ownerName={project.owner?.displayName ?? null} projectId={project.id} title={project.name || 'Home'} sceneReady={sceneReady} onSceneReady={setSceneReady} sceneKey={`${project.id}:${runtimeRevision}`} />}
      {!sceneReady && <SceneLoader className="bg-background" fullScreen />}
    </main>
  )
}

function HomeStage({ projectId, ownerName, title, sceneReady, onSceneReady, sceneKey }: {
  projectId: string
  ownerName: string | null
  title: string
  sceneReady: boolean
  onSceneReady: (ready: boolean) => void
  sceneKey: string
}) {
  const nodes = useScene((s) => s.nodes)
  const source = useMemo<ViewerSource>(() => ({ nodes, objectFor: (id) => sceneRegistry.nodes.get(id) }), [nodes])
  const home = useHomeLayer({ projectId, source, ready: sceneReady })
  const pins = useRef<Record<string, HTMLElement | null>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [layer, setLayer] = useState<FieldKind | null>('temperature')
  const view = useMemo(() => viewOf(home.areas), [home.areas])
  // a floor picked from the list reads as on the default viewer: the floors above step aside
  useViewerFloorDisplay()
  // open on the lowest floor that has rooms, as the lab shows its home: the roof out of the way
  const opened = useRef(false)
  useEffect(() => {
    if (!sceneReady || opened.current) return
    opened.current = true
    const levels = Object.values(nodes).filter((n): n is Extract<typeof n, { type: 'level' }> => n?.type === 'level').sort((a, b) => a.level - b.level)
    const roomed = levels.find((l) => Object.values(nodes).some((n) => n?.type === 'zone' && n.parentId === l.id))
    if (levels.length > 1 && roomed) selectViewerLevel(roomed.id, source)
  }, [sceneReady, nodes, source])
  // the tour viewer's explore panel on the right: links to Pascal, the project, its floors, plan and rooms
  const levels = useSceneLevels(source)
  const compact = useIsCompact()
  const [exploreOpen, setExploreOpen] = useState(true)
  const [mobileExploreOpen, setMobileExploreOpen] = useState(false)
  useEffect(() => {
    // E opens or folds it, as in the tour viewer
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'e' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (compact) setMobileExploreOpen((v) => !v)
      else setExploreOpen((v) => !v)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [compact])
  // the device controls and the link cards open beside the panel, never under it
  const cardPlace = {
    '--card-top': compact ? '4.25rem' : exploreOpen ? '1rem' : '4.75rem',
    '--card-right': compact || !exploreOpen ? '1rem' : '20rem',
  } as CSSProperties
  // an item clicked on the plan opens its links where a device's controls would: one card at a time
  const [itemId, setItemId] = useState<string | null>(null)
  const kept = useRef(home.kept)
  kept.current = home.kept
  const pickItem = useCallback((id: string | null) => {
    setItemId(id)
    if (!id) return
    setSelected(null)
    // and it works as on Pascal's own viewer: a door swings, a window opens, a fridge or a fan runs.
    // Not what Home Assistant drives: that follows its device (its pin switches it)
    if (!kept.current.has(id)) operateModel(id)
  }, [])

  const press = useCallback((id: string) => setSelected((s) => (s === id ? s : id)), [])
  const select = useCallback((id: string | null) => {
    setSelected(id)
    const e = id ? home.entities[id] : undefined
    const k = e?.attributes.device_class as FieldKind | undefined
    if (e?.entity_id.startsWith('sensor.') && k) setLayer(k)
  }, [home.entities])
  const device = home.devices.find((d) => d.entityId === selected) ?? null
  // a clicked pin group: where its devices are, for the camera to close in on (a new array each click)
  const [group, setGroup] = useState<THREE.Vector3[] | null>(null)
  const zoomTo = useCallback((ids: string[]) => {
    setGroup(ids.map((id) => livePosition.get(id)?.clone() ?? new THREE.Vector3(...(home.devices.find((d) => d.entityId === id)?.anchor.position ?? [0, 0, 0]))))
  }, [home.devices])
  // a device that went away (disconnected, re-linked) is no longer selected
  useEffect(() => {
    if (selected && !home.devices.some((d) => d.entityId === selected)) setSelected(null)
  }, [selected, home.devices])

  return (
    <>
      {/* as the guided tour: no daylight sky, so its Noir or paper theme and light rig show */}
      <Viewer daylight={false} defaultRender={{ shading: 'rendered' }} onSceneReadyChange={onSceneReady} renderContext="viewer" sceneReadyKey={sceneKey} selectionManager="custom" useBvh={false}>
        <SceneEnvironment />
        <CameraRig device={device} group={group} home={view} />
        {import.meta.env.DEV && <DevHandle />}
        <InteractiveSystem />
        {/* a click on an item opens its links; no hover, no room highlight */}
        <ItemPicker nodes={nodes} onPick={pickItem} />
        {/* the guided tour's wireframe over everything but what Home Assistant drives, and their effects */}
        <HomeScene home={home} layer={layer} onPress={press} pins={pins} selected={selected} />
      </Viewer>

      <div className="contents" style={cardPlace}>
      <HomeOverlay home={home} itemId={itemId} layer={layer} onCloseItem={() => setItemId(null)} onGroup={zoomTo} onLayer={setLayer} onSelect={select} pins={pins}
        selected={selected} title={title} />

      </div>

      {/* the tour viewer's explore panel: Pascal's links, the project, its floors, live plan and rooms */}
      <ExplorePanel compact={compact} embed={false} levels={levels} mobileOpen={mobileExploreOpen} onMobileOpenChange={setMobileExploreOpen}
        onOpenChange={setExploreOpen} open={exploreOpen} ownerName={ownerName} projectName={title} source={source} />

      {/* light or dark, as in the lab */}
      <ThemeSwitch className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 sm:bottom-6" />
    </>
  )
}

/**
 * Operates a model by Pascal's own rules, as a click on its viewer does. Not persisted: the scene
 * is read-only here, and a persisted animation would snap back when its write is refused.
 */
function operateModel(id: string) {
  const node = useScene.getState().nodes[id as AnyNodeId] as { type?: string; asset?: { interactive?: unknown } } | undefined
  if (node?.type === 'door') return toggleDoorOpenState(id as AnyNodeId, { persist: false })
  if (node?.type === 'window') return toggleWindowOpenState(id as AnyNodeId, { persist: false })
  const interactive = node?.asset?.interactive as Parameters<typeof operateItem>[1] | undefined
  if (node?.type !== 'item' || !interactive?.controls?.length) return
  const store = useInteractive.getState()
  if (!store.items[id as AnyNodeId]) store.initItem(id as AnyNodeId, interactive, true)
  operateItem(id as AnyNodeId, interactive)
}

/** What a click can pick: things a device can be. */
const PICKABLE = new Set(['item', 'door', 'window'])

/**
 * A click (not a drag) on the plan picks the item under it: the first item along the ray, seen
 * through the ghosted walls, floors and roofs in front of it. Nothing on hover. A click on no item
 * picks nothing.
 */
function ItemPicker({ nodes, onPick }: { nodes: Record<string, { type?: string } | undefined>; onPick: (id: string | null) => void }) {
  const { gl, camera, scene } = useThree()
  const live = useRef({ nodes, onPick })
  live.current = { nodes, onPick }
  useEffect(() => {
    const el = gl.domElement
    const ray = new THREE.Raycaster()
    const at = new THREE.Vector2()
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null
    }
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
      down = null
      const r = el.getBoundingClientRect()
      at.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(at, camera)
      const owner = new Map<THREE.Object3D, string>()
      for (const [id, obj] of sceneRegistry.nodes) owner.set(obj, id)
      for (const hit of ray.intersectObjects(scene.children, true)) {
        if (!hit.object.visible) continue
        for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
          const id = owner.get(o)
          if (id && PICKABLE.has(live.current.nodes[id]?.type ?? '')) return live.current.onPick(id)
        }
      }
      live.current.onPick(null)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }, [gl, camera, scene])
  return null
}

/** Development builds only: the three.js state on `window.__lab`, as in the lab. */
function DevHandle() {
  const state = useThree()
  useEffect(() => {
    ;(window as unknown as { __lab: unknown }).__lab = state
    ;(window as unknown as { __sceneRegistry: unknown }).__sceneRegistry = sceneRegistry
  }, [state])
  return null
}

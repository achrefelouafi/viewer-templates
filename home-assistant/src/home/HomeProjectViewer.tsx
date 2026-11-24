import { initSpatialGridSync, sceneRegistry, useScene } from '@pascal-app/core'
import { InteractiveSystem, SceneEnvironment, useViewer, Viewer } from '@pascal-app/viewer'
import { SceneLoader, useViewerFloorDisplay, ViewerSelectionManager, type ViewerSource } from '@pascal-app/viewer/ui'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { SceneResponse } from '../pascal'
import { pluginInstallStateOf, publishedSceneSetup } from '../runtime/plugins'
import { CameraRig, type CameraView } from './CameraRig'
import type { Area, FieldKind } from './entities'
import { livePosition } from './effects/common'
import { HomeOverlay, HomeScene, useHomeLayer } from './HomeLayer'
import { LevelPicker } from './LevelPicker'
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
      {mounted && <HomeStage projectId={project.id} title={project.name || 'Home'} sceneReady={sceneReady} onSceneReady={setSceneReady} sceneKey={`${project.id}:${runtimeRevision}`} />}
      {!sceneReady && <SceneLoader className="bg-background" fullScreen />}
    </main>
  )
}

function HomeStage({ projectId, title, sceneReady, onSceneReady, sceneKey }: {
  projectId: string
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
  // an item picked on the plan opens its links where a device's controls would: one card at a time
  const picked = useViewer((s) => s.selection.selectedIds[0])
  useEffect(() => {
    if (picked) setSelected(null)
  }, [picked])

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
        {/* Pascal's own picking, as on the default viewer: a click selects a room, then an item in it */}
        <ViewerSelectionManager />
        {/* the guided tour's wireframe over everything but what Home Assistant drives, and their effects */}
        <HomeScene home={home} layer={layer} onPress={press} pins={pins} selected={selected} />
      </Viewer>

      <HomeOverlay home={home} layer={layer} onGroup={zoomTo} onLayer={setLayer} onSelect={select} pins={pins} selected={selected} title={title} />

      {/* the floors, as on the default viewer: the whole building or one floor alone */}
      <LevelPicker className="absolute right-4 bottom-4 z-30 sm:bottom-6" source={source} />

      {/* light or dark, as in the lab */}
      <ThemeSwitch className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 sm:bottom-6" />
    </>
  )
}

/** Development builds only: the three.js state on `window.__lab`, as in the lab. */
function DevHandle() {
  const state = useThree()
  useEffect(() => {
    ;(window as unknown as { __lab: unknown }).__lab = state
  }, [state])
  return null
}

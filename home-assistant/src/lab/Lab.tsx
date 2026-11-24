import { initSpatialGridSync, sceneRegistry, useScene } from '@pascal-app/core'
import { InteractiveSystem, SceneEnvironment, useViewer, Viewer } from '@pascal-app/viewer'
import { SceneLoader, type ViewerSource } from '@pascal-app/viewer/ui'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { type FieldKind, type HomeDevice } from '../home/entities'
import { livePosition } from '../home/effects/common'
import { HomeEffects } from '../home/HomeEffects'
import { HomePanel } from '../home/HomePanel'
import { HomeSketch } from '../home/sketch/HomeSketch'
import { ThemeSwitch } from '../home/sketch/ThemeSwitch'
import { createHomeSimulator } from '../home/simulator'
import { prepareSceneRuntime } from '../runtime/bootstrap'
import { publishedSceneSetup } from '../runtime/plugins'
import { AREAS, FLOOR_Y, INDOOR, LAB_AIR, LAB_AREA_OF, LAB_DEVICES, LAB_ENTITIES, LAB_GRAPH, LAB_SCENERY } from './labHome'
import { LabBody, Panel } from './LabBodies'

/* The effects lab (/lab, or ?lab): a small home of three rooms and a garden, built as a Pascal graph and rendered by the
   Pascal viewer, with every device family placed by hand and driven by a simulated Home Assistant.
   It is where effects are made and tuned before they attach to a real project's items. */

/** The Pascal nodes a Home Assistant device drives (a door its lock opens): kept in colour on the plan. */
const CONNECTED: ReadonlySet<string> = new Set(LAB_DEVICES.flatMap((d) => (d.nodeId ? [d.nodeId] : [])))
const HOME_VIEW = { position: new THREE.Vector3(13, 15, 19), target: new THREE.Vector3(2, 0.4, 2) }

export default function Lab() {
  const [ready, setReady] = useState(false)
  const [sceneReady, setSceneReady] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    document.title = 'Home Assistant effects lab'
    const abort = new AbortController()
    let dispose: (() => void) | undefined
    let stopGrid: (() => void) | undefined
    void prepareSceneRuntime({ projectId: 'lab', graph: LAB_GRAPH, signal: abort.signal })
      .then((prepared) => {
        dispose = prepared.dispose
        if (abort.signal.aborted) return prepared.dispose()
        type Input = Parameters<ReturnType<typeof useScene.getState>['setScene']>
        useScene.getState().setScene(LAB_GRAPH.nodes as Input[0], LAB_GRAPH.rootNodeIds as Input[1], publishedSceneSetup(LAB_GRAPH))
        stopGrid = initSpatialGridSync()
        const viewer = useViewer.getState()
        viewer.resetSelection()
        viewer.setCameraMode('perspective')
        viewer.setLevelMode('stacked')
        // the guided tour's settings: walls up and midday light; light or dark only swaps the ink
        viewer.setWallMode('up')
        viewer.setShowGrid(false)
        viewer.setShowMeasurements(false)
        viewer.setTimeOfDay('midday')
        setReady(true)
      })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted) setError(failure)
      })
    return () => {
      abort.abort()
      stopGrid?.()
      useScene.getState().unloadScene()
      dispose?.()
    }
  }, [])

  if (error) return <main role="alert" className="grid h-full place-items-center p-6 text-sm">The lab failed to start: {String(error)}</main>
  return (
    <main className="relative h-full overflow-hidden" data-state={sceneReady ? 'ready' : 'loading'}>
      {ready && <LabStage onSceneReady={setSceneReady} />}
      {!sceneReady && <SceneLoader className="bg-background" fullScreen />}
    </main>
  )
}

function LabStage({ onSceneReady }: { onSceneReady: (ready: boolean) => void }) {
  const useHome = useMemo(() => createHomeSimulator(LAB_ENTITIES, LAB_AREA_OF, LAB_AIR), [])
  const entities = useHome((s) => s.entities)
  const lastCall = useHome((s) => s.lastCall)
  const callService = useHome((s) => s.callService)
  const [selected, setSelected] = useState<string | null>(null)
  const [layer, setLayer] = useState<FieldKind | null>('temperature')
  const pins = useRef<Record<string, HTMLElement | null>>({})
  const notice = useHome((s) => s.notice)
  // the lab stays at midday, as the tour does: full daylight in the rooms
  useEffect(() => useHome.getState().setDaylight(1), [useHome])
  const nodes = useScene((s) => s.nodes)
  const source = useMemo<ViewerSource>(() => ({ nodes, objectFor: (id) => sceneRegistry.nodes.get(id) }), [nodes])

  // development builds only: the simulated Home Assistant on `window.__home`, for testing from the console
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __home: unknown }).__home = useHome
  }, [useHome])

  // the home keeps moving while the lab is open
  useEffect(() => {
    const id = window.setInterval(() => useHome.getState().tick(0.25), 250)
    return () => clearInterval(id)
  }, [useHome])

  const press = useCallback((id: string) => setSelected((s) => (s === id ? s : id)), [])
  const select = useCallback((id: string | null) => {
    setSelected(id)
    const e = id ? useHome.getState().entities[id] : undefined
    if (e && e.entity_id.startsWith('sensor.')) {
      const k = e.attributes.device_class as FieldKind
      setLayer(k)
    }
  }, [useHome])
  const device = LAB_DEVICES.find((d) => d.entityId === selected) ?? null
  // a clicked pin group: where its devices are, for the camera to close in on (a new array each click)
  const [group, setGroup] = useState<THREE.Vector3[] | null>(null)
  const zoomTo = useCallback((ids: string[]) => {
    setGroup(ids.map((id) => livePosition.get(id)?.clone() ?? new THREE.Vector3(...(LAB_DEVICES.find((d) => d.entityId === id)?.anchor.position ?? [0, 0, 0]))))
  }, [])

  return (
    <>
      <Viewer defaultRender={{ shading: 'rendered' }} onSceneReadyChange={onSceneReady} renderContext="viewer" sceneReadyKey="lab" selectionManager="custom" useBvh={false}>
        {/* as on the project viewer, so the lab's sky and grounds match it */}
        <SceneEnvironment />
        <CameraRig device={device} group={group} />
        {import.meta.env.DEV && <DevHandle />}
        {LAB_DEVICES.map((d) => entities[d.entityId] && <LabBody key={d.entityId} model={d.model} e={entities[d.entityId]!} position={d.anchor.position} rotationY={d.anchor.rotationY} />)}
        {LAB_SCENERY.map((s, i) => (
          <group key={i} position={s.position} rotation-y={s.rotationY}>
            <Panel />
          </group>
        ))}
        {/* swings the front door when the lock opens it or its contact sensor reads open */}
        <InteractiveSystem />
        {/* everything as a plan in ink but what Home Assistant drives */}
        <HomeSketch source={source} keep={CONNECTED} />
        <HomeEffects devices={LAB_DEVICES} areas={AREAS} indoor={INDOOR} entities={entities} layer={layer} floorY={FLOOR_Y} pins={pins} selected={selected} onPress={press} />
      </Viewer>

      <HomePanel title="Effects lab" devices={LAB_DEVICES} areas={AREAS} entities={entities} selected={selected} lastCall={lastCall} notice={notice} layer={layer} pins={pins}
        onSelect={select} onGroup={zoomTo} call={callService} onLayer={setLayer} />

      {/* the lab's only control, as in the guided tour: light or dark */}
      <ThemeSwitch className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 sm:bottom-6" />
    </>
  )
}

/** Development builds only: the three.js state on `window.__lab`, for inspecting effects from the console. */
function DevHandle() {
  const state = useThree()
  useEffect(() => {
    ;(window as unknown as { __lab: unknown }).__lab = state
  }, [state])
  return null
}

/** Orbit controls that fly to the chosen device (looking at it from in front) and back out again,
    or close in on a group of pins until they separate. */
function CameraRig({ device, group }: { device: HomeDevice | null; group: THREE.Vector3[] | null }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const flying = useRef(0)
  const wantPos = useMemo(() => new THREE.Vector3(), [])
  const wantTgt = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    if (device) {
      const [x, y, z] = device.anchor.position
      const a = device.anchor.rotationY
      // stand in front of it, a little to the side and above, further back for ceiling fittings
      const dist = device.anchor.mount === 'ceiling' ? 4.2 : device.anchor.mount === 'wall' ? 3 : 3.4
      const side = a + 0.45
      wantTgt.set(x, device.anchor.mount === 'ceiling' ? y - 0.9 : y - 0.2, z)
      wantPos.set(x + Math.cos(side) * dist, Math.max(y, 1.2) + 1.1, z - Math.sin(side) * dist)
    } else {
      wantPos.copy(HOME_VIEW.position)
      wantTgt.copy(HOME_VIEW.target)
    }
    flying.current = 1.4
  }, [device, wantPos, wantTgt])

  useEffect(() => {
    const c = controls.current
    if (!group?.length || !c) return
    // keep looking from the same side, just closer: near enough that pins a few
    // centimetres apart sit a pin's width apart on screen
    const centre = group.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(group.length)
    const spread = Math.max(...group.map((p) => p.distanceTo(centre)))
    const dir = camera.position.clone().sub(c.target).normalize()
    wantTgt.copy(centre)
    wantPos.copy(centre).addScaledVector(dir, THREE.MathUtils.clamp(spread * 5 + 1.2, 1.4, 9))
    flying.current = 1.4
  }, [group, camera, wantPos, wantTgt])

  useEffect(() => {
    camera.position.copy(HOME_VIEW.position)
    controls.current?.target.copy(HOME_VIEW.target)
  }, [camera])

  useFrame((_, dt) => {
    const c = controls.current
    if (!c || flying.current <= 0) return
    flying.current -= dt
    const k = 1 - Math.exp(-dt * 3.5)
    camera.position.lerp(wantPos, k)
    c.target.lerp(wantTgt, k)
    c.update()
  })

  return <OrbitControls ref={controls} makeDefault maxPolarAngle={Math.PI / 2.05} minDistance={1} maxDistance={40} onStart={() => (flying.current = 0)} />
}

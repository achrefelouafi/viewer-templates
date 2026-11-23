import { OVERLAY_LAYER, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CylinderGeometry,
  type Group,
  type Mesh,
  type Object3D,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { isDark } from '../../theme'
import { playOrbTap } from '../chrome/orbSounds'
import {
  constrainToDominantAxis,
  distanceBetween,
  formatMetres,
  pickMeasurePoint,
  resolveMeasureRoot,
  worldUnitsPerPixelAt,
} from './raycast'
import { type AxisLock, type Measurement, useMeasureStore, type Vec3 } from './store'

const NO_RAYCAST = () => {}
/** Maximum pointer travel (px) between down and up that counts as a click rather than an orbit drag. */
const CLICK_SLOP_PX = 4
const MIN_MEASURE_DISTANCE = 1e-4

const UP = new Vector3(0, 1, 0)
const _a = new Vector3()
const _b = new Vector3()
const _mid = new Vector3()
const _dir = new Vector3()
const _quat = new Quaternion()

const AXIS_COLORS: Record<Exclude<AxisLock, null>, string> = {
  x: '#ef4444',
  y: '#22c55e',
  z: '#3b82f6',
}

const SNAP_RING_COLOR = '#6366f1'

function useDarkMode(): boolean {
  const [dark, setDark] = useState(isDark)
  useEffect(() => {
    const sync = () => setDark(isDark())
    addEventListener('pascal-theme', sync)
    const system = matchMedia('(prefers-color-scheme: dark)')
    system.addEventListener('change', sync)
    return () => {
      removeEventListener('pascal-theme', sync)
      system.removeEventListener('change', sync)
    }
  }, [])
  return dark
}

interface MeasureVisuals {
  segmentGeo: CylinderGeometry
  dotGeo: SphereGeometry
  ringGeo: RingGeometry
  coreMat: MeshBasicNodeMaterial
  haloMat: MeshBasicNodeMaterial
  liveMat: MeshBasicNodeMaterial
  snapMat: MeshBasicNodeMaterial
}

function orientSegment(
  halo: Mesh | null,
  core: Mesh | null,
  a: Vec3,
  b: Vec3,
  worldPerPx: number,
) {
  _a.set(a[0], a[1], a[2])
  _b.set(b[0], b[1], b[2])
  const len = _a.distanceTo(_b)
  if (len < MIN_MEASURE_DISTANCE) {
    if (halo) halo.visible = false
    if (core) core.visible = false
    return
  }
  _mid.addVectors(_a, _b).multiplyScalar(0.5)
  _dir.subVectors(_b, _a).divideScalar(len)
  _quat.setFromUnitVectors(UP, _dir)

  const coreRadius = Math.max(worldPerPx * 1.15, 0.0015)
  const haloRadius = coreRadius * 2.1

  if (halo) {
    halo.visible = true
    halo.position.copy(_mid)
    halo.quaternion.copy(_quat)
    halo.scale.set(haloRadius, len, haloRadius)
  }
  if (core) {
    core.visible = true
    core.position.copy(_mid)
    core.quaternion.copy(_quat)
    core.scale.set(coreRadius, len, coreRadius)
  }
}

function placeDot(halo: Mesh | null, core: Mesh | null, point: Vec3, worldPerPx: number, pxRadius: number) {
  const r = Math.max(worldPerPx * pxRadius, 0.003)
  const haloR = r * 1.55
  if (halo) {
    halo.visible = true
    halo.position.set(point[0], point[1], point[2])
    halo.scale.setScalar(haloR)
  }
  if (core) {
    core.visible = true
    core.position.set(point[0], point[1], point[2])
    core.scale.setScalar(r)
  }
}

function FinishedMeasurement({
  measurement,
  visuals,
  onRemove,
}: {
  measurement: Measurement
  visuals: MeasureVisuals
  onRemove: (id: string) => void
}) {
  const haloLineRef = useRef<Mesh>(null)
  const coreLineRef = useRef<Mesh>(null)
  const haloARef = useRef<Mesh>(null)
  const coreARef = useRef<Mesh>(null)
  const haloBRef = useRef<Mesh>(null)
  const coreBRef = useRef<Mesh>(null)

  const midpoint = useMemo<[number, number, number]>(
    () => [
      (measurement.a[0] + measurement.b[0]) * 0.5,
      (measurement.a[1] + measurement.b[1]) * 0.5,
      (measurement.a[2] + measurement.b[2]) * 0.5,
    ],
    [measurement.a, measurement.b],
  )
  const label = useMemo(() => formatMetres(measurement.a, measurement.b), [measurement.a, measurement.b])

  useFrame(({ camera, size }) => {
    _mid.set(midpoint[0], midpoint[1], midpoint[2])
    const midPerPx = worldUnitsPerPixelAt(_mid, camera, size.height)
    orientSegment(haloLineRef.current, coreLineRef.current, measurement.a, measurement.b, midPerPx)

    _a.set(measurement.a[0], measurement.a[1], measurement.a[2])
    placeDot(haloARef.current, coreARef.current, measurement.a, worldUnitsPerPixelAt(_a, camera, size.height), 3.6)

    _b.set(measurement.b[0], measurement.b[1], measurement.b[2])
    placeDot(haloBRef.current, coreBRef.current, measurement.b, worldUnitsPerPixelAt(_b, camera, size.height), 3.6)
  })

  return (
    <group userData={{ __measureTool: true }}>
      <mesh
        frustumCulled={false}
        geometry={visuals.segmentGeo}
        layers={OVERLAY_LAYER}
        material={visuals.haloMat}
        raycast={NO_RAYCAST}
        ref={haloLineRef}
        renderOrder={1000}
      />
      <mesh
        frustumCulled={false}
        geometry={visuals.segmentGeo}
        layers={OVERLAY_LAYER}
        material={visuals.coreMat}
        raycast={NO_RAYCAST}
        ref={coreLineRef}
        renderOrder={1001}
      />
      <mesh
        frustumCulled={false}
        geometry={visuals.dotGeo}
        layers={OVERLAY_LAYER}
        material={visuals.haloMat}
        raycast={NO_RAYCAST}
        ref={haloARef}
        renderOrder={1002}
      />
      <mesh
        frustumCulled={false}
        geometry={visuals.dotGeo}
        layers={OVERLAY_LAYER}
        material={visuals.coreMat}
        raycast={NO_RAYCAST}
        ref={coreARef}
        renderOrder={1003}
      />
      <mesh
        frustumCulled={false}
        geometry={visuals.dotGeo}
        layers={OVERLAY_LAYER}
        material={visuals.haloMat}
        raycast={NO_RAYCAST}
        ref={haloBRef}
        renderOrder={1002}
      />
      <mesh
        frustumCulled={false}
        geometry={visuals.dotGeo}
        layers={OVERLAY_LAYER}
        material={visuals.coreMat}
        raycast={NO_RAYCAST}
        ref={coreBRef}
        renderOrder={1003}
      />
      <Html center pointerEvents="none" position={midpoint} zIndexRange={[15, 0]}>
        <div
          className="ui-glass pointer-events-none relative inline-flex items-center gap-1 rounded-full py-1 pr-1 pl-2.5 text-foreground shadow-sm select-none"
          data-measure-label=""
        >
          <span className="whitespace-nowrap font-mono font-medium text-[11px] leading-none tabular-nums">
            {label}
          </span>
          <button
            aria-label="Delete measurement"
            className="pointer-events-auto grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
            onClick={(event) => {
              event.stopPropagation()
              playOrbTap('close')
              onRemove(measurement.id)
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            type="button"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </Html>
    </group>
  )
}

/**
 * Interactive 3D point-to-point distance measurement tool, mounted inside `<Viewer>` while
 * measure mode is active. Disables R3F mesh events so clicks never trigger selection while
 * leaving native `ViewerCameraControls` orbit/pan/zoom gestures untouched.
 */
export function MeasureTool({
  glbActive,
  glbObjects,
}: {
  glbActive: boolean
  glbObjects: ReadonlyMap<string, Object3D>
}) {
  const { camera, gl, scene, get, setEvents } = useThree()
  const dark = useDarkMode()
  const pendingA = useMeasureStore((s) => s.pendingA)
  const pendingSource = useMeasureStore((s) => s.pendingSource)
  const measurements = useMeasureStore((s) => s.measurements)
  const removeMeasurement = useMeasureStore((s) => s.removeMeasurement)

  // Drop an unfinished 3D rubber band if the 3D pane unmounts (finished measurements persist).
  useEffect(
    () => () => {
      const store = useMeasureStore.getState()
      if (store.pendingSource === '3d') store.cancelPending()
    },
    [],
  )

  const glbObjectsRef = useRef(glbObjects)
  glbObjectsRef.current = glbObjects
  const glbActiveRef = useRef(glbActive)
  glbActiveRef.current = glbActive

  const existingEndpoints = useMemo<Vec3[]>(() => {
    const list: Vec3[] = []
    for (const m of measurements) list.push(m.a, m.b)
    return list
  }, [measurements])
  const endpointsRef = useRef(existingEndpoints)
  endpointsRef.current = existingEndpoints

  // Shared geometries and WebGPU-safe node materials, disposed on unmount.
  const visuals = useMemo<MeasureVisuals>(() => {
    const makeMat = (color: string, opacity = 1) =>
      new MeshBasicNodeMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        transparent: opacity < 1,
        opacity,
      })
    return {
      segmentGeo: new CylinderGeometry(1, 1, 1, 8, 1, true),
      dotGeo: new SphereGeometry(1, 14, 10),
      ringGeo: new RingGeometry(0.68, 1, 32),
      coreMat: makeMat('#171717'),
      haloMat: makeMat('#fafafa', 0.92),
      liveMat: makeMat('#171717'),
      snapMat: makeMat(SNAP_RING_COLOR, 0.95),
    }
  }, [])

  useEffect(() => () => {
    visuals.segmentGeo.dispose()
    visuals.dotGeo.dispose()
    visuals.ringGeo.dispose()
    visuals.coreMat.dispose()
    visuals.haloMat.dispose()
    visuals.liveMat.dispose()
    visuals.snapMat.dispose()
  }, [visuals])

  // Keep neutral line & marker contrast aligned with light/dark mode.
  const neutralColor = dark ? '#f4f4f4' : '#171717'
  const haloColor = dark ? '#0a0a0a' : '#fafafa'
  const neutralColorRef = useRef(neutralColor)
  neutralColorRef.current = neutralColor

  useEffect(() => {
    visuals.coreMat.color.set(neutralColor)
    visuals.haloMat.color.set(haloColor)
    visuals.liveMat.color.set(neutralColor)
  }, [visuals, neutralColor, haloColor])

  // Disable R3F pointer event dispatch while measuring and restore the prior value on unmount.
  useEffect(() => {
    const previousEnabled = get().events.enabled
    setEvents({ enabled: false })
    return () => {
      setEvents({ enabled: previousEnabled })
    }
  }, [get, setEvents])

  // Unmounting `<ViewerRooms>` during measure mode runs its cleanup which can re-enable `showZones`.
  // Hold `showZones` off while MeasureTool is mounted so raw zone meshes never appear in live scenes.
  useEffect(() => {
    useViewer.getState().setShowZones(false)
    const unsubscribe = useViewer.subscribe((state) => {
      if (state.showZones) useViewer.getState().setShowZones(false)
    })
    return unsubscribe
  }, [])

  // Refs for imperatively updated cursor, snap ring, point A, rubber-band line, and live label.
  const cursorHaloRef = useRef<Mesh>(null)
  const cursorCoreRef = useRef<Mesh>(null)
  const snapHaloRef = useRef<Mesh>(null)
  const snapRingRef = useRef<Mesh>(null)
  const pendingAHaloRef = useRef<Mesh>(null)
  const pendingACoreRef = useRef<Mesh>(null)
  const liveHaloLineRef = useRef<Mesh>(null)
  const liveCoreLineRef = useRef<Mesh>(null)
  const liveLabelGroupRef = useRef<Group>(null)
  const liveLabelPillRef = useRef<HTMLDivElement>(null)
  const liveLabelDotRef = useRef<HTMLSpanElement>(null)
  const liveLabelTextRef = useRef<HTMLSpanElement>(null)

  const pointerRef = useRef({
    inside: false,
    clientX: 0,
    clientY: 0,
    dirty: false,
    buttons: 0,
  })
  const hoverHitRef = useRef<{ point: Vec3; snapped: boolean } | null>(null)
  const shiftHeldRef = useRef(false)
  const spaceHeldRef = useRef(false)

  // Native DOM listeners on the canvas and window: never stop propagation so CameraControls keeps orbiting.
  useEffect(() => {
    const canvas = gl.domElement
    const activePointers = new Set<number>()
    let down: { pointerId: number; x: number; y: number } | null = null

    const raycastAtClient = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      const root = resolveMeasureRoot(scene, glbActiveRef.current, glbObjectsRef.current)
      if (!root) return null
      return pickMeasurePoint(
        root,
        camera,
        clientX - rect.left,
        clientY - rect.top,
        rect.width,
        rect.height,
        glbActiveRef.current,
        endpointsRef.current,
      )
    }

    const onPointerMove = (event: PointerEvent) => {
      shiftHeldRef.current = event.shiftKey
      const p = pointerRef.current
      p.inside = true
      p.clientX = event.clientX
      p.clientY = event.clientY
      p.buttons = event.buttons
      p.dirty = true
    }

    const onPointerDown = (event: PointerEvent) => {
      shiftHeldRef.current = event.shiftKey
      activePointers.add(event.pointerId)
      if (activePointers.size > 1) {
        down = null
        return
      }
      if (event.button === 0 && !spaceHeldRef.current) {
        down = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      shiftHeldRef.current = event.shiftKey
      activePointers.delete(event.pointerId)
      const gesture = down
      if (gesture && gesture.pointerId === event.pointerId) down = null
      if (!gesture || gesture.pointerId !== event.pointerId) return
      if (event.button !== 0 || spaceHeldRef.current) return
      if (useViewer.getState().cameraDragging) return

      const travel = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y)
      if (travel >= CLICK_SLOP_PX) return

      const hit = raycastAtClient(event.clientX, event.clientY)
      hoverHitRef.current = hit
      pointerRef.current.dirty = false
      if (!hit) return

      const store = useMeasureStore.getState()
      if (store.pendingA !== null && store.pendingSource === '3d') {
        const finalB = shiftHeldRef.current
          ? constrainToDominantAxis(store.pendingA, hit.point).point
          : hit.point
        if (distanceBetween(store.pendingA, finalB) > MIN_MEASURE_DISTANCE) {
          store.commitMeasurement(finalB)
          playOrbTap('open')
        }
      } else {
        // Fresh measurement (also restarts cleanly if pendingA was placed on the 2D plan).
        store.setPendingA(hit.point, '3d')
        playOrbTap('press')
      }
    }

    const onPointerCancel = (event: PointerEvent) => {
      activePointers.delete(event.pointerId)
      if (down?.pointerId === event.pointerId) down = null
      pointerRef.current.inside = false
      hoverHitRef.current = null
    }

    const onPointerLeave = () => {
      pointerRef.current.inside = false
      pointerRef.current.dirty = false
      hoverHitRef.current = null
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftHeldRef.current = true
      if (event.code === 'Space') spaceHeldRef.current = true
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftHeldRef.current = false
      if (event.code === 'Space') spaceHeldRef.current = false
    }

    const onBlur = () => {
      shiftHeldRef.current = false
      spaceHeldRef.current = false
      down = null
      activePointers.clear()
      pointerRef.current.inside = false
      hoverHitRef.current = null
    }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('pointerleave', onPointerLeave)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [camera, gl, scene])

  // Per-frame: run at most one raycast when pointer moved, then keep markers & rubber-band screen-sized.
  useFrame(({ camera: activeCamera, size }) => {
    const pointer = pointerRef.current
    const dragging = useViewer.getState().cameraDragging || pointer.buttons !== 0

    if (pointer.inside && pointer.dirty && !dragging) {
      pointer.dirty = false
      const rect = gl.domElement.getBoundingClientRect()
      const root = resolveMeasureRoot(scene, glbActiveRef.current, glbObjectsRef.current)
      hoverHitRef.current = root
        ? pickMeasurePoint(
            root,
            activeCamera,
            pointer.clientX - rect.left,
            pointer.clientY - rect.top,
            rect.width,
            rect.height,
            glbActiveRef.current,
            endpointsRef.current,
          )
        : null
    }

    const { pendingA: currentA, pendingSource: currentSource } = useMeasureStore.getState()
    const owning3d = currentA !== null && currentSource === '3d'
    const rawHit = pointer.inside && !dragging ? hoverHitRef.current : null

    // Point A marker when placed.
    if (currentA) {
      _a.set(currentA[0], currentA[1], currentA[2])
      placeDot(
        pendingAHaloRef.current,
        pendingACoreRef.current,
        currentA,
        worldUnitsPerPixelAt(_a, activeCamera, size.height),
        4,
      )
    } else {
      if (pendingAHaloRef.current) pendingAHaloRef.current.visible = false
      if (pendingACoreRef.current) pendingACoreRef.current.visible = false
    }

    // Resolve live endpoint (axis-locked when Shift is held after placing A in 3D).
    let activePoint: Vec3 | null = rawHit?.point ?? null
    let lockedAxis: AxisLock = null
    let showSnapRing = Boolean(rawHit?.snapped)

    if (owning3d && rawHit && shiftHeldRef.current) {
      const constrained = constrainToDominantAxis(currentA, rawHit.point)
      activePoint = constrained.point
      lockedAxis = constrained.axis
      showSnapRing = false
    }

    // Update live material colour (axis colour when Shift-locked, neutral otherwise).
    visuals.liveMat.color.set(lockedAxis ? AXIS_COLORS[lockedAxis] : neutralColorRef.current)

    // Cursor dot & vertex-snap ring.
    if (activePoint) {
      _b.set(activePoint[0], activePoint[1], activePoint[2])
      const px = worldUnitsPerPixelAt(_b, activeCamera, size.height)
      placeDot(cursorHaloRef.current, cursorCoreRef.current, activePoint, px, showSnapRing ? 3.8 : 3.2)

      if (snapHaloRef.current && snapRingRef.current) {
        snapHaloRef.current.visible = showSnapRing
        snapRingRef.current.visible = showSnapRing
        if (showSnapRing) {
          const ringRadius = Math.max(px * 9.5, 0.01)
          snapRingRef.current.position.copy(_b)
          snapRingRef.current.quaternion.copy(activeCamera.quaternion)
          snapRingRef.current.scale.setScalar(ringRadius)

          snapHaloRef.current.position.copy(_b)
          snapHaloRef.current.quaternion.copy(activeCamera.quaternion)
          snapHaloRef.current.scale.setScalar(ringRadius * 1.18)
        }
      }
    } else {
      if (cursorHaloRef.current) cursorHaloRef.current.visible = false
      if (cursorCoreRef.current) cursorCoreRef.current.visible = false
      if (snapHaloRef.current) snapHaloRef.current.visible = false
      if (snapRingRef.current) snapRingRef.current.visible = false
    }

    // Live rubber-band line + midpoint HTML label (only when 3D owns pendingA).
    if (owning3d && activePoint && distanceBetween(currentA, activePoint) > MIN_MEASURE_DISTANCE) {
      _mid.set(
        (currentA[0] + activePoint[0]) * 0.5,
        (currentA[1] + activePoint[1]) * 0.5,
        (currentA[2] + activePoint[2]) * 0.5,
      )
      const midPx = worldUnitsPerPixelAt(_mid, activeCamera, size.height)
      orientSegment(liveHaloLineRef.current, liveCoreLineRef.current, currentA, activePoint, midPx)

      if (liveLabelGroupRef.current) {
        liveLabelGroupRef.current.position.copy(_mid)
      }
      if (liveLabelTextRef.current) {
        liveLabelTextRef.current.textContent = formatMetres(currentA, activePoint)
      }
      if (liveLabelDotRef.current) {
        if (lockedAxis) {
          liveLabelDotRef.current.style.display = 'inline-block'
          liveLabelDotRef.current.style.backgroundColor = AXIS_COLORS[lockedAxis]
        } else {
          liveLabelDotRef.current.style.display = 'none'
        }
      }
      if (liveLabelPillRef.current) {
        liveLabelPillRef.current.style.opacity = '1'
      }
    } else {
      if (liveHaloLineRef.current) liveHaloLineRef.current.visible = false
      if (liveCoreLineRef.current) liveCoreLineRef.current.visible = false
      if (liveLabelPillRef.current) liveLabelPillRef.current.style.opacity = '0'
    }
  })

  return (
    <group name="measure-tool" userData={{ __measureTool: true }}>
      {/* Hover cursor dot and vertex-snap ring */}
      <mesh
        frustumCulled={false}
        geometry={visuals.dotGeo}
        layers={OVERLAY_LAYER}
        material={visuals.haloMat}
        raycast={NO_RAYCAST}
        ref={cursorHaloRef}
        renderOrder={1004}
        visible={false}
      />
      <mesh
        frustumCulled={false}
        geometry={visuals.dotGeo}
        layers={OVERLAY_LAYER}
        material={visuals.liveMat}
        raycast={NO_RAYCAST}
        ref={cursorCoreRef}
        renderOrder={1005}
        visible={false}
      />
      <mesh
        frustumCulled={false}
        geometry={visuals.ringGeo}
        layers={OVERLAY_LAYER}
        material={visuals.haloMat}
        raycast={NO_RAYCAST}
        ref={snapHaloRef}
        renderOrder={1004}
        visible={false}
      />
      <mesh
        frustumCulled={false}
        geometry={visuals.ringGeo}
        layers={OVERLAY_LAYER}
        material={visuals.snapMat}
        raycast={NO_RAYCAST}
        ref={snapRingRef}
        renderOrder={1006}
        visible={false}
      />

      {/* In-progress point A + live rubber-band segment */}
      <mesh
        frustumCulled={false}
        geometry={visuals.dotGeo}
        layers={OVERLAY_LAYER}
        material={visuals.haloMat}
        raycast={NO_RAYCAST}
        ref={pendingAHaloRef}
        renderOrder={1002}
        visible={false}
      />
      <mesh
        frustumCulled={false}
        geometry={visuals.dotGeo}
        layers={OVERLAY_LAYER}
        material={visuals.liveMat}
        raycast={NO_RAYCAST}
        ref={pendingACoreRef}
        renderOrder={1003}
        visible={false}
      />
      <mesh
        frustumCulled={false}
        geometry={visuals.segmentGeo}
        layers={OVERLAY_LAYER}
        material={visuals.haloMat}
        raycast={NO_RAYCAST}
        ref={liveHaloLineRef}
        renderOrder={1000}
        visible={false}
      />
      <mesh
        frustumCulled={false}
        geometry={visuals.segmentGeo}
        layers={OVERLAY_LAYER}
        material={visuals.liveMat}
        raycast={NO_RAYCAST}
        ref={liveCoreLineRef}
        renderOrder={1001}
        visible={false}
      />

      {pendingA && pendingSource === '3d' ? (
        <group ref={liveLabelGroupRef}>
          <Html center pointerEvents="none" zIndexRange={[16, 0]}>
            <div
              className="ui-glass pointer-events-none relative inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-foreground shadow-sm select-none"
              ref={liveLabelPillRef}
              style={{ opacity: 0 }}
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                ref={liveLabelDotRef}
                style={{ display: 'none' }}
              />
              <span
                className="whitespace-nowrap font-mono font-medium text-[11px] leading-none tabular-nums"
                ref={liveLabelTextRef}
              />
            </div>
          </Html>
        </group>
      ) : null}

      {/* Completed measurements */}
      {measurements.map((measurement) => (
        <FinishedMeasurement
          key={measurement.id}
          measurement={measurement}
          onRemove={removeMeasurement}
          visuals={visuals}
        />
      ))}
    </group>
  )
}

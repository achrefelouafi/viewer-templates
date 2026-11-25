import { floorplanLocalToWorldPoint, worldToFloorplanLocalPoint } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { ViewerSource } from '@pascal-app/viewer/ui'
import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { playOrbTap } from '../chrome/orbSounds'
import {
  collectLevelSnapPoints,
  constrainToDominantXZAxis,
  findNearestPlanSnap,
  resolveActivePlanLevelId,
  resolveLevelWorldY,
  resolvePlanBuildingFrame,
} from './planMath'
import { distanceBetween, formatMetres } from './raycast'
import { useMeasureStore, type Vec3 } from './store'

/** Maximum pointer travel (px) between down and up that counts as a click rather than a plan pan. */
const CLICK_SLOP_PX = 4
const MIN_MEASURE_DISTANCE = 1e-4
/** Horizontal world span (m) or projected screen length (px) below which a 3D line draws as a single dot. */
const VERTICAL_ONLY_WORLD_XZ = 1e-3
const VERTICAL_ONLY_SCREEN_PX = 2

const NEUTRAL_CORE = '#171717'
const NEUTRAL_HALO = '#fafafa'
const SNAP_RING_COLOR = '#6366f1'
const AXIS_COLORS = {
  x: '#ef4444',
  z: '#3b82f6',
} as const

interface MeasurementDomRefs {
  lineHalo: SVGLineElement | null
  lineCore: SVGLineElement | null
  dotAHalo: SVGCircleElement | null
  dotACore: SVGCircleElement | null
  dotBHalo: SVGCircleElement | null
  dotBCore: SVGCircleElement | null
  labelWrap: HTMLDivElement | null
}

/**
 * 2D floorplan measurement overlay, mounted alongside `PlanPovOverlay` while measure mode is active
 * in 2D or split view. Projects every measurement in `useMeasureStore` onto `svg[data-floorplan-preview]`
 * through its scene group's screen matrix so lines, dots, snap rings, and `.ui-glass` labels follow
 * pan, zoom, and rotation smoothly, while capture-phase click guards prevent plan selection without
 * interfering with `FloorplanPreview`'s wheel zoom or drag pan.
 */
export function PlanMeasure({ source }: { source: ViewerSource }) {
  const measurements = useMeasureStore((s) => s.measurements)
  const pendingA = useMeasureStore((s) => s.pendingA)
  const pendingSource = useMeasureStore((s) => s.pendingSource)
  const removeMeasurement = useMeasureStore((s) => s.removeMeasurement)
  const selectedLevelId = useViewer((s) => s.selection.levelId)

  const activeLevelId = useMemo(
    () => resolveActivePlanLevelId(source.nodes, selectedLevelId),
    [source.nodes, selectedLevelId],
  )
  const frame = useMemo(
    () => resolvePlanBuildingFrame(source.nodes, activeLevelId),
    [source.nodes, activeLevelId],
  )
  const levelSnapPoints = useMemo(
    () => collectLevelSnapPoints(source.nodes, activeLevelId),
    [source.nodes, activeLevelId],
  )
  const existingEndpoints = useMemo<Vec3[]>(() => {
    const list: Vec3[] = []
    for (const m of measurements) list.push(m.a, m.b)
    return list
  }, [measurements])

  const sourceRef = useRef(source)
  sourceRef.current = source
  const activeLevelIdRef = useRef(activeLevelId)
  activeLevelIdRef.current = activeLevelId
  const frameRef = useRef(frame)
  frameRef.current = frame
  const snapPointsRef = useRef(levelSnapPoints)
  snapPointsRef.current = levelSnapPoints
  const endpointsRef = useRef(existingEndpoints)
  endpointsRef.current = existingEndpoints
  const measurementsRef = useRef(measurements)
  measurementsRef.current = measurements

  // Cancel an unfinished 2D rubber band if the 2D pane unmounts (finished measurements persist).
  useEffect(
    () => () => {
      const store = useMeasureStore.getState()
      if (store.pendingSource === '2d') store.cancelPending()
    },
    [],
  )

  // Locate `svg[data-floorplan-preview]` once mounted so capture listeners bind reliably.
  const [planSvg, setPlanSvg] = useState<SVGSVGElement | null>(null)
  useEffect(() => {
    let raf = 0
    const find = () => {
      const svg = document.querySelector<SVGSVGElement>('svg[data-floorplan-preview]')
      if (svg) setPlanSvg(svg)
      else raf = requestAnimationFrame(find)
    }
    find()
    return () => cancelAnimationFrame(raf)
  }, [])

  const wrapRef = useRef<HTMLDivElement>(null)
  const domRefs = useRef<Map<string, MeasurementDomRefs>>(new Map())

  const pendingAHaloRef = useRef<SVGCircleElement>(null)
  const pendingACoreRef = useRef<SVGCircleElement>(null)
  const liveLineHaloRef = useRef<SVGLineElement>(null)
  const liveLineCoreRef = useRef<SVGLineElement>(null)
  const cursorHaloRef = useRef<SVGCircleElement>(null)
  const cursorCoreRef = useRef<SVGCircleElement>(null)
  const snapHaloRef = useRef<SVGCircleElement>(null)
  const snapRingRef = useRef<SVGCircleElement>(null)
  const liveLabelWrapRef = useRef<HTMLDivElement>(null)
  const liveLabelDotRef = useRef<HTMLSpanElement>(null)
  const liveLabelTextRef = useRef<HTMLSpanElement>(null)

  const pointerRef = useRef({
    inside: false,
    clientX: 0,
    clientY: 0,
    buttons: 0,
  })
  const shiftHeldRef = useRef(false)

  // Capture-phase listeners on the plan SVG/host: block click selection while letting pan/zoom/rotate through.
  useEffect(() => {
    if (!planSvg) return
    const host = planSvg.parentElement ?? planSvg
    const activePointers = new Set<number>()
    let down: { pointerId: number; x: number; y: number } | null = null

    const resolveClientToWorld = (clientX: number, clientY: number): { world: Vec3; snapped: boolean } | null => {
      const rect = planSvg.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return null
      const sceneGroup = planSvg.querySelector<SVGGElement>(':scope > g')
      const ctm = sceneGroup?.getScreenCTM()
      if (!ctm) return null
      let inv: DOMMatrix
      try {
        inv = ctm.inverse()
      } catch {
        return null
      }
      const currentFrame = frameRef.current
      const snappedLocal = findNearestPlanSnap(
        clientX,
        clientY,
        ctm,
        snapPointsRef.current,
        endpointsRef.current,
        currentFrame,
      )
      const local = snappedLocal ?? new DOMPoint(clientX, clientY).matrixTransform(inv)
      const worldXZ = floorplanLocalToWorldPoint(local, currentFrame.position, currentFrame.rotationY)
      const levelId = activeLevelIdRef.current
      const levelObject = levelId ? sourceRef.current.objectFor(levelId) : undefined
      const levelY = resolveLevelWorldY(sourceRef.current.nodes, levelId, levelObject)
      return { world: [worldXZ.x, levelY, worldXZ.z], snapped: snappedLocal !== null }
    }

    const stopPlanClick = (event: Event) => {
      if (!planSvg.contains(event.target as Node | null)) return
      event.preventDefault()
      event.stopPropagation()
    }

    const onPointerDown = (event: PointerEvent) => {
      shiftHeldRef.current = event.shiftKey
      activePointers.add(event.pointerId)
      if (activePointers.size > 1) {
        down = null
        return
      }
      if (event.button === 0) {
        down = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      shiftHeldRef.current = event.shiftKey
      const p = pointerRef.current
      p.inside = true
      p.clientX = event.clientX
      p.clientY = event.clientY
      p.buttons = event.buttons
      if (down && down.pointerId === event.pointerId) {
        if (Math.hypot(event.clientX - down.x, event.clientY - down.y) >= CLICK_SLOP_PX) {
          down = null
        }
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      shiftHeldRef.current = event.shiftKey
      activePointers.delete(event.pointerId)
      const gesture = down
      if (gesture && gesture.pointerId === event.pointerId) down = null
      if (!gesture || gesture.pointerId !== event.pointerId) return
      if (event.button !== 0) return

      const travel = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y)
      if (travel >= CLICK_SLOP_PX) return

      const resolved = resolveClientToWorld(event.clientX, event.clientY)
      if (!resolved) return

      const store = useMeasureStore.getState()
      if (store.pendingA !== null && store.pendingSource === '2d') {
        const rawB: Vec3 = [resolved.world[0], store.pendingA[1], resolved.world[2]]
        const finalB = shiftHeldRef.current
          ? constrainToDominantXZAxis(store.pendingA, rawB).point
          : rawB
        if (distanceBetween(store.pendingA, finalB) > MIN_MEASURE_DISTANCE) {
          store.commitMeasurement(finalB)
          playOrbTap('open')
        }
      } else {
        // Fresh measurement (also restarts cleanly if pendingA was placed in the 3D pane).
        store.setPendingA(resolved.world, '2d')
        playOrbTap('press')
      }
    }

    const onPointerCancel = (event: PointerEvent) => {
      activePointers.delete(event.pointerId)
      if (down?.pointerId === event.pointerId) down = null
      pointerRef.current.inside = false
    }

    const onPointerLeave = () => {
      pointerRef.current.inside = false
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftHeldRef.current = true
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') shiftHeldRef.current = false
    }

    const onBlur = () => {
      shiftHeldRef.current = false
      down = null
      activePointers.clear()
      pointerRef.current.inside = false
    }

    host.addEventListener('click', stopPlanClick, true)
    host.addEventListener('dblclick', stopPlanClick, true)
    planSvg.addEventListener('pointerdown', onPointerDown, true)
    planSvg.addEventListener('pointermove', onPointerMove, true)
    planSvg.addEventListener('pointerleave', onPointerLeave)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerCancel, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      host.removeEventListener('click', stopPlanClick, true)
      host.removeEventListener('dblclick', stopPlanClick, true)
      planSvg.removeEventListener('pointerdown', onPointerDown, true)
      planSvg.removeEventListener('pointermove', onPointerMove, true)
      planSvg.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerCancel, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [planSvg])

  // Per-frame sync with the plan SVG's live viewBox, pan, zoom, and rotation matrix.
  useEffect(() => {
    let raf = 0

    const setLine = (el: SVGLineElement | null, x1: number, y1: number, x2: number, y2: number, stroke?: string) => {
      if (!el) return
      el.setAttribute('x1', x1.toFixed(1))
      el.setAttribute('y1', y1.toFixed(1))
      el.setAttribute('x2', x2.toFixed(1))
      el.setAttribute('y2', y2.toFixed(1))
      if (stroke) el.setAttribute('stroke', stroke)
      el.style.display = ''
    }

    const hideEl = (el: SVGElement | null) => {
      if (el) el.style.display = 'none'
    }

    const setCircle = (el: SVGCircleElement | null, cx: number, cy: number, fill?: string) => {
      if (!el) return
      el.setAttribute('cx', cx.toFixed(1))
      el.setAttribute('cy', cy.toFixed(1))
      if (fill) el.setAttribute('fill', fill)
      el.style.display = ''
    }

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const wrap = wrapRef.current
      const svg = planSvg?.isConnected
        ? planSvg
        : document.querySelector<SVGSVGElement>('svg[data-floorplan-preview]')
      const sceneGroup = svg?.querySelector<SVGGElement>(':scope > g')
      const ctm = sceneGroup?.getScreenCTM()
      const host = wrap?.parentElement
      if (!wrap || !svg || !ctm || !host) {
        if (wrap) wrap.style.opacity = '0'
        return
      }

      const rect = svg.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) {
        wrap.style.opacity = '0'
        return
      }

      const hostRect = host.getBoundingClientRect()
      wrap.style.left = `${rect.left - hostRect.left}px`
      wrap.style.top = `${rect.top - hostRect.top}px`
      wrap.style.width = `${rect.width}px`
      wrap.style.height = `${rect.height}px`
      wrap.style.opacity = '1'

      const currentFrame = frameRef.current
      const worldToOverlay = (w: Vec3) => {
        const local = worldToFloorplanLocalPoint(w[0], w[2], currentFrame.position, currentFrame.rotationY)
        return {
          x: ctm.a * local.x + ctm.c * local.y + ctm.e - rect.left,
          y: ctm.b * local.x + ctm.d * local.y + ctm.f - rect.top,
        }
      }

      // 1. Update all finalized measurements (projected from world XZ).
      const list = measurementsRef.current
      for (let i = 0; i < list.length; i++) {
        const m = list[i]!
        const refs = domRefs.current.get(m.id)
        if (!refs) continue
        const sa = worldToOverlay(m.a)
        const sb = worldToOverlay(m.b)
        const horizWorld = Math.hypot(m.b[0] - m.a[0], m.b[2] - m.a[2])
        const horizScreen = Math.hypot(sb.x - sa.x, sb.y - sa.y)
        const verticalOnly = horizWorld < VERTICAL_ONLY_WORLD_XZ || horizScreen < VERTICAL_ONLY_SCREEN_PX

        if (verticalOnly) {
          hideEl(refs.lineHalo)
          hideEl(refs.lineCore)
          setCircle(refs.dotAHalo, sa.x, sa.y)
          setCircle(refs.dotACore, sa.x, sa.y)
          hideEl(refs.dotBHalo)
          hideEl(refs.dotBCore)
          if (refs.labelWrap) {
            refs.labelWrap.style.transform = `translate(${sa.x.toFixed(1)}px, ${(sa.y - 20).toFixed(1)}px) translate(-50%, -50%)`
            refs.labelWrap.style.opacity = '1'
          }
        } else {
          setLine(refs.lineHalo, sa.x, sa.y, sb.x, sb.y)
          setLine(refs.lineCore, sa.x, sa.y, sb.x, sb.y)
          setCircle(refs.dotAHalo, sa.x, sa.y)
          setCircle(refs.dotACore, sa.x, sa.y)
          setCircle(refs.dotBHalo, sb.x, sb.y)
          setCircle(refs.dotBCore, sb.x, sb.y)
          if (refs.labelWrap) {
            const mx = (sa.x + sb.x) * 0.5
            const my = (sa.y + sb.y) * 0.5
            refs.labelWrap.style.transform = `translate(${mx.toFixed(1)}px, ${my.toFixed(1)}px) translate(-50%, -50%)`
            refs.labelWrap.style.opacity = '1'
          }
        }
      }

      // 2. Point A dot (shown whether started on 2D or 3D so split view stays visually linked).
      const { pendingA: currentA, pendingSource: currentSource } = useMeasureStore.getState()
      const sa = currentA ? worldToOverlay(currentA) : null
      if (sa) {
        setCircle(pendingAHaloRef.current, sa.x, sa.y)
        setCircle(pendingACoreRef.current, sa.x, sa.y, NEUTRAL_CORE)
      } else {
        hideEl(pendingAHaloRef.current)
        hideEl(pendingACoreRef.current)
      }

      // 3. Hover cursor, snap ring, and 2D-owned live rubber band.
      const pointer = pointerRef.current
      const dragging = pointer.buttons !== 0
      let inv: DOMMatrix | null = null
      if (pointer.inside && !dragging) {
        try {
          inv = ctm.inverse()
        } catch {
          inv = null
        }
      }

      if (pointer.inside && !dragging && inv) {
        const snappedLocal = findNearestPlanSnap(
          pointer.clientX,
          pointer.clientY,
          ctm,
          snapPointsRef.current,
          endpointsRef.current,
          currentFrame,
        )
        const rawLocal = snappedLocal ?? new DOMPoint(pointer.clientX, pointer.clientY).matrixTransform(inv)
        const rawWorldXZ = floorplanLocalToWorldPoint(rawLocal, currentFrame.position, currentFrame.rotationY)
        const levelY = currentA ? currentA[1] : 0
        let activeWorld: Vec3 = [rawWorldXZ.x, levelY, rawWorldXZ.z]
        let lockedAxis: 'x' | 'z' | null = null
        let showSnap = snappedLocal !== null

        const owning2d = currentA !== null && currentSource === '2d'
        if (owning2d && shiftHeldRef.current) {
          const locked = constrainToDominantXZAxis(currentA, activeWorld)
          activeWorld = locked.point
          lockedAxis = locked.axis
          showSnap = false
        }

        const activeScreen = worldToOverlay(activeWorld)
        const liveStroke = lockedAxis ? AXIS_COLORS[lockedAxis] : NEUTRAL_CORE
        setCircle(cursorHaloRef.current, activeScreen.x, activeScreen.y)
        setCircle(cursorCoreRef.current, activeScreen.x, activeScreen.y, liveStroke)

        if (showSnap) {
          setCircle(snapHaloRef.current, activeScreen.x, activeScreen.y)
          setCircle(snapRingRef.current, activeScreen.x, activeScreen.y)
        } else {
          hideEl(snapHaloRef.current)
          hideEl(snapRingRef.current)
        }

        if (owning2d && sa) {
          setCircle(pendingACoreRef.current, sa.x, sa.y, liveStroke)
          const dist = distanceBetween(currentA, activeWorld)
          if (dist > MIN_MEASURE_DISTANCE) {
            setLine(liveLineHaloRef.current, sa.x, sa.y, activeScreen.x, activeScreen.y)
            setLine(liveLineCoreRef.current, sa.x, sa.y, activeScreen.x, activeScreen.y, liveStroke)
            if (liveLabelWrapRef.current) {
              const mx = (sa.x + activeScreen.x) * 0.5
              const my = (sa.y + activeScreen.y) * 0.5
              liveLabelWrapRef.current.style.transform = `translate(${mx.toFixed(1)}px, ${my.toFixed(1)}px) translate(-50%, -50%)`
              liveLabelWrapRef.current.style.opacity = '1'
            }
            if (liveLabelTextRef.current) {
              liveLabelTextRef.current.textContent = formatMetres(currentA, activeWorld)
            }
            if (liveLabelDotRef.current) {
              if (lockedAxis) {
                liveLabelDotRef.current.style.display = 'inline-block'
                liveLabelDotRef.current.style.backgroundColor = AXIS_COLORS[lockedAxis]
              } else {
                liveLabelDotRef.current.style.display = 'none'
              }
            }
          } else {
            hideEl(liveLineHaloRef.current)
            hideEl(liveLineCoreRef.current)
            if (liveLabelWrapRef.current) liveLabelWrapRef.current.style.opacity = '0'
          }
        } else {
          hideEl(liveLineHaloRef.current)
          hideEl(liveLineCoreRef.current)
          if (liveLabelWrapRef.current) liveLabelWrapRef.current.style.opacity = '0'
        }
      } else {
        hideEl(cursorHaloRef.current)
        hideEl(cursorCoreRef.current)
        hideEl(snapHaloRef.current)
        hideEl(snapRingRef.current)
        hideEl(liveLineHaloRef.current)
        hideEl(liveLineCoreRef.current)
        if (liveLabelWrapRef.current) liveLabelWrapRef.current.style.opacity = '0'
      }
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [planSvg])

  const setMeasurementRef = <K extends keyof MeasurementDomRefs>(
    id: string,
    key: K,
    el: MeasurementDomRefs[K],
  ) => {
    let entry = domRefs.current.get(id)
    if (!entry) {
      entry = {
        lineHalo: null,
        lineCore: null,
        dotAHalo: null,
        dotACore: null,
        dotBHalo: null,
        dotBCore: null,
        labelWrap: null,
      }
      domRefs.current.set(id, entry)
    }
    entry[key] = el
    if (
      !entry.lineHalo &&
      !entry.lineCore &&
      !entry.dotAHalo &&
      !entry.dotACore &&
      !entry.dotBHalo &&
      !entry.dotBCore &&
      !entry.labelWrap
    ) {
      domRefs.current.delete(id)
    }
  }

  return (
    <div
      className="pointer-events-none absolute z-[15] overflow-hidden opacity-0"
      data-plan-measure=""
      ref={wrapRef}
    >
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        {/* Completed measurements */}
        {measurements.map((m) => (
          <g key={m.id}>
            <line
              ref={(el) => setMeasurementRef(m.id, 'lineHalo', el)}
              stroke={NEUTRAL_HALO}
              strokeLinecap="round"
              strokeOpacity="0.92"
              strokeWidth="4.8"
              style={{ display: 'none' }}
            />
            <line
              ref={(el) => setMeasurementRef(m.id, 'lineCore', el)}
              stroke={NEUTRAL_CORE}
              strokeLinecap="round"
              strokeWidth="2.2"
              style={{ display: 'none' }}
            />
            <circle
              fill={NEUTRAL_HALO}
              fillOpacity="0.92"
              r="5.6"
              ref={(el) => setMeasurementRef(m.id, 'dotAHalo', el)}
              style={{ display: 'none' }}
            />
            <circle
              fill={NEUTRAL_CORE}
              r="3.6"
              ref={(el) => setMeasurementRef(m.id, 'dotACore', el)}
              style={{ display: 'none' }}
            />
            <circle
              fill={NEUTRAL_HALO}
              fillOpacity="0.92"
              r="5.6"
              ref={(el) => setMeasurementRef(m.id, 'dotBHalo', el)}
              style={{ display: 'none' }}
            />
            <circle
              fill={NEUTRAL_CORE}
              r="3.6"
              ref={(el) => setMeasurementRef(m.id, 'dotBCore', el)}
              style={{ display: 'none' }}
            />
          </g>
        ))}

        {/* In-progress rubber-band line + point A */}
        <line
          ref={liveLineHaloRef}
          stroke={NEUTRAL_HALO}
          strokeLinecap="round"
          strokeOpacity="0.92"
          strokeWidth="4.8"
          style={{ display: 'none' }}
        />
        <line
          ref={liveLineCoreRef}
          stroke={NEUTRAL_CORE}
          strokeLinecap="round"
          strokeWidth="2.2"
          style={{ display: 'none' }}
        />
        <circle
          fill={NEUTRAL_HALO}
          fillOpacity="0.92"
          r="6"
          ref={pendingAHaloRef}
          style={{ display: 'none' }}
        />
        <circle
          fill={NEUTRAL_CORE}
          r="3.8"
          ref={pendingACoreRef}
          style={{ display: 'none' }}
        />

        {/* Hover cursor dot & snap ring */}
        <circle
          fill="none"
          r="9.5"
          ref={snapHaloRef}
          stroke={NEUTRAL_HALO}
          strokeOpacity="0.92"
          strokeWidth="4.4"
          style={{ display: 'none' }}
        />
        <circle
          fill="none"
          r="9.5"
          ref={snapRingRef}
          stroke={SNAP_RING_COLOR}
          strokeWidth="2"
          style={{ display: 'none' }}
        />
        <circle
          fill={NEUTRAL_HALO}
          fillOpacity="0.92"
          r="5.2"
          ref={cursorHaloRef}
          style={{ display: 'none' }}
        />
        <circle
          fill={NEUTRAL_CORE}
          r="3.3"
          ref={cursorCoreRef}
          style={{ display: 'none' }}
        />
      </svg>

      {/* Finished measurement labels */}
      {measurements.map((m) => (
        <div
          className="pointer-events-none absolute top-0 left-0 will-change-transform"
          key={m.id}
          ref={(el) => setMeasurementRef(m.id, 'labelWrap', el)}
          style={{ opacity: 0 }}
        >
          <div
            className="ui-glass pointer-events-none relative inline-flex items-center gap-1 rounded-full py-1 pr-1 pl-2.5 text-foreground shadow-sm select-none"
            data-measure-label=""
          >
            <span className="whitespace-nowrap font-mono font-medium text-[11px] leading-none tabular-nums">
              {formatMetres(m.a, m.b)}
            </span>
            <button
              aria-label="Delete measurement"
              className="pointer-events-auto grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
              onClick={(event) => {
                event.stopPropagation()
                playOrbTap('close')
                removeMeasurement(m.id)
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              type="button"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      ))}

      {/* Live 2D rubber-band distance label */}
      {pendingA && pendingSource === '2d' ? (
        <div
          className="pointer-events-none absolute top-0 left-0 will-change-transform"
          ref={liveLabelWrapRef}
          style={{ opacity: 0 }}
        >
          <div className="ui-glass pointer-events-none relative inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-foreground shadow-sm select-none">
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
        </div>
      ) : null}
    </div>
  )
}

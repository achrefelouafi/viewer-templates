import { type AnyNode, worldToFloorplanLocalPoint } from '@pascal-app/core'
import { useViewer, type WalkthroughMovement } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useId, useRef } from 'react'
import { PerspectiveCamera, Vector3 } from 'three'

/**
 * "You are here" on the 2D plan during a walkthrough or a drone flight in split view: a dot at
 * the camera with a fading field-of-view cone and a short fading trail of where you've been.
 *
 * `PlanPovTracker` lives inside the 3D `<Viewer>` and writes the camera pose every frame;
 * `PlanPovOverlay` sits over the viewer and pins the marker onto the plan's SVG through its
 * scene group's screen matrix, so it follows the plan's pan, zoom and rotation for free.
 */

/** Camera pose shared from the render loop to the overlays (plan and walk mini map) without React renders. */
export const pov = { ready: false, x: 0, y: 0, z: 0, fx: 0, fz: -1, hfov: Math.PI / 2 }

export function PlanPovTracker() {
  const position = useRef(new Vector3())
  const direction = useRef(new Vector3())
  useEffect(() => () => {
    pov.ready = false
  }, [])
  useFrame(({ camera, size }) => {
    camera.getWorldPosition(position.current)
    camera.getWorldDirection(direction.current)
    pov.x = position.current.x
    pov.y = position.current.y
    pov.z = position.current.z
    // Looking straight down (a drone overhead) has no heading; keep the last one.
    const flat = Math.hypot(direction.current.x, direction.current.z)
    if (flat > 0.02) {
      pov.fx = direction.current.x / flat
      pov.fz = direction.current.z / flat
    }
    if (camera instanceof PerspectiveCamera) {
      const aspect = size.width / Math.max(size.height, 1)
      pov.hfov = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * aspect)
    }
    pov.ready = true
  })
  return null
}

const TRAIL_POINTS = 36
/** Metres moved before the trail drops another breadcrumb. */
const TRAIL_STEP = 0.45

/** A pie slice at the origin pointing along +x, `radius` long and `angle` wide. */
function conePath(radius: number, angle: number) {
  const half = Math.min(angle, Math.PI * 0.95) / 2
  const x = radius * Math.cos(half)
  const y = radius * Math.sin(half)
  return `M 0 0 L ${x} ${-y} A ${radius} ${radius} 0 0 1 ${x} ${y} Z`
}

export function PlanPovOverlay({ nodes, movement }: { nodes: Record<string, AnyNode>; movement: WalkthroughMovement }) {
  const gradientId = `plan-pov-${useId().replaceAll(':', '')}`
  const wrapRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<SVGGElement>(null)
  const headingRef = useRef<SVGGElement>(null)
  const coneRef = useRef<SVGPathElement>(null)
  const gradientRef = useRef<SVGRadialGradientElement>(null)
  const trailRef = useRef<SVGGElement>(null)
  const altitudeRef = useRef<SVGTextElement>(null)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  useEffect(() => {
    const trail: { x: number; y: number }[] = []
    let lastLevel: string | null = null
    let lastCone = ''
    let frame = 0

    const tick = () => {
      frame = requestAnimationFrame(tick)
      const wrap = wrapRef.current
      const svg = document.querySelector<SVGSVGElement>('svg[data-floorplan-preview]')
      const scene = svg?.querySelector<SVGGElement>(':scope > g')
      const ctm = scene?.getScreenCTM()
      const host = wrap?.parentElement
      if (!wrap || !svg || !ctm || !host || !pov.ready) {
        if (wrap) wrap.style.opacity = '0'
        return
      }

      // Cover exactly the plan pane, clipped to it.
      const rect = svg.getBoundingClientRect()
      const hostRect = host.getBoundingClientRect()
      wrap.style.left = `${rect.left - hostRect.left}px`
      wrap.style.top = `${rect.top - hostRect.top}px`
      wrap.style.width = `${rect.width}px`
      wrap.style.height = `${rect.height}px`
      wrap.style.opacity = '1'

      // World → the plan's building-local metres, as the plan draws the selected level.
      const levelId = useViewer.getState().selection.levelId
      const level = levelId ? nodesRef.current[levelId] : undefined
      const building = level?.parentId ? nodesRef.current[level.parentId] : undefined
      const buildingPosition = building?.type === 'building' ? building.position : ([0, 0, 0] as const)
      const buildingRotation = building?.type === 'building' ? building.rotation[1] : 0
      if (levelId !== lastLevel) {
        trail.length = 0
        lastLevel = levelId
      }
      const here = worldToFloorplanLocalPoint(pov.x, pov.z, buildingPosition, buildingRotation)
      const ahead = worldToFloorplanLocalPoint(pov.x + pov.fx, pov.z + pov.fz, buildingPosition, buildingRotation)

      const toScreen = (p: { x: number; y: number }) => {
        const s = new DOMPoint(p.x, p.y).matrixTransform(ctm)
        return { x: s.x - rect.left, y: s.y - rect.top }
      }
      const screen = toScreen(here)
      const screenAhead = toScreen(ahead)
      const heading = (Math.atan2(screenAhead.y - screen.y, screenAhead.x - screen.x) * 180) / Math.PI
      const pixelsPerMetre = Math.hypot(ctm.a, ctm.b)

      markerRef.current?.setAttribute('transform', `translate(${screen.x} ${screen.y})`)
      headingRef.current?.setAttribute('transform', `rotate(${heading})`)

      // About six metres of view, kept readable however far the plan is zoomed.
      const radius = Math.round(Math.min(170, Math.max(78, pixelsPerMetre * 6)))
      const cone = conePath(radius, pov.hfov)
      if (cone !== lastCone) {
        coneRef.current?.setAttribute('d', cone)
        gradientRef.current?.setAttribute('r', String(radius))
        lastCone = cone
      }

      if (altitudeRef.current) {
        const floor = level?.type === 'level' ? (level.level ?? 0) : 0
        altitudeRef.current.textContent = `${Math.max(0, pov.y).toFixed(1)} m${floor > 0 ? ` · L${floor}` : ''}`
      }

      // Breadcrumbs in plan metres, so they stay put while the plan pans and zooms.
      const last = trail[trail.length - 1]
      if (!last || Math.hypot(here.x - last.x, here.y - last.y) > TRAIL_STEP) {
        trail.push(here)
        if (trail.length > TRAIL_POINTS) trail.shift()
      }
      const dots = trailRef.current?.children
      if (dots) {
        for (let i = 0; i < dots.length; i++) {
          const dot = dots[i] as SVGCircleElement
          const point = trail[trail.length - 2 - i]
          if (!point) {
            dot.setAttribute('opacity', '0')
            continue
          }
          const s = toScreen(point)
          const fade = 1 - i / TRAIL_POINTS
          dot.setAttribute('cx', s.x.toFixed(1))
          dot.setAttribute('cy', s.y.toFixed(1))
          dot.setAttribute('r', (1.2 + fade * 1.8).toFixed(2))
          dot.setAttribute('opacity', (fade * fade * 0.7).toFixed(3))
        }
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  const drone = movement === 'drone'
  return (
    <div
      aria-hidden="true"
      className="plan-pov pointer-events-none absolute z-20 overflow-hidden opacity-0"
      data-movement={movement}
      ref={wrapRef}
    >
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <radialGradient cx="0" cy="0" gradientUnits="userSpaceOnUse" id={gradientId} r="120" ref={gradientRef}>
            <stop offset="0" style={{ stopColor: 'var(--pov)', stopOpacity: 0.5 }} />
            <stop offset="0.55" style={{ stopColor: 'var(--pov)', stopOpacity: 0.16 }} />
            <stop offset="1" style={{ stopColor: 'var(--pov)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>

        <g ref={trailRef}>
          {Array.from({ length: TRAIL_POINTS - 1 }, (_, i) => (
            <circle key={i} opacity="0" r="2" style={{ fill: 'var(--pov)' }} />
          ))}
        </g>

        <g ref={markerRef}>
          <g className="plan-pov-heading" ref={headingRef}>
            <path fill={`url(#${gradientId})`} ref={coneRef} />
          </g>
          <circle className="plan-pov-halo" r="14" />
          {drone && <circle className="plan-pov-orbit" r="17" />}
          <circle className="plan-pov-dot" r="7" />
          <circle className="plan-pov-core" r="2.6" />
          {drone && (
            <text className="plan-pov-altitude" ref={altitudeRef} x="0" y="34" />
          )}
        </g>
      </svg>
    </div>
  )
}

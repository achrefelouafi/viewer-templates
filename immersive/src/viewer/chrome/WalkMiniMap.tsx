import {
  type AnyNode,
  getLevelDisplayName,
  getLevelElevations,
  pointInPolygon2D,
  usePascalI18n,
  worldToFloorplanLocalPoint,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import type { ViewerSource } from '@pascal-app/viewer/ui'
import { useFrame, useThree } from '@react-three/fiber'
import { type PointerEvent as ReactPointerEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { playOrbTap } from './orbSounds'
import { buildLevelPlan, type PlanRoomShape } from './planGeometry'
import { pov } from './PlanPov'

/**
 * Walkthrough mini map (bottom right, 3D view only): the floor you are on, the room you are in,
 * a "you are here" dot with its view cone and a short trail. Clicking a room teleports the
 * walker there, through a quick blink. The pose comes from `PlanPovTracker`; the move is made by
 * `WalkTeleporter`, which lives inside the 3D `<Viewer>` next to the walkthrough controller.
 */

type Point = readonly [number, number]

/** A teleport waiting for the next frame, in world metres. */
const teleport: { pending: { x: number; z: number } | null } = { pending: null }

/** The walkthrough's character body: `BVHEcctrl` names its model group, the body is its parent. */
const CHARACTER_MODEL = 'BVHEcctrl-Model'
/** Dropped a little above the current float height, so the controller settles onto the floor. */
const TELEPORT_LIFT = 0.12

export function WalkTeleporter() {
  const scene = useThree((state) => state.scene)
  useFrame(() => {
    const target = teleport.pending
    if (!target) return
    teleport.pending = null
    const body = scene.getObjectByName(CHARACTER_MODEL)?.parent
    if (!body) return
    // Same floor: keep the body's height, so it lands on the floor it is walking on.
    body.position.set(target.x, body.position.y + TELEPORT_LIFT, target.z)
  })
  useEffect(() => () => {
    teleport.pending = null
  }, [])
  return null
}

type Frame = { bx: number; by: number; bz: number; rot: number }

function buildingFrame(nodes: Record<string, AnyNode>, levelId: string | null): Frame {
  const level = levelId ? nodes[levelId] : undefined
  const building = level?.parentId ? nodes[level.parentId] : undefined
  if (building?.type !== 'building') return { bx: 0, by: 0, bz: 0, rot: 0 }
  return { bx: building.position[0], by: building.position[1], bz: building.position[2], rot: building.rotation[1] }
}

/** The level whose storey holds the eye, like the walkthrough HUD works out its floor label. */
function levelAtEye(nodes: Record<string, AnyNode>, eyeY: number): string | null {
  const elevations = getLevelElevations(nodes as Parameters<typeof getLevelElevations>[0])
  let found: { id: string; baseY: number } | null = null
  for (const [id, elevation] of elevations) {
    const building = elevation.buildingId ? nodes[elevation.buildingId] : undefined
    const localY = eyeY - (building?.type === 'building' ? building.position[1] : 0)
    if (localY >= elevation.baseY - 0.5 && localY < elevation.baseY + elevation.height + 0.5) {
      if (!found || elevation.baseY > found.baseY) found = { id, baseY: elevation.baseY }
    }
  }
  return found?.id ?? null
}

function roomAt(rooms: PlanRoomShape[], x: number, z: number): PlanRoomShape | null {
  const point: [number, number] = [x, z]
  const ring = (points: readonly Point[]) => points.map(([px, pz]) => [px, pz] as [number, number])
  for (const room of rooms) {
    if (!pointInPolygon2D(point, ring(room.polygon))) continue
    if (room.holes.some((hole) => hole.length >= 3 && pointInPolygon2D(point, ring(hole)))) continue
    return room
  }
  return null
}

function usePointerLocked() {
  const [locked, setLocked] = useState(() => document.pointerLockElement !== null)
  useEffect(() => {
    const sync = () => setLocked(document.pointerLockElement !== null)
    document.addEventListener('pointerlockchange', sync)
    return () => document.removeEventListener('pointerlockchange', sync)
  }, [])
  return locked
}

const MAP_WIDTH = 216
const TRAIL_POINTS = 24
const TRAIL_STEP = 0.4
const BLINK_MS = 140

export function WalkMiniMap({ source }: { source: ViewerSource }) {
  const i18n = usePascalI18n()
  const nodes = source.nodes as Record<string, AnyNode>
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const fallbackLevel = useViewer((s) => s.selection.levelId)
  const [levelId, setLevelId] = useState<string | null>(
    () => (pov.ready ? levelAtEye(nodes, pov.y) : null) ?? fallbackLevel,
  )
  const [roomId, setRoomId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const locked = usePointerLocked()
  const gradientId = `walk-map-${useId().replaceAll(':', '')}`

  const svgRef = useRef<SVGSVGElement>(null)
  const markerRef = useRef<SVGGElement>(null)
  const headingRef = useRef<SVGGElement>(null)
  const trailRef = useRef<SVGGElement>(null)
  const aimRef = useRef<SVGGElement>(null)
  const blinkRef = useRef<HTMLDivElement>(null)

  const plan = useMemo(
    () => (levelId ? buildLevelPlan(levelId, nodes, i18n, MAP_WIDTH) : null),
    [levelId, nodes, i18n],
  )
  const planRef = useRef(plan)
  planRef.current = plan
  const levelRef = useRef(levelId)
  levelRef.current = levelId

  // Follow the walker: floor, room, dot, heading and trail, every frame without React renders.
  useEffect(() => {
    const trail: { x: number; y: number }[] = []
    let lastLevel: string | null = null
    let lastRoom: string | null = null
    let frame = 0
    let count = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      if (!pov.ready) return
      count++
      if (count % 12 === 1 || !levelRef.current) {
        const next = levelAtEye(nodesRef.current, pov.y) ?? useViewer.getState().selection.levelId
        if (next && next !== levelRef.current) setLevelId(next)
      }
      const current = planRef.current
      const levelIdNow = levelRef.current
      if (!current?.frame || !levelIdNow) return
      if (levelIdNow !== lastLevel) {
        trail.length = 0
        lastLevel = levelIdNow
      }
      const { bx, bz, rot } = buildingFrame(nodesRef.current, levelIdNow)
      const here = worldToFloorplanLocalPoint(pov.x, pov.z, [bx, 0, bz], rot)
      const ahead = worldToFloorplanLocalPoint(pov.x + pov.fx, pov.z + pov.fz, [bx, 0, bz], rot)
      const f = current.frame
      const toSvg = (p: { x: number; y: number }) => ({
        x: f.offsetX + (p.x - f.minX) * f.scale,
        y: f.offsetY + (p.y - f.minZ) * f.scale,
      })
      const s = toSvg(here)
      const heading = (Math.atan2(ahead.y - here.y, ahead.x - here.x) * 180) / Math.PI
      markerRef.current?.setAttribute('transform', `translate(${s.x.toFixed(2)} ${s.y.toFixed(2)})`)
      headingRef.current?.setAttribute('transform', `rotate(${heading.toFixed(1)})`)

      if (count % 6 === 1) {
        const room = roomAt(current.rooms, here.x, here.y)?.id ?? null
        if (room !== lastRoom) {
          lastRoom = room
          setRoomId(room)
        }
      }

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
          const p = toSvg(point)
          const fade = 1 - i / TRAIL_POINTS
          dot.setAttribute('cx', p.x.toFixed(1))
          dot.setAttribute('cy', p.y.toFixed(1))
          dot.setAttribute('opacity', (fade * fade * 0.6).toFixed(3))
        }
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  /** Client pointer → plan metres (building-local), and the room under it. */
  const pick = (event: ReactPointerEvent | React.MouseEvent) => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    const f = plan?.frame
    if (!svg || !ctm || !f || !plan) return null
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse())
    const x = (p.x - f.offsetX) / f.scale + f.minX
    const z = (p.y - f.offsetY) / f.scale + f.minZ
    const room = roomAt(plan.rooms, x, z)
    return room ? { x, z, svgX: p.x, svgY: p.y, room } : null
  }

  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const hit = pick(event)
    setHoverId(hit?.room.id ?? null)
    const aim = aimRef.current
    if (!aim) return
    if (hit) {
      aim.setAttribute('transform', `translate(${hit.svgX.toFixed(1)} ${hit.svgY.toFixed(1)})`)
      aim.style.opacity = '1'
    } else {
      aim.style.opacity = '0'
    }
  }

  const onLeave = () => {
    setHoverId(null)
    if (aimRef.current) aimRef.current.style.opacity = '0'
  }

  const onClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const hit = pick(event)
    if (!hit || !levelId) return
    const { bx, bz, rot } = buildingFrame(nodes, levelId)
    // Building-local plan metres → world, the inverse of `worldToFloorplanLocalPoint`.
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    const target = { x: bx + hit.x * cos + hit.z * sin, z: bz - hit.x * sin + hit.z * cos }
    playOrbTap('press')
    const blink = blinkRef.current
    if (blink) blink.dataset.on = 'true'
    window.setTimeout(() => {
      teleport.pending = target
      window.setTimeout(() => {
        if (blink) delete blink.dataset.on
      }, 40)
    }, BLINK_MS)
  }

  const level = levelId ? nodes[levelId] : undefined
  const floorLabel = level?.type === 'level' ? getLevelDisplayName(level) : null
  const roomLabel = plan?.rooms.find((room) => room.id === roomId)?.label ?? null
  const hoverLabel = plan?.rooms.find((room) => room.id === hoverId)?.label ?? null
  const interactive = !locked

  if (!plan || plan.rooms.length === 0) return null

  return (
    <>
      <div aria-hidden="true" className="walk-blink pointer-events-none fixed inset-0 z-40" ref={blinkRef} />
      <section
        aria-label="Mini map"
        className="walk-minimap ui-glass pointer-events-auto absolute right-4 bottom-4 z-30 flex flex-col gap-2 rounded-[18px] p-2.5 text-foreground"
        data-interactive={interactive || undefined}
        style={{ width: MAP_WIDTH + 20 }}
      >
        <header className="flex items-baseline justify-between gap-2 px-1">
          <span className="ui-eyebrow ui-eyebrow-rule truncate">{floorLabel ?? 'Floor'}</span>
          <span className="truncate font-medium text-[12px] text-foreground/90">{hoverLabel ?? roomLabel ?? '—'}</span>
        </header>

        <div
          className="ui-drafting-plate relative overflow-hidden rounded-[12px] border border-foreground/10"
          style={{ aspectRatio: `${plan.width} / ${plan.height}` }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1.5 right-2 flex items-center gap-0.5 font-mono text-[8px] text-muted-foreground/70 tracking-[0.14em]"
          >
            <span className="inline-block h-1.5 w-px bg-current" />
            <span>N</span>
          </span>
          <svg
            aria-label={interactive ? 'Click a room to go there' : 'Floor plan'}
            className="block h-full w-full select-none"
            onClick={interactive ? onClick : undefined}
            onPointerLeave={onLeave}
            onPointerMove={interactive ? onMove : undefined}
            ref={svgRef}
            role="img"
            viewBox={`0 0 ${plan.width} ${plan.height}`}
          >
            <defs>
              <radialGradient cx="0" cy="0" gradientUnits="userSpaceOnUse" id={gradientId} r="34">
                <stop offset="0" style={{ stopColor: 'var(--pov)', stopOpacity: 0.55 }} />
                <stop offset="0.6" style={{ stopColor: 'var(--pov)', stopOpacity: 0.14 }} />
                <stop offset="1" style={{ stopColor: 'var(--pov)', stopOpacity: 0 }} />
              </radialGradient>
            </defs>

            {plan.rooms.map((room) => {
              const here = room.id === roomId
              const hovered = interactive && room.id === hoverId
              return (
                <g className={interactive ? 'cursor-crosshair' : undefined} key={room.id}>
                  <path
                    className="transition-[fill-opacity] duration-200"
                    d={room.path}
                    fill={room.color}
                    fillOpacity={hovered ? 0.42 : here ? 0.3 : 0.1}
                    fillRule="evenodd"
                  />
                  <path
                    d={room.path}
                    fill="none"
                    fillRule="evenodd"
                    stroke={here || hovered ? room.color : 'currentColor'}
                    strokeLinejoin="round"
                    strokeOpacity={here || hovered ? 0.95 : 0.42}
                    strokeWidth={here || hovered ? 1.4 : 1}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )
            })}

            <g className="walk-minimap-pov pointer-events-none">
              <g ref={trailRef}>
                {Array.from({ length: TRAIL_POINTS - 1 }, (_, i) => (
                  <circle key={i} opacity="0" r="1.4" style={{ fill: 'var(--pov)' }} />
                ))}
              </g>
              <g ref={markerRef}>
                <g ref={headingRef}>
                  <path d="M 0 0 L 30.6 -17.7 A 35 35 0 0 1 30.6 17.7 Z" fill={`url(#${gradientId})`} />
                </g>
                <circle className="walk-minimap-halo" r="8" />
                <circle className="plan-pov-dot" r="4.5" />
                <circle className="plan-pov-core" r="1.7" />
              </g>
              <g className="walk-minimap-aim" ref={aimRef} style={{ opacity: 0 }}>
                <circle r="6" />
                <circle r="1.5" />
              </g>
            </g>
          </svg>
        </div>

        <p className="px-1 font-mono text-[9.5px] text-muted-foreground leading-tight">
          {interactive ? (
            'Click a room to go there'
          ) : (
            <>
              Press <kbd className="ui-kbd-tip">P</kbd> to free the cursor and pick a room
            </>
          )}
        </p>
      </section>
    </>
  )
}

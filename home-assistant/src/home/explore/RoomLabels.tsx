import { useViewer } from '@pascal-app/viewer'
import type { ViewerSource } from '@pascal-app/viewer/ui'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useRoomHover } from './roomHover'

/** How high over its floor a room's dot sits, in metres. */
const DOT_Y = 0.05
/** How tall the walls are taken to be when finding the plan's top on screen, in metres. */
const WALL_Y = 2.7
/** Room between the plan's top and the labels' row, between two labels, and from the screen's edges, in pixels. */
const LIFT = 36
const GAP = 8
const EDGE = 12
/** The labels' row never goes higher than this, under the header, in pixels. */
const TOP_MIN = 72

type ZoneNode = { id: string; type: string; name?: string; parentId?: string | null; polygon?: [number, number][] | { points?: [number, number][] } }
type Room = { id: string; name: string; centre: [number, number]; polygon: [number, number][] }

/** The middle of a room's outline, in its level's own frame. */
function centreOf(polygon: [number, number][]): [number, number] {
  let area = 0
  let x = 0
  let z = 0
  polygon.forEach(([x1, z1], i) => {
    const [x2, z2] = polygon[(i + 1) % polygon.length]!
    const cross = x1 * z2 - x2 * z1
    area += cross
    x += (x1 + x2) * cross
    z += (z1 + z2) * cross
  })
  if (Math.abs(area) < 1e-6) {
    const n = polygon.length
    return [polygon.reduce((s, p) => s + p[0], 0) / n, polygon.reduce((s, p) => s + p[1], 0) / n]
  }
  return [x / (3 * area), z / (3 * area)]
}

function hide(...elements: (HTMLElement | SVGElement | undefined)[]) {
  for (const el of elements) if (el) el.style.visibility = 'hidden'
}

/** Where the labels' overlay sits: the canvas's top left corner, whatever the camera does. */
const TOP_LEFT = (): [number, number] => [0, 0]

/**
 * Inside the viewer's canvas: the name of each room of the floor shown, in a row above the plan so
 * it never hides it, with a straight vertical line down to a dot in the middle of its room. A label
 * that would overlap another goes up a row instead of aside, so every line stays vertical. A label picks its room as
 * the explore panel's list does, and lights up while it or the room's row in the panel is pointed
 * at (`useRoomHover`).
 */
export function RoomLabels({ source, roomId, onPick }: { source: ViewerSource; roomId: string | null; onPick: (zoneId: string) => void }) {
  const levelId = useViewer((s) => s.selection.levelId)
  const size = useThree((s) => s.size)
  const rooms = useMemo<Room[]>(() => {
    if (!levelId) return []
    return Object.values(source.nodes as unknown as Record<string, ZoneNode | undefined>).flatMap((n) => {
      if (n?.type !== 'zone' || n.parentId !== levelId || !n.name) return []
      const polygon = Array.isArray(n.polygon) ? n.polygon : (n.polygon?.points ?? [])
      return polygon.length < 3 ? [] : [{ id: n.id, name: n.name, centre: centreOf(polygon), polygon }]
    })
  }, [levelId, source.nodes])

  const pills = useRef(new Map<string, HTMLButtonElement>())
  const lines = useRef(new Map<string, SVGLineElement>())
  const dots = useRef(new Map<string, SVGCircleElement>())
  const scratch = useMemo(() => ({ v: new THREE.Vector3() }), [])

  useFrame(({ camera }) => {
    const level = levelId ? source.objectFor(levelId) : undefined
    if (!level) return
    const { v } = scratch
    const { width, height } = size
    const toScreen = (x: number, y: number, z: number) => {
      v.set(x, y, z).applyMatrix4(level.matrixWorld).project(camera)
      return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height, front: v.z < 1 }
    }
    // the plan's top on screen: the highest of its rooms' corners at the top of their walls
    let top = Number.POSITIVE_INFINITY
    for (const room of rooms) for (const [x, z] of room.polygon) top = Math.min(top, toScreen(x, WALL_Y, z).y)
    // a room whose middle is off the screen (behind the camera, or zoomed past) has no label
    const onScreen = (d: { x: number; y: number; front: boolean }) => d.front && d.x >= 0 && d.x <= width && d.y >= 0 && d.y <= height
    const laid = rooms.flatMap((room) => {
      const pill = pills.current.get(room.id)
      if (!pill) return []
      const dot = toScreen(room.centre[0], DOT_Y, room.centre[1])
      if (!onScreen(dot)) {
        hide(pill, lines.current.get(room.id), dots.current.get(room.id))
        return []
      }
      return [{ room, pill, dot, width: pill.offsetWidth, height: pill.offsetHeight, x: dot.x, y: 0 }]
    })
    if (!laid.length) return
    const pillHeight = Math.max(...laid.map((l) => l.height))
    // Each label straight above its dot (kept inside the screen), in the lowest row where it overlaps
    // no other; the first row just above the plan, the others above it.
    laid.sort((a, b) => a.dot.x - b.dot.x)
    const ends: number[] = []
    const row = laid.map((l) => {
      // a pill may slide aside as long as its line still meets it, a little in from its end
      const slide = Math.max(0, l.width / 2 - 14)
      const inside = (x: number) => Math.min(Math.max(x, EDGE + l.width / 2), width - EDGE - l.width / 2)
      const lo = inside(l.dot.x - slide)
      const hi = inside(l.dot.x + slide)
      let r = ends.findIndex((end) => end + GAP + l.width / 2 <= hi)
      if (r < 0) r = ends.length
      const free = r < ends.length ? ends[r]! + GAP + l.width / 2 : lo
      l.x = Math.min(hi, Math.max(lo, inside(l.dot.x), free))
      ends[r] = l.x + l.width / 2
      return r
    })
    const step = pillHeight + GAP
    const lowest = Math.max(TOP_MIN + (ends.length - 1) * step, top - LIFT - pillHeight)
    laid.forEach((l, i) => {
      l.y = lowest - row[i]! * step
    })
    for (const l of laid) {
      l.pill.style.transform = `translate(${l.x - l.width / 2}px, ${l.y}px)`
      l.pill.style.visibility = 'visible'
      const line = lines.current.get(l.room.id)
      const dot = dots.current.get(l.room.id)
      if (line) {
        line.setAttribute('x1', String(l.dot.x))
        line.setAttribute('y1', String(l.y + l.height))
        line.setAttribute('x2', String(l.dot.x))
        line.setAttribute('y2', String(l.dot.y))
        line.style.visibility = 'visible'
      }
      if (dot) {
        dot.setAttribute('cx', String(l.dot.x))
        dot.setAttribute('cy', String(l.dot.y))
        dot.style.visibility = 'visible'
      }
    }
  })

  if (!levelId || !rooms.length) return null
  return (
    // under the panels and cards (z-20 and up), over the plan
    <Html calculatePosition={TOP_LEFT} zIndexRange={[15, 0]}>
      <div className="pointer-events-none absolute top-0 left-0" style={{ width: size.width, height: size.height }}>
        <svg aria-hidden="true" className="absolute inset-0 overflow-visible text-foreground" height={size.height} width={size.width}>
          {rooms.map((room) => (
            <RoomLead
              dotRef={(el) => (el ? dots.current.set(room.id, el) : dots.current.delete(room.id))}
              key={room.id}
              lineRef={(el) => (el ? lines.current.set(room.id, el) : lines.current.delete(room.id))}
              picked={room.id === roomId}
              roomId={room.id}
            />
          ))}
        </svg>
        {rooms.map((room) => (
          <RoomPill
            key={room.id}
            name={room.name}
            onPick={onPick}
            picked={room.id === roomId}
            pillRef={(el) => (el ? pills.current.set(room.id, el) : pills.current.delete(room.id))}
            roomId={room.id}
          />
        ))}
      </div>
    </Html>
  )
}

function RoomLead({ roomId, picked, lineRef, dotRef }: {
  roomId: string
  picked: boolean
  lineRef: (el: SVGLineElement | null) => void
  dotRef: (el: SVGCircleElement | null) => void
}) {
  const lit = useRoomHover((s) => s.id === roomId) || picked
  return (
    <g className="transition-opacity" opacity={lit ? 0.95 : 0.55}>
      <line ref={lineRef} stroke="currentColor" strokeWidth={lit ? 1.25 : 1} />
      <circle className="fill-background" r={3.5} ref={dotRef} stroke="currentColor" strokeWidth={1.25} />
    </g>
  )
}

function RoomPill({ roomId, name, picked, onPick, pillRef }: {
  roomId: string
  name: string
  picked: boolean
  onPick: (zoneId: string) => void
  pillRef: (el: HTMLButtonElement | null) => void
}) {
  const lit = useRoomHover((s) => s.id === roomId)
  return (
    <button
      aria-pressed={picked}
      className={`pointer-events-auto absolute top-0 left-0 whitespace-nowrap rounded-full border px-4 py-1.5 font-medium text-sm shadow-sm backdrop-blur transition-colors ${
        picked || lit
          ? 'border-foreground bg-foreground text-background'
          : 'border-border/60 bg-background/70 text-foreground hover:bg-background'
      }`}
      onClick={() => onPick(roomId)}
      onPointerEnter={() => useRoomHover.getState().set(roomId)}
      onPointerLeave={() => {
        if (useRoomHover.getState().id === roomId) useRoomHover.getState().set(null)
      }}
      ref={pillRef}
      // placed by the frame loop; hidden until then
      style={{ visibility: 'hidden' }}
      type="button"
    >
      {name}
    </button>
  )
}

import { useViewer } from '@pascal-app/viewer'
import type { ViewerSource } from '@pascal-app/viewer/ui'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useRoomHover } from './roomHover'

/** How high over its floor a room's label sits, in metres. */
const LABEL_Y = 0.3

type ZoneNode = { id: string; type: string; name?: string; parentId?: string | null; polygon?: [number, number][] | { points?: [number, number][] } }

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

/**
 * Inside the viewer's canvas: the name of each room of the floor shown, on the room itself. A
 * label picks its room as the explore panel's list does, and lights up while it or the room's row
 * in the panel is pointed at (`useRoomHover`). Nothing in 3D is highlighted but the label.
 */
export function RoomLabels({ source, roomId, onPick }: { source: ViewerSource; roomId: string | null; onPick: (zoneId: string) => void }) {
  const levelId = useViewer((s) => s.selection.levelId)
  const rooms = useMemo(() => {
    if (!levelId) return []
    return Object.values(source.nodes as unknown as Record<string, ZoneNode | undefined>).flatMap((n) => {
      if (n?.type !== 'zone' || n.parentId !== levelId || !n.name) return []
      const polygon = Array.isArray(n.polygon) ? n.polygon : (n.polygon?.points ?? [])
      return polygon.length < 3 ? [] : [{ id: n.id, name: n.name, centre: centreOf(polygon) }]
    })
  }, [levelId, source.nodes])
  if (!levelId || !rooms.length) return null
  return (
    <>
      {rooms.map((room) => (
        <RoomLabel centre={room.centre} key={room.id} levelId={levelId} name={room.name} onPick={onPick} picked={room.id === roomId} roomId={room.id} source={source} />
      ))}
    </>
  )
}

function RoomLabel({ roomId, name, centre, levelId, source, picked, onPick }: {
  roomId: string
  name: string
  centre: [number, number]
  levelId: string
  source: ViewerSource
  picked: boolean
  onPick: (zoneId: string) => void
}) {
  const group = useRef<THREE.Group>(null)
  const at = useMemo(() => new THREE.Vector3(), [])
  const lit = useRoomHover((s) => s.id === roomId)
  // follows its level as the viewer moves floors apart or back
  useFrame(() => {
    const level = source.objectFor(levelId)
    if (!group.current || !level) return
    at.set(centre[0], LABEL_Y, centre[1]).applyMatrix4(level.matrixWorld)
    group.current.position.copy(at)
  })
  return (
    <group ref={group}>
      {/* under the panels and cards (z-20 and up), over the plan */}
      <Html center zIndexRange={[15, 0]}>
        <button
          aria-pressed={picked}
          className={`pointer-events-auto whitespace-nowrap rounded-full border px-3 py-1 font-medium text-xs shadow-sm backdrop-blur transition-colors ${
            picked || lit
              ? 'border-foreground bg-foreground text-background'
              : 'border-border/60 bg-background/80 text-foreground hover:bg-background'
          }`}
          onClick={() => onPick(roomId)}
          onPointerEnter={() => useRoomHover.getState().set(roomId)}
          onPointerLeave={() => {
            if (useRoomHover.getState().id === roomId) useRoomHover.getState().set(null)
          }}
          type="button"
        >
          {name}
        </button>
      </Html>
    </group>
  )
}

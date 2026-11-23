import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { type Object3D, Vector3 } from 'three'
import type { ScreenPoint } from './measure'
import { roomTags } from './roomTags'

/** How high above a room's floor its tag pins (m): about a table's height, clear of the floor. */
export const TAG_HEIGHT = 0.9

/** Where a renderer keeps a room: its zone object, and its floor surface's world height. */
export type RoomLocation = { object: Object3D; floor: number }

const point = new Vector3()
const across = new Vector3()

/**
 * Places the overlay's room tags: every frame the canvas draws, each tagged room's point goes
 * to screen. `locate` finds a room in this renderer; the point is in its object's own x/z plane,
 * `TAG_HEIGHT` above its floor.
 */
export function RoomTagProjector({ locate }: { locate: (id: string) => RoomLocation | null | undefined }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)

  useEffect(() => roomTags.onSpots(() => invalidate()), [invalidate])

  useFrame(() => {
    const rect = gl.domElement.getBoundingClientRect()
    const next: Record<string, ScreenPoint> = {}
    let pixelsPerMetre = 0
    for (const spot of roomTags.spots) {
      const room = locate(spot.id)
      if (!room) continue
      room.object.updateWorldMatrix(true, false)
      room.object.localToWorld(point.set(spot.point[0], 0, spot.point[1]))
      point.y = room.floor + TAG_HEIGHT
      // A metre across the screen at this tag, for how large rooms look.
      if (!pixelsPerMetre) {
        across.set(1, 0, 0).applyQuaternion(camera.quaternion).add(point).project(camera)
        const start = point.clone().project(camera)
        pixelsPerMetre = Math.hypot(((across.x - start.x) / 2) * rect.width, ((across.y - start.y) / 2) * rect.height)
      }
      point.project(camera)
      const onScreen = Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1
      next[spot.id] = onScreen
        ? { x: rect.left + ((point.x + 1) / 2) * rect.width, y: rect.top + ((1 - point.y) / 2) * rect.height }
        : null
    }
    roomTags.setScreen({ points: next, pixelsPerMetre })
  })

  return null
}

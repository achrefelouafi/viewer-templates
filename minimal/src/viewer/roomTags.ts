import { useSyncExternalStore } from 'react'
import type { ScreenPoint } from './measure'

/** A room the overlay pins a tag on, and where: a point on its floor, in its zone's x/z plane. */
export type TagSpot = { id: string; point: [number, number] }

/** Where the tagged rooms land on screen, and how many CSS pixels a metre spans there. */
export type TagScreen = { points: Record<string, ScreenPoint>; pixelsPerMetre: number }

let spots: TagSpot[] = []
let screen: TagScreen = { points: {}, pixelsPerMetre: 0 }
const spotListeners = new Set<() => void>()
const screenListeners = new Set<() => void>()

/**
 * The room tags pinned on the drawing. The overlay says which rooms (`setSpots`); the canvas
 * (`RoomTagProjector`) writes back where each lands on screen, every frame it draws.
 */
export const roomTags = {
  get spots() {
    return spots
  },
  setSpots(next: TagSpot[]) {
    spots = next
    for (const listener of spotListeners) listener()
  },
  /** Called when the spots change, so an on-demand canvas draws a frame to place them. */
  onSpots(listener: () => void) {
    spotListeners.add(listener)
    return () => {
      spotListeners.delete(listener)
    }
  },
  setScreen(next: TagScreen) {
    const keys = Object.keys(next.points)
    const same =
      Math.abs(next.pixelsPerMetre - screen.pixelsPerMetre) < 0.5 &&
      keys.length === Object.keys(screen.points).length &&
      keys.every((key) => {
        const a = next.points[key] ?? null
        const b = screen.points[key] ?? null
        return a === b || (!!a && !!b && Math.abs(a.x - b.x) < 0.25 && Math.abs(a.y - b.y) < 0.25)
      })
    if (same) return
    screen = next
    for (const listener of screenListeners) listener()
  },
}

const subscribe = (listener: () => void) => {
  screenListeners.add(listener)
  return () => {
    screenListeners.delete(listener)
  }
}

export function useRoomTagScreen(): TagScreen {
  return useSyncExternalStore(subscribe, () => screen)
}

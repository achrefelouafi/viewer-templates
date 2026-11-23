import { useSyncExternalStore } from 'react'
import type { Vector3 } from 'three'

/** A point on screen, in CSS pixels from the viewport's top left; null when behind the camera. */
export type ScreenPoint = { x: number; y: number } | null

export type MeasureState = {
  active: boolean
  /** The picked points, in the world: none, one, or two (a measured distance). */
  points: Vector3[]
  /** Where a click would land now, snapped. */
  preview: Vector3 | null
  /** `points` then `preview` as the canvas last drew them. */
  screen: { points: ScreenPoint[]; preview: ScreenPoint }
}

let state: MeasureState = {
  active: false,
  points: [],
  preview: null,
  screen: { points: [], preview: null },
}
const listeners = new Set<() => void>()

function set(next: Partial<MeasureState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

/**
 * The measure tool's state, shared by the overlay (its strip, rings and readout) and
 * `MeasureTool` inside the canvas, which picks the points and projects them every frame.
 */
export const measure = {
  get state() {
    return state
  },
  setActive(active: boolean) {
    if (active !== state.active) set({ active, points: [], preview: null, screen: { points: [], preview: null } })
  },
  /** A third point starts a new measurement. */
  add(point: Vector3) {
    set({ points: state.points.length >= 2 ? [point] : [...state.points, point] })
  },
  clear() {
    set({ points: [] })
  },
  setPreview(preview: Vector3 | null) {
    if (preview !== state.preview) set({ preview })
  },
  setScreen(screen: MeasureState['screen']) {
    const same =
      screen.points.length === state.screen.points.length &&
      screen.points.every((point, i) => samePoint(point, state.screen.points[i] ?? null)) &&
      samePoint(screen.preview, state.screen.preview)
    if (!same) set({ screen })
  },
}

const samePoint = (a: ScreenPoint, b: ScreenPoint) =>
  a === b || (!!a && !!b && Math.abs(a.x - b.x) < 0.25 && Math.abs(a.y - b.y) < 0.25)

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useMeasure(): MeasureState {
  return useSyncExternalStore(subscribe, () => state)
}

/** The measured distance in metres, once two points are picked. */
export function measuredDistance(points: Vector3[]): number | null {
  return points.length === 2 ? points[0]!.distanceTo(points[1]!) : null
}

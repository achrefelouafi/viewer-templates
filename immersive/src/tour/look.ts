import { create } from 'zustand'

/**
 * Guided tour visual state shared by `useGuidedTour`, `ProjectViewer` and `TourNoir`:
 * - `active`: true while the tour runs (`TourNoir` restyles the 3D scene in-place).
 * - `levelId` / `roomId`: the current stop; `TourNoir` shows that room in colour.
 * - `arrived`: the camera has reached the room, so its colour spreads.
 * - `playing`: the tour moves on by itself, so the camera orbits the room it reached.
 */
type TourLookState = {
  active: boolean
  levelId: string | null
  roomId: string | null
  arrived: boolean
  playing: boolean
  set: (patch: Partial<Pick<TourLookState, 'active' | 'levelId' | 'roomId' | 'arrived' | 'playing'>>) => void
}

export const useTourLook = create<TourLookState>((set) => ({
  active: false,
  levelId: null,
  roomId: null,
  arrived: false,
  playing: false,
  set: (patch) => set(patch),
}))

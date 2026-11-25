import { create } from 'zustand'

export type Vec3 = readonly [number, number, number]
export type AxisLock = 'x' | 'y' | 'z' | null
export type MeasureSource = '3d' | '2d'

export interface Measurement {
  id: string
  a: Vec3
  b: Vec3
}

interface MeasureState {
  active: boolean
  pendingA: Vec3 | null
  /** Which viewport pane started `pendingA`, so only that pane drives its live rubber band. */
  pendingSource: MeasureSource | null
  measurements: Measurement[]
  enter: () => void
  exit: () => void
  toggle: () => void
  setPendingA: (point: Vec3 | null, source?: MeasureSource | null) => void
  commitMeasurement: (b: Vec3) => void
  removeMeasurement: (id: string) => void
  clearMeasurements: () => void
  /** Cancels an in-progress point A if one is placed; returns true when consumed. */
  cancelPending: () => boolean
}

let nextMeasurementId = 1

export const useMeasureStore = create<MeasureState>((set, get) => ({
  active: false,
  pendingA: null,
  pendingSource: null,
  measurements: [],

  enter() {
    if (get().active) return
    set({ active: true, pendingA: null, pendingSource: null })
  },

  exit() {
    const state = get()
    if (!state.active && state.pendingA === null && state.measurements.length === 0) return
    set({ active: false, pendingA: null, pendingSource: null, measurements: [] })
  },

  toggle() {
    if (get().active) get().exit()
    else get().enter()
  },

  setPendingA(point, source = null) {
    set({ pendingA: point, pendingSource: point ? source : null })
  },

  commitMeasurement(b) {
    const { pendingA } = get()
    if (!pendingA) return
    const id = `measure-${nextMeasurementId++}`
    set((state) => ({
      pendingA: null,
      pendingSource: null,
      measurements: [...state.measurements, { id, a: pendingA, b }],
    }))
  },

  removeMeasurement(id) {
    set((state) => ({
      measurements: state.measurements.filter((item) => item.id !== id),
    }))
  },

  clearMeasurements() {
    set({ pendingA: null, pendingSource: null, measurements: [] })
  },

  cancelPending() {
    if (get().pendingA === null) return false
    set({ pendingA: null, pendingSource: null })
    return true
  },
}))

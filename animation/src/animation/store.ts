import { create } from 'zustand'
import type { TemplateId } from './templates'

/**
 * What the Animations tab asks for and what the animator reports back. The animator owns the
 * clock while it plays; the tab only reads `time` and writes requests (play, pause, seek).
 */
export type AnimationStatus = 'idle' | 'playing' | 'paused' | 'finished'

type AnimationState = {
  template: TemplateId
  status: AnimationStatus
  /** Seconds into the timeline, at 1× speed. */
  time: number
  /** Timeline length in seconds, once the animator has planned it. */
  duration: number
  speed: number
  /** The camera orbits and frames the build while it plays. */
  cinematic: boolean
  /** Pieces the build moves (0 until the animator has measured the scene). */
  pieceCount: number
  /** Bumped to ask the animator to restart the timeline from 0. */
  runId: number
  /** A seek the animator should apply on its next frame. */
  seekTo: number | null

  select: (template: TemplateId) => void
  play: () => void
  pause: () => void
  replay: () => void
  stop: () => void
  seek: (time: number) => void
  setSpeed: (speed: number) => void
  setCinematic: (on: boolean) => void
}

export const useAnimationStore = create<AnimationState>((set, get) => ({
  template: 'blueprint',
  status: 'idle',
  time: 0,
  duration: 0,
  speed: 1,
  cinematic: true,
  pieceCount: 0,
  runId: 0,
  seekTo: null,

  select: (template) => set({ template, status: 'playing', time: 0, seekTo: null, runId: get().runId + 1 }),
  play: () => {
    const { status } = get()
    if (status === 'finished' || status === 'idle') {
      set({ status: 'playing', time: 0, seekTo: null, runId: get().runId + 1 })
    } else {
      set({ status: 'playing' })
    }
  },
  pause: () => {
    if (get().status === 'playing') set({ status: 'paused' })
  },
  replay: () => set({ status: 'playing', time: 0, seekTo: null, runId: get().runId + 1 }),
  stop: () => set({ status: 'idle', time: 0, seekTo: null }),
  seek: (time) => {
    const { status, runId } = get()
    // Scrubbing a finished or idle build starts it again, held where the scrubber is.
    if (status === 'idle' || status === 'finished') set({ status: 'paused', runId: runId + 1, seekTo: time, time })
    else set({ seekTo: time, time })
  },
  setSpeed: (speed) => set({ speed }),
  setCinematic: (cinematic) => set({ cinematic }),
}))

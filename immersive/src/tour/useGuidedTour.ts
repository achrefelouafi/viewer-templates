import { useViewer } from '@pascal-app/viewer'
import { frameViewerNode, framingAnimates, selectViewerBuilding, type ViewerSource } from '@pascal-app/viewer/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTourLook } from './look'
import type { TourStop } from './stops'

/** How long the camera glides to a room before marking it reached, how long the tour stays there, and the brief opening slate. */
export const ARRIVE_MS = 1600
export const DWELL_MS = 5600
export const INTRO_MS = 1500

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

type Selection = ReturnType<typeof useViewer.getState>['selection']
export type TourPhase = 'travelling' | 'arrived'

export type GuidedTour = {
  active: boolean
  playing: boolean
  /** Index into `stops`, or -1 when the tour is off. */
  index: number
  phase: TourPhase
  /** True briefly right after starting, so an opening slate can fade out before the first arrival. */
  intro: boolean
  stops: TourStop[]
  /** Rooms reached so far, by zone id. */
  seen: ReadonlySet<string>
  start: () => void
  /** Starts the tour playing directly at a chosen stop index (e.g. "Tour from here"). */
  startAt: (index: number) => void
  stop: () => void
  toggle: () => void
  next: () => void
  previous: () => void
  /** Goes to one room and holds there: the sequence pauses until play is pressed. */
  highlight: (index: number) => void
}

/** Pascal's camera glides to the room on its floor. Only the floor is selected: the tour shows the room in colour, with no room selection, label or outline. */
function travelTo(stop: TourStop, source: ViewerSource) {
  const viewer = useViewer.getState()
  const level = source.nodes[stop.levelId] as { parentId?: string | null } | undefined
  viewer.setSelection({
    buildingId: (level?.parentId ?? null) as Selection['buildingId'],
    levelId: stop.levelId as Selection['levelId'],
    zoneId: null,
    selectedIds: [],
  })
  viewer.setHoveredId(null)
  frameViewerNode(stop.zoneId, source)
}

/**
 * The guided tour: it travels to each room in turn, floor by floor, while `TourNoir` shows that
 * room in colour and the rest as wireframe, stays a moment and moves on, ending
 * after the last room. Any room can be highlighted on its own from the route. The visitor taking
 * the camera pauses it; Exit or Escape ends it and restores the viewer exactly as it was.
 */
export function useGuidedTour(source: ViewerSource, stops: TourStop[]): GuidedTour {
  const [active, setActive] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [index, setIndex] = useState(-1)
  const [phase, setPhase] = useState<TourPhase>('travelling')
  const [intro, setIntro] = useState(false)
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set())
  const live = useRef({ source, stops })
  live.current = { source, stops }

  // Travel to the room; on arrival it counts as seen.
  useEffect(() => {
    if (!active || index < 0) return
    const stop = live.current.stops[index]
    if (!stop) return
    setPhase('travelling')
    useTourLook.getState().set({ levelId: stop.levelId, roomId: stop.zoneId, arrived: false })
    travelTo(stop, live.current.source)
    const arrive = setTimeout(() => {
      setSeen((previous) => (previous.has(stop.zoneId) ? previous : new Set(previous).add(stop.zoneId)))
      useTourLook.getState().set({ arrived: true })
      setPhase('arrived')
    }, framingAnimates() ? ARRIVE_MS : 0)
    return () => clearTimeout(arrive)
  }, [active, index])

  // Step the opening slate out of the way just before the camera settles on the first room.
  useEffect(() => {
    if (!active || !intro) return
    const timer = setTimeout(() => setIntro(false), INTRO_MS)
    return () => clearTimeout(timer)
  }, [active, intro])

  const end = useCallback(() => {
    setActive(false)
    setPlaying(false)
    setIntro(false)
    setIndex(-1)
    useTourLook.getState().set({ active: false, levelId: null, roomId: null, arrived: false, playing: false })
    selectViewerBuilding(live.current.source)
  }, [])

  // Stay a moment, then move on; after the last room the tour ends.
  useEffect(() => {
    if (!active || !playing || phase !== 'arrived') return
    const timer = setTimeout(() => {
      if (index + 1 < live.current.stops.length) setIndex(index + 1)
      else end()
    }, DWELL_MS)
    return () => clearTimeout(timer)
  }, [active, playing, phase, index, end])

  const start = useCallback(() => {
    if (!live.current.stops.length) return
    const viewer = useViewer.getState()
    if (viewer.walkthroughMode) viewer.setWalkthroughMode(false)
    useTourLook.getState().set({ active: true, levelId: null, roomId: null, arrived: false })
    setSeen(new Set())
    setIndex(0)
    setPlaying(true)
    setIntro(framingAnimates() && !prefersReducedMotion())
    setActive(true)
  }, [])
  const startAt = useCallback((stopIndex: number) => {
    const count = live.current.stops.length
    if (!count) return
    const viewer = useViewer.getState()
    if (viewer.walkthroughMode) viewer.setWalkthroughMode(false)
    useTourLook.getState().set({ active: true, levelId: null, roomId: null, arrived: false })
    setSeen(new Set())
    setIndex(Math.max(0, Math.min(count - 1, stopIndex)))
    setPlaying(true)
    setIntro(false)
    setActive(true)
  }, [])
  const highlight = useCallback((next: number) => {
    const count = live.current.stops.length
    if (!count) return
    setIntro(false)
    setPlaying(false)
    setIndex(Math.max(0, Math.min(count - 1, next)))
  }, [])
  const next = useCallback(() => {
    setIntro(false)
    setIndex((value) => Math.min(live.current.stops.length - 1, value + 1))
  }, [])
  const previous = useCallback(() => {
    setIntro(false)
    setIndex((value) => Math.max(0, value - 1))
  }, [])
  const toggle = useCallback(() => {
    setIntro(false)
    setPlaying((value) => !value)
  }, [])

  // Walking or flying takes the camera: the tour ends without a fuss.
  const walking = useViewer((state) => state.walkthroughMode)
  useEffect(() => {
    if (!walking || !active) return
    setActive(false)
    setPlaying(false)
    setIntro(false)
    setIndex(-1)
    useTourLook.getState().set({ active: false, levelId: null, roomId: null, arrived: false, playing: false })
    useViewer.getState().setSelection({ zoneId: null })
  }, [walking, active])

  // The visitor taking the camera (a drag or a wheel on the scene) pauses the sequence.
  useEffect(() => {
    if (!active || !playing) return
    const takeOver = (event: Event) => {
      if ((event.target as Element | null)?.tagName === 'CANVAS') {
        setIntro(false)
        setPlaying(false)
      }
    }
    document.addEventListener('pointerdown', takeOver, true)
    document.addEventListener('wheel', takeOver, { capture: true, passive: true })
    return () => {
      document.removeEventListener('pointerdown', takeOver, true)
      document.removeEventListener('wheel', takeOver, true)
    }
  }, [active, playing])

  // The camera orbits the room while the tour plays (`TourCamera`).
  useEffect(() => {
    useTourLook.getState().set({ playing: active && playing })
  }, [active, playing])

  // Tour shortcuts: Escape exits, Space toggles play/pause, Left/Right step between rooms.
  // Ignored while typing in form inputs; preventDefault on Space keeps a focused button from double-firing.
  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        end()
      } else if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault()
        toggle()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        previous()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        next()
      }
    }
    addEventListener('keydown', onKeyDown)
    return () => removeEventListener('keydown', onKeyDown)
  }, [active, end, toggle, previous, next])

  // Leaving the page mid-tour restores the viewer cleanly.
  useEffect(() => () => useTourLook.getState().set({ active: false, levelId: null, roomId: null, arrived: false, playing: false }), [])

  return { active, playing, index, phase, intro, stops, seen, start, startAt, stop: end, toggle, next, previous, highlight }
}

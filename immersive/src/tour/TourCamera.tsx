import { emitter } from '@pascal-app/core'
import type { CameraControlsImpl } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { useTourLook } from './look'

/** One turn around the room every 36 seconds, easing in over the first second. */
const ORBIT_RAD_PER_S = (Math.PI * 2) / 36
const EASE_IN_S = 1

/**
 * The guided tour's camera, inside `<Viewer>` while the tour runs:
 * - Room to room takes the short way round. Pascal's camera counts every turn the visitor
 *   orbited, so its glide to the next room would unwind them all; the turns are dropped
 *   (`normalizeRotations`) as soon as Pascal starts framing a room.
 * - While the tour plays, the camera slowly orbits the room it reached. Pausing, or taking the
 *   camera (which pauses the tour), stops it.
 */
export function TourCamera() {
  const controls = useThree((state) => state.controls) as CameraControlsImpl | null
  const invalidate = useThree((state) => state.invalidate)
  const orbiting = useRef(0)

  useEffect(() => {
    if (!controls) return
    // After Pascal's own handler has set the new pose.
    const shortWay = () => queueMicrotask(() => controls.normalizeRotations())
    emitter.on('camera-controls:frame', shortWay)
    return () => emitter.off('camera-controls:frame', shortWay)
  }, [controls])

  useFrame((_, delta) => {
    const { playing, arrived } = useTourLook.getState()
    if (!controls || !playing || !arrived) {
      orbiting.current = 0
      return
    }
    orbiting.current += delta
    const ease = Math.min(1, orbiting.current / EASE_IN_S)
    controls.rotate(ORBIT_RAD_PER_S * ease * Math.min(delta, 0.1), 0, false)
    invalidate()
  })

  return null
}

import { advance, useStore, useThree } from '@react-three/fiber'
import { type ReactNode, useEffect, useLayoutEffect } from 'react'
import type { Camera } from 'three'
import { useVrStore } from './store'

interface WebGpuXrLike {
  enabled: boolean
  isPresenting: boolean
  setReferenceSpaceType: (type: XRReferenceSpaceType) => void
  setSession: (session: XRSession | null) => Promise<void>
  getSession: () => XRSession | null
  updateCamera?: (camera: Camera) => void
}

/**
 * Mounted as `<Viewer immersive={{ Session }} />` inside the remounted WebGL-XR Canvas.
 *
 * Bridges R3F v9.8.2 + Three r187's `WebGPURenderer` (forceWebGL) XRManager directly:
 * 1. Disconnects R3F's built-in `sessionstart` listener (which calls `gl.xr.setAnimationLoop`,
 *    absent on `WebGPURenderer`'s `XRManager`).
 * 2. Switches `frameloop` from `<Viewer>`'s `'never'` to `'always'` so pre-session scene build
 *    runs and `clock` ticks (R3F's rAF loop yields automatically once `gl.xr.isPresenting`).
 * 3. Registers our XR animation loop via `gl.setAnimationLoop()` BEFORE `gl.xr.setSession()`
 *    so `XRManager` snapshots it and invokes it on every headset frame.
 * 4. Calls `gl.render(scene, camera)` after `advance()` because `<SceneReadyTracker>` registers
 *    a positive-priority `useFrame(..., 10)` which suppresses R3F's automatic render.
 */
export function VrSessionBridge({ children }: { children: ReactNode }) {
  const gl = useThree((s) => s.gl)
  const r3fXr = useThree((s) => s.xr)
  const setFrameloop = useThree((s) => s.setFrameloop)
  const r3fStore = useStore()
  const session = useVrStore((s) => s.session)

  useLayoutEffect(() => {
    r3fXr?.disconnect()
    setFrameloop('always')
  }, [r3fXr, setFrameloop])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    const xr = gl.xr as unknown as WebGpuXrLike

    const xrLoop = (timestamp: number, frame?: XRFrame) => {
      if (!frame || !xr.isPresenting) return
      const state = r3fStore.getState()
      // Refresh camera pose for the current XR frame before useFrame physics/reticle run.
      xr.updateCamera?.(state.camera)
      advance(timestamp, true, state, frame)
      // SceneReadyTracker holds priority 10, so R3F skips auto-render; submit stereo frame here.
      const latest = r3fStore.getState()
      if (latest.internal.priority > 0) {
        latest.gl.render(latest.scene, latest.camera)
      }
    }

    const bind = async () => {
      try {
        xr.enabled = true
        xr.setReferenceSpaceType('local-floor')
        await gl.setAnimationLoop(xrLoop)
        if (cancelled) return
        await xr.setSession(session)
      } catch (error) {
        if (!cancelled) {
          console.error('[vr] failed to bind XR session', error)
          useVrStore.getState().exitVr()
        }
      }
    }

    void bind()

    return () => {
      cancelled = true
      try {
        void gl.setAnimationLoop(null)
      } catch {
        // Renderer may already be disposing on canvas unmount.
      }
    }
  }, [gl, r3fStore, session])

  return <>{children}</>
}

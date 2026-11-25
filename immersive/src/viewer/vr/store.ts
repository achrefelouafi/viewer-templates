import { useViewer } from '@pascal-app/viewer'
import { create } from 'zustand'

export type VrSupport = 'unknown' | 'supported' | 'unsupported'
export type VrStatus = 'idle' | 'requesting' | 'active'

interface VrState {
  support: VrSupport
  status: VrStatus
  session: XRSession | null
  sessionId: number
  sceneReady: boolean
  colliderReady: boolean
  spawnPlaced: boolean
  probeSupport: () => void
  enterVr: () => void
  exitVr: () => void
  handleSessionEnd: (session: XRSession) => void
  markSceneReady: (sessionId: number) => void
  markColliderReady: (sessionId: number) => void
  markSpawnPlaced: (sessionId: number) => void
}

let probed = false

export const useVrStore = create<VrState>((set, get) => ({
  support: 'unknown',
  status: 'idle',
  session: null,
  sessionId: 0,
  sceneReady: false,
  colliderReady: false,
  spawnPlaced: false,

  probeSupport() {
    if (probed) return
    probed = true
    if (typeof navigator === 'undefined' || !navigator.xr?.isSessionSupported) {
      set({ support: 'unsupported' })
      return
    }
    navigator.xr
      .isSessionSupported('immersive-vr')
      .then((supported) => set({ support: supported ? 'supported' : 'unsupported' }))
      .catch(() => set({ support: 'unsupported' }))
  },

  enterVr() {
    const { status } = get()
    if (status !== 'idle') return
    if (typeof navigator === 'undefined' || !navigator.xr?.requestSession) {
      set({ support: 'unsupported' })
      return
    }

    set({ status: 'requesting' })

    // Must run synchronously inside the button click handler to preserve WebXR user activation.
    let request: Promise<XRSession>
    try {
      request = navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor'],
      })
    } catch {
      set({ status: 'idle' })
      return
    }

    request
      .then((session) => {
        if (get().status !== 'requesting') {
          void session.end().catch(() => {})
          return
        }
        const nextId = get().sessionId + 1
        const onEnd = () => {
          session.removeEventListener('end', onEnd)
          get().handleSessionEnd(session)
        }
        session.addEventListener('end', onEnd)

        const viewer = useViewer.getState()
        viewer.setWalkthroughMovement('walk')
        viewer.setWalkthroughMode(true)

        set({
          status: 'active',
          session,
          sessionId: nextId,
          sceneReady: false,
          colliderReady: false,
          spawnPlaced: false,
        })
      })
      .catch(() => {
        // User cancelled or device rejected the request: stay cleanly on the desktop canvas.
        if (get().status === 'requesting') {
          set({ status: 'idle', session: null })
        }
      })
  },

  exitVr() {
    const { session, status } = get()
    if (status === 'idle' && !session) return
    set({
      status: 'idle',
      session: null,
      sceneReady: false,
      colliderReady: false,
      spawnPlaced: false,
    })
    useViewer.getState().setWalkthroughMode(false)
    if (session) {
      void session.end().catch(() => {})
    }
  },

  handleSessionEnd(session) {
    if (get().session !== session) return
    set({
      status: 'idle',
      session: null,
      sceneReady: false,
      colliderReady: false,
      spawnPlaced: false,
    })
    useViewer.getState().setWalkthroughMode(false)
  },

  markSceneReady(sessionId) {
    if (get().sessionId === sessionId && !get().sceneReady) {
      set({ sceneReady: true })
    }
  },

  markColliderReady(sessionId) {
    if (get().sessionId === sessionId && !get().colliderReady) {
      set({ colliderReady: true })
    }
  },

  markSpawnPlaced(sessionId) {
    if (get().sessionId === sessionId && !get().spawnPlaced) {
      set({ spawnPlaced: true })
    }
  },
}))

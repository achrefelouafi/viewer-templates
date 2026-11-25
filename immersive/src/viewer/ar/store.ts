import type { Scene } from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { create } from 'zustand'
import { type ArScaleMode, buildArModel, type BuiltArModel } from './buildArModel'
import { exportModelToUsdzUrl } from './quickLook'

export type ArPlatform = 'unknown' | 'quicklook' | 'webxr' | 'qr' | 'unsupported'
export type ArUnsupportedReason = 'in-app-browser' | 'unsupported-device' | null
export type ArStatus = 'idle' | 'preparing' | 'active' | 'error'

interface ArXrSessionOptions extends XRSessionInit {
  domOverlay?: { root: Element }
}

interface ArState {
  platform: ArPlatform
  unsupportedReason: ArUnsupportedReason
  status: ArStatus
  progress: number
  error: string | null
  scaleMode: ArScaleMode

  // Scene handle published by ArSceneBridge inside <Viewer>.
  scene: Scene | null
  gl: WebGPURenderer | null
  glbActive: boolean
  sceneIdentity: string | null
  sceneReady: boolean

  // Cached model & Quick Look USDZ blobs for the current sceneIdentity.
  builtKey: string | null
  model: BuiltArModel | null
  usdzUrls: Partial<Record<ArScaleMode, string>>

  // Active Android WebXR session & pre-mounted DOM overlay root.
  xrSession: XRSession | null
  overlayRoot: HTMLDivElement | null

  probeSupport: () => void
  setSceneHandle: (handle: {
    scene: Scene
    gl: WebGPURenderer
    glbActive: boolean
    sceneIdentity: string
    sceneReady: boolean
  }) => void
  clearSceneHandle: (scene: Scene) => void
  setOverlayRoot: (el: HTMLDivElement | null) => void
  setScaleMode: (mode: ArScaleMode) => void
  prepare: () => Promise<void>
  startWebXr: () => void
  exitAr: () => void
  handleSessionEnd: (session: XRSession) => void
  resetForScene: (nextIdentity: string | null) => void
}

const IN_APP_UA =
  /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Twitter|LinkedInApp|Snapchat|TikTok|BytedanceWebview|\bwv\b|GSA\//i
const IOS_UA = /iPhone|iPad|iPod/i
const IOS_NON_SAFARI_UA = /CriOS|FxiOS|EdgiOS|OPiOS/i
const ANDROID_UA = /Android/i

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return IOS_UA.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isInAppOrNonArMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  if (IN_APP_UA.test(ua)) return true
  if (isIosDevice() && IOS_NON_SAFARI_UA.test(ua)) return true
  return false
}

function supportsQuickLook(): boolean {
  if (typeof document === 'undefined') return false
  const anchor = document.createElement('a')
  return Boolean(anchor.relList?.supports?.('ar'))
}

function revokeUsdzCache(urls: Partial<Record<ArScaleMode, string>>) {
  for (const url of Object.values(urls)) {
    if (url) URL.revokeObjectURL(url)
  }
}

let probed = false
let buildSeq = 0
let detachSessionEnd: (() => void) | null = null

export const useArStore = create<ArState>((set, get) => ({
  platform: 'unknown',
  unsupportedReason: null,
  status: 'idle',
  progress: 0,
  error: null,
  scaleMode: 'tabletop',

  scene: null,
  gl: null,
  glbActive: false,
  sceneIdentity: null,
  sceneReady: false,

  builtKey: null,
  model: null,
  usdzUrls: {},

  xrSession: null,
  overlayRoot: null,

  probeSupport() {
    if (probed) return
    probed = true

    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      set({ platform: 'qr', unsupportedReason: null })
      return
    }

    const ua = navigator.userAgent
    const isIos = isIosDevice()
    const isAndroid = ANDROID_UA.test(ua)
    const inApp = isInAppOrNonArMobileBrowser()

    // iOS/iPadOS Safari supports Quick Look via <a rel="ar">.
    // Non-Safari iOS browsers and in-app WebViews cannot reliably launch blob: Quick Look URLs.
    if (isIos) {
      if (inApp) {
        set({ platform: 'unsupported', unsupportedReason: 'in-app-browser' })
        return
      }
      if (supportsQuickLook()) {
        set({ platform: 'quicklook', unsupportedReason: null })
        return
      }
      set({ platform: 'unsupported', unsupportedReason: 'unsupported-device' })
      return
    }

    // Desktop Safari on a Mac also answers `rel="ar"`, but only shows a 3D preview there, so
    // Macs get the QR handoff like any other computer.

    // Android or WebXR-capable browser: check immersive-ar asynchronously.
    if (navigator.xr?.isSessionSupported) {
      navigator.xr
        .isSessionSupported('immersive-ar')
        .then((supported) => {
          if (supported && !inApp) {
            set({ platform: 'webxr', unsupportedReason: null })
          } else if (isAndroid) {
            set({
              platform: 'unsupported',
              unsupportedReason: inApp ? 'in-app-browser' : 'unsupported-device',
            })
          } else {
            set({ platform: 'qr', unsupportedReason: null })
          }
        })
        .catch(() => {
          if (isAndroid) {
            set({
              platform: 'unsupported',
              unsupportedReason: inApp ? 'in-app-browser' : 'unsupported-device',
            })
          } else {
            set({ platform: 'qr', unsupportedReason: null })
          }
        })
      return
    }

    if (isAndroid) {
      set({
        platform: 'unsupported',
        unsupportedReason: inApp ? 'in-app-browser' : 'unsupported-device',
      })
      return
    }

    set({ platform: 'qr', unsupportedReason: null })
  },

  setSceneHandle({ scene, gl, glbActive, sceneIdentity, sceneReady }) {
    set({ scene, gl, glbActive, sceneIdentity, sceneReady })
  },

  clearSceneHandle(scene) {
    if (get().scene === scene) {
      set({ scene: null, gl: null, sceneReady: false })
    }
  },

  setOverlayRoot(el) {
    set({ overlayRoot: el })
  },

  setScaleMode(mode) {
    if (get().scaleMode === mode) return
    set({ scaleMode: mode, error: null })
  },

  async prepare() {
    const state = get()
    if (state.status === 'preparing' || state.status === 'active') return
    if (!state.scene || !state.gl || !state.sceneReady || !state.sceneIdentity) return

    const key = state.sceneIdentity
    const scale = state.scaleMode
    const needsQuickLook = state.platform === 'quicklook'

    // Already built for this scene (and scale, on Quick Look).
    if (state.builtKey === key && state.model && (!needsQuickLook || Boolean(state.usdzUrls[scale]))) {
      set({ status: 'idle', progress: 1, error: null })
      return
    }

    const seq = ++buildSeq
    set({ status: 'preparing', progress: 0.02, error: null })

    try {
      let model = state.builtKey === key ? state.model : null

      if (!model) {
        // Dispose any stale model or USDZ blobs from a previous scene.
        revokeUsdzCache(get().usdzUrls)
        get().model?.dispose()
        set({ model: null, builtKey: null, usdzUrls: {} })

        model = await buildArModel(state.scene, state.gl, state.glbActive, (p) => {
          if (buildSeq !== seq) return
          const scaledProgress = needsQuickLook ? p * 0.72 : p
          set({ progress: Math.min(0.99, Math.max(0.02, scaledProgress)) })
        })

        if (buildSeq !== seq) {
          model.dispose()
          return
        }

        set({ model, builtKey: key })
      }

      if (needsQuickLook) {
        if (buildSeq !== seq) return
        set({ progress: 0.76 })
        const blobUrl = await exportModelToUsdzUrl(model, scale, state.gl)
        if (buildSeq !== seq) {
          URL.revokeObjectURL(blobUrl)
          return
        }
        set((current) => ({
          status: 'idle',
          progress: 1,
          error: null,
          usdzUrls: { ...current.usdzUrls, [scale]: blobUrl },
        }))
      } else {
        set({ status: 'idle', progress: 1, error: null })
      }
    } catch (cause) {
      if (buildSeq !== seq) return
      console.error('[ar] failed to prepare AR model', cause)
      set({
        status: 'error',
        progress: 0,
        error: 'Could not prepare this project for AR. Please try again.',
      })
    }
  },

  startWebXr() {
    const state = get()
    if (state.status !== 'idle' || !state.model) return
    if (typeof navigator === 'undefined' || !navigator.xr?.requestSession) {
      set({
        status: 'error',
        error: 'AR needs Chrome on an ARCore Android phone, or Safari on iPhone or iPad.',
      })
      return
    }

    const options: ArXrSessionOptions = {
      requiredFeatures: ['hit-test'],
      optionalFeatures: state.overlayRoot
        ? ['dom-overlay', 'light-estimation', 'local-floor']
        : ['light-estimation', 'local-floor'],
      ...(state.overlayRoot ? { domOverlay: { root: state.overlayRoot } } : {}),
    }

    // Must run synchronously inside the button tap handler to preserve WebXR user activation.
    let request: Promise<XRSession>
    try {
      request = navigator.xr.requestSession('immersive-ar', options)
    } catch (cause) {
      console.error('[ar] requestSession threw synchronously', cause)
      set({ status: 'error', error: 'Could not start AR on this device.' })
      return
    }

    set({ error: null })

    request
      .then((session) => {
        if (!get().model) {
          void session.end().catch(() => {})
          return
        }
        const onEnd = () => {
          detachSessionEnd = null
          session.removeEventListener('end', onEnd)
          get().handleSessionEnd(session)
        }
        detachSessionEnd?.()
        session.addEventListener('end', onEnd)
        detachSessionEnd = () => session.removeEventListener('end', onEnd)
        set({ status: 'active', xrSession: session, error: null })
      })
      .catch((cause) => {
        const name = cause instanceof DOMException ? cause.name : ''
        // User cancelling the camera/AR permission prompt returns cleanly to idle.
        if (name === 'AbortError') {
          set({ status: 'idle', xrSession: null })
          return
        }
        console.error('[ar] immersive-ar session rejected', cause)
        set({
          status: 'error',
          xrSession: null,
          error:
            name === 'NotAllowedError'
              ? 'Camera permission is needed to place the model in your space.'
              : 'Could not start AR on this device.',
        })
      })
  },

  exitAr() {
    const { xrSession, status } = get()
    if (status !== 'active' && !xrSession) return
    detachSessionEnd?.()
    detachSessionEnd = null
    set({ status: 'idle', xrSession: null })
    if (xrSession) {
      void xrSession.end().catch(() => {})
    }
  },

  handleSessionEnd(session) {
    if (get().xrSession !== session) return
    detachSessionEnd = null
    set({ status: 'idle', xrSession: null })
  },

  resetForScene(nextIdentity) {
    const state = get()
    if (nextIdentity !== null && nextIdentity === state.builtKey && state.status !== 'active') return
    buildSeq++
    detachSessionEnd?.()
    detachSessionEnd = null
    if (state.xrSession) {
      void state.xrSession.end().catch(() => {})
    }
    revokeUsdzCache(state.usdzUrls)
    state.model?.dispose()
    set({
      status: 'idle',
      progress: 0,
      error: null,
      builtKey: null,
      model: null,
      usdzUrls: {},
      xrSession: null,
    })
  },
}))

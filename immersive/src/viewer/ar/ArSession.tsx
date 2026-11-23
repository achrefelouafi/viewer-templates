import { X } from 'lucide-react'
import { type TouchEvent, useCallback, useEffect, useRef, useState } from 'react'
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { type ArScaleMode, cloneArGroupForWebGl, scaleFactorForMode } from './buildArModel'
import { useArStore } from './store'

interface ArXrLightEstimate {
  primaryLightDirection?: DOMPointReadOnly
  primaryLightIntensity?: DOMPointReadOnly
  sphericalHarmonicsCoefficients?: Float32Array
}

type ArXrSessionExtras = {
  enabledFeatures?: string[]
  requestLightProbe?: () => Promise<unknown>
}

type ArXrFrameExtras = {
  getLightEstimate?: (probe: unknown) => ArXrLightEstimate | null
}

const UP = new Vector3(0, 1, 0)
const MAX_DRAG_DISTANCE = 50
const MIN_USER_SCALE = 0.02
const MAX_USER_SCALE = 2.5

function createShadowDiscTexture(): CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const half = size / 2
    const gradient = ctx.createRadialGradient(half, half, half * 0.12, half, half, half)
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.42)')
    gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.2)')
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

function createReticle(): { group: Group; dispose: () => void } {
  const group = new Group()
  group.visible = false
  group.matrixAutoUpdate = false

  const ringGeo = new RingGeometry(0.065, 0.088, 40)
  ringGeo.rotateX(-Math.PI / 2)
  const ringMat = new MeshBasicMaterial({
    color: 0xffffff,
    opacity: 0.92,
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
  })
  const ring = new Mesh(ringGeo, ringMat)

  const dotGeo = new CircleGeometry(0.014, 24)
  dotGeo.rotateX(-Math.PI / 2)
  const dotMat = new MeshBasicMaterial({
    color: 0xffffff,
    opacity: 0.95,
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
  })
  const dot = new Mesh(dotGeo, dotMat)
  dot.position.y = 0.001

  group.add(ring, dot)
  return {
    group,
    dispose: () => {
      ringGeo.dispose()
      ringMat.dispose()
      dotGeo.dispose()
      dotMat.dispose()
    },
  }
}

/**
 * Full-screen Android WebXR `immersive-ar` session overlay driven by its own lightweight
 * `THREE.WebGLRenderer({ alpha: true, antialias: true })`, leaving the main `<Viewer>` untouched.
 * Keeps a pre-mounted `domOverlay` root element available whenever `platform === 'webxr'`.
 */
export function ArSession() {
  const platform = useArStore((s) => s.platform)
  const status = useArStore((s) => s.status)
  const session = useArStore((s) => s.xrSession)
  const model = useArStore((s) => s.model)
  const scaleMode = useArStore((s) => s.scaleMode)
  const active = status === 'active' && session !== null && model !== null

  const overlayRef = useRef<HTMLDivElement>(null)
  const canvasHostRef = useRef<HTMLDivElement>(null)

  const [surfaceFound, setSurfaceFound] = useState(false)
  const [placed, setPlaced] = useState(false)

  // Live refs shared between the XR frame loop and DOM-overlay touch gestures.
  const placedRef = useRef(false)
  const surfaceFoundRef = useRef(false)
  const cameraRef = useRef<PerspectiveCamera | null>(null)
  const reticleRef = useRef<Group | null>(null)
  const placementGroupRef = useRef<Group | null>(null)
  const reticleMatrixRef = useRef(new Matrix4())
  const userScaleRef = useRef(1)

  // Touch gesture state.
  const gestureRef = useRef<{
    mode: 'none' | 'tap-or-drag' | 'pinch-twist'
    startTime: number
    startX: number
    startY: number
    moved: boolean
    dragOffset: Vector3
    pinchStartDist: number
    pinchStartScale: number
    twistStartAngle: number
    twistStartYaw: number
  }>({
    mode: 'none',
    startTime: 0,
    startX: 0,
    startY: 0,
    moved: false,
    dragOffset: new Vector3(),
    pinchStartDist: 0,
    pinchStartScale: 1,
    twistStartAngle: 0,
    twistStartYaw: 0,
  })

  // Register the DOM overlay root element before `requestSession` runs.
  useEffect(() => {
    if (platform !== 'webxr') {
      useArStore.getState().setOverlayRoot(null)
      return
    }
    useArStore.getState().setOverlayRoot(overlayRef.current)
    return () => useArStore.getState().setOverlayRoot(null)
  }, [platform])

  // Rescale the placed model immediately when the user switches Tabletop / Life size in-session.
  useEffect(() => {
    if (!model) return
    const nextScale = scaleFactorForMode(model, scaleMode)
    userScaleRef.current = nextScale
    if (placementGroupRef.current) {
      placementGroupRef.current.scale.setScalar(nextScale)
    }
  }, [model, scaleMode])

  // Drive the dedicated WebGLRenderer + WebXR session lifecycle.
  useEffect(() => {
    if (!active || !session || !model) {
      setSurfaceFound(false)
      setPlaced(false)
      placedRef.current = false
      surfaceFoundRef.current = false
      return
    }

    const host = canvasHostRef.current
    if (!host) return

    let cancelled = false
    const sessionExtras = session as XRSession & ArXrSessionExtras
    const canvas = document.createElement('canvas')
    canvas.className = 'h-full w-full'
    host.appendChild(canvas)

    const renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(window.innerWidth, window.innerHeight, false)
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1
    renderer.xr.enabled = true
    renderer.xr.setFramebufferScaleFactor(1)

    const arScene = new Scene()
    arScene.background = null

    const arCamera = new PerspectiveCamera(60, window.innerWidth / Math.max(1, window.innerHeight), 0.01, 200)
    cameraRef.current = arCamera

    const hemiLight = new HemisphereLight(0xffffff, 0x666666, 1.0)
    const dirLight = new DirectionalLight(0xffffff, 1.35)
    dirLight.position.set(2, 5, 3)
    arScene.add(hemiLight, dirLight)

    const reticle = createReticle()
    reticleRef.current = reticle.group
    arScene.add(reticle.group)

    const clonedModel = cloneArGroupForWebGl(model.group)
    const shadowTex = createShadowDiscTexture()
    const shadowSpan = Math.max(model.maxHorizontal * 1.25, 0.5)
    const shadowGeo = new PlaneGeometry(shadowSpan, shadowSpan)
    shadowGeo.rotateX(-Math.PI / 2)
    const shadowMat = new MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.75,
    })
    const shadowDisc = new Mesh(shadowGeo, shadowMat)
    shadowDisc.position.y = 0.002

    const placementGroup = new Group()
    placementGroup.visible = false
    const initialScale = scaleFactorForMode(model, useArStore.getState().scaleMode)
    userScaleRef.current = initialScale
    placementGroup.scale.setScalar(initialScale)
    placementGroup.add(shadowDisc, clonedModel.group)
    placementGroupRef.current = placementGroup
    arScene.add(placementGroup)

    let hitTestSource: XRHitTestSource | null = null
    let lightProbe: unknown = null
    const lightColor = new Color()

    const onResize = () => {
      if (renderer.xr.isPresenting) return
      renderer.setSize(window.innerWidth, window.innerHeight, false)
      arCamera.aspect = window.innerWidth / Math.max(1, window.innerHeight)
      arCamera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    const onXrFrame = (_time: number, frame?: XRFrame) => {
      if (cancelled) return
      const refSpace = renderer.xr.getReferenceSpace()

      if (frame && refSpace) {
        if (hitTestSource && !placedRef.current) {
          const hits = frame.getHitTestResults(hitTestSource)
          const first = hits[0]
          const pose = first?.getPose(refSpace)
          if (pose) {
            reticleMatrixRef.current.fromArray(pose.transform.matrix)
            reticle.group.matrix.copy(reticleMatrixRef.current)
            reticle.group.visible = true
            if (!surfaceFoundRef.current) {
              surfaceFoundRef.current = true
              setSurfaceFound(true)
            }
          } else {
            reticle.group.visible = false
          }
        } else {
          reticle.group.visible = false
        }

        const frameExtras = frame as XRFrame & ArXrFrameExtras
        if (lightProbe && frameExtras.getLightEstimate) {
          const estimate = frameExtras.getLightEstimate(lightProbe)
          if (estimate?.primaryLightDirection) {
            const d = estimate.primaryLightDirection
            dirLight.position.set(d.x, Math.max(0.25, d.y), d.z)
          }
          if (estimate?.primaryLightIntensity) {
            const i = estimate.primaryLightIntensity
            const maxChan = Math.max(i.x, i.y, i.z, 0.001)
            lightColor.setRGB(i.x / maxChan, i.y / maxChan, i.z / maxChan)
            dirLight.color.copy(lightColor)
            dirLight.intensity = Math.max(0.6, Math.min(2.2, maxChan))
          }
          if (estimate?.sphericalHarmonicsCoefficients && estimate.sphericalHarmonicsCoefficients.length >= 3) {
            const sh = estimate.sphericalHarmonicsCoefficients
            const ambient = Math.max(0.45, Math.min(1.5, ((sh[0] ?? 0.5) + (sh[1] ?? 0.5) + (sh[2] ?? 0.5)) / 3 + 0.35))
            hemiLight.intensity = ambient
          }
        }
      }

      renderer.render(arScene, arCamera)
    }

    const start = async () => {
      try {
        const wantsLocalFloor = sessionExtras.enabledFeatures?.includes('local-floor') === true
        renderer.xr.setReferenceSpaceType(wantsLocalFloor ? 'local-floor' : 'local')
        try {
          await renderer.xr.setSession(session)
        } catch (err) {
          if (!wantsLocalFloor) throw err
          renderer.xr.setReferenceSpaceType('local')
          await renderer.xr.setSession(session)
        }

        if (cancelled) return

        const viewerSpace = await session.requestReferenceSpace('viewer')
        if (cancelled) return
        if (session.requestHitTestSource) {
          hitTestSource = (await session.requestHitTestSource({ space: viewerSpace })) ?? null
        }
        if (
          !cancelled &&
          sessionExtras.enabledFeatures?.includes('light-estimation') &&
          sessionExtras.requestLightProbe
        ) {
          lightProbe = await sessionExtras.requestLightProbe().catch(() => null)
        }

        if (cancelled) {
          hitTestSource?.cancel()
          hitTestSource = null
          return
        }

        renderer.setAnimationLoop(onXrFrame)
      } catch (cause) {
        if (!cancelled) {
          console.error('[ar] failed to start WebXR AR renderer', cause)
          useArStore.getState().exitAr()
          useArStore.setState({
            status: 'error',
            error: 'Could not start AR on this device.',
          })
        }
      }
    }

    void start()

    return () => {
      cancelled = true
      window.removeEventListener('resize', onResize)
      renderer.setAnimationLoop(null)
      try {
        hitTestSource?.cancel()
      } catch {
        // Session may already be ended.
      }
      hitTestSource = null
      lightProbe = null
      reticle.dispose()
      shadowGeo.dispose()
      shadowMat.dispose()
      shadowTex.dispose()
      clonedModel.dispose()
      renderer.dispose()
      canvas.remove()
      cameraRef.current = null
      reticleRef.current = null
      placementGroupRef.current = null
    }
  }, [active, session, model])

  // Raycast a screen touch onto the horizontal plane at the placed model's current Y height.
  const intersectPlacementPlane = useCallback((clientX: number, clientY: number, out: Vector3): boolean => {
    const cam = cameraRef.current
    const group = placementGroupRef.current
    if (!cam || !group) return false
    const w = Math.max(1, window.innerWidth)
    const h = Math.max(1, window.innerHeight)
    const ndc = new Vector2((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1)
    const raycaster = new Raycaster()
    raycaster.setFromCamera(ndc, cam)
    const plane = new Plane(UP, -group.position.y)
    const hit = raycaster.ray.intersectPlane(plane, out)
    if (!hit) return false
    if (hit.distanceTo(cam.position) > MAX_DRAG_DISTANCE) return false
    return true
  }, [])

  const placeAtReticle = useCallback(() => {
    const reticle = reticleRef.current
    const group = placementGroupRef.current
    const cam = cameraRef.current
    if (!reticle || !reticle.visible || !group) return

    const pos = new Vector3().setFromMatrixPosition(reticleMatrixRef.current)
    group.position.copy(pos)
    if (cam) {
      const dx = cam.position.x - pos.x
      const dz = cam.position.z - pos.z
      if (dx * dx + dz * dz > 1e-6) {
        group.rotation.set(0, Math.atan2(dx, dz), 0)
      }
    }
    group.visible = true
    reticle.visible = false
    placedRef.current = true
    setPlaced(true)
  }, [])

  const handleTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if ((event.target as Element | null)?.closest('button')) return
      const g = gestureRef.current
      if (event.touches.length === 1) {
        const t = event.touches[0]!
        g.mode = 'tap-or-drag'
        g.startTime = performance.now()
        g.startX = t.clientX
        g.startY = t.clientY
        g.moved = false
        if (placedRef.current && placementGroupRef.current) {
          const hit = new Vector3()
          if (intersectPlacementPlane(t.clientX, t.clientY, hit)) {
            g.dragOffset.subVectors(placementGroupRef.current.position, hit)
          } else {
            g.dragOffset.set(0, 0, 0)
          }
        }
      } else if (event.touches.length >= 2 && placedRef.current && placementGroupRef.current) {
        const a = event.touches[0]!
        const b = event.touches[1]!
        g.mode = 'pinch-twist'
        g.moved = true
        g.pinchStartDist = Math.max(1, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY))
        g.pinchStartScale = userScaleRef.current
        g.twistStartAngle = Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX)
        g.twistStartYaw = placementGroupRef.current.rotation.y
      }
    },
    [intersectPlacementPlane],
  )

  const handleTouchMove = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if ((event.target as Element | null)?.closest('button')) return
      const g = gestureRef.current
      const group = placementGroupRef.current
      if (!group) return

      if (g.mode === 'tap-or-drag' && event.touches.length === 1) {
        const t = event.touches[0]!
        if (!g.moved && Math.hypot(t.clientX - g.startX, t.clientY - g.startY) > 8) {
          g.moved = true
        }
        if (placedRef.current && g.moved) {
          const hit = new Vector3()
          if (intersectPlacementPlane(t.clientX, t.clientY, hit)) {
            group.position.x = hit.x + g.dragOffset.x
            group.position.z = hit.z + g.dragOffset.z
          }
        }
      } else if (g.mode === 'pinch-twist' && event.touches.length >= 2 && placedRef.current) {
        const a = event.touches[0]!
        const b = event.touches[1]!
        const dist = Math.max(1, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY))
        const ratio = dist / g.pinchStartDist
        const nextScale = Math.max(MIN_USER_SCALE, Math.min(MAX_USER_SCALE, g.pinchStartScale * ratio))
        userScaleRef.current = nextScale
        group.scale.setScalar(nextScale)

        const angle = Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX)
        group.rotation.y = g.twistStartYaw - (angle - g.twistStartAngle)
      }
    },
    [intersectPlacementPlane],
  )

  const handleTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if ((event.target as Element | null)?.closest('button')) return
      const g = gestureRef.current
      if (event.touches.length === 0) {
        if (g.mode === 'tap-or-drag' && !g.moved && !placedRef.current && performance.now() - g.startTime < 400) {
          placeAtReticle()
        }
        g.mode = 'none'
      } else if (event.touches.length === 1 && placedRef.current && placementGroupRef.current) {
        const t = event.touches[0]!
        g.mode = 'tap-or-drag'
        g.moved = true
        const hit = new Vector3()
        if (intersectPlacementPlane(t.clientX, t.clientY, hit)) {
          g.dragOffset.subVectors(placementGroupRef.current.position, hit)
        }
      }
    },
    [intersectPlacementPlane, placeAtReticle],
  )

  if (platform !== 'webxr') return null

  const hintText = !surfaceFound
    ? 'Move your phone slowly to find the floor'
    : !placed
      ? 'Tap to place'
      : 'Drag to move · pinch to resize · twist to turn'

  return (
    <>
      <div
        aria-hidden="true"
        className={active ? 'fixed inset-0 z-40' : 'hidden'}
        ref={canvasHostRef}
      />

      {/* Dedicated WebXR DOM overlay root: stays mounted so requestSession receives a live Element. */}
      <div
        className={active ? 'fixed inset-0 z-50 touch-none select-none' : 'hidden'}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onTouchStart={handleTouchStart}
        ref={overlayRef}
      >
        {active ? (
          <>
            <div className="pointer-events-none absolute top-[max(1rem,env(safe-area-inset-top))] right-4 left-4 flex items-center justify-between gap-3">
              <button
                aria-label="Exit AR"
                className="ui-glass pointer-events-auto inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-4 font-medium text-foreground text-xs transition-opacity active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                onClick={() => useArStore.getState().exitAr()}
                type="button"
              >
                <X className="h-4 w-4" />
                <span>Exit</span>
              </button>

              <div
                aria-label="AR scale"
                className="ui-glass pointer-events-auto inline-grid grid-cols-2 gap-1 rounded-full p-1"
                role="group"
              >
                {(
                  [
                    { id: 'tabletop', label: 'Tabletop' },
                    { id: 'lifesize', label: 'Life size' },
                  ] as const satisfies readonly { id: ArScaleMode; label: string }[]
                ).map((option) => {
                  const selected = scaleMode === option.id
                  return (
                    <button
                      aria-pressed={selected}
                      className={`min-h-9 rounded-full px-3 font-medium text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 ${
                        selected ? 'bg-foreground text-background' : 'text-foreground/80 hover:text-foreground'
                      }`}
                      key={option.id}
                      onClick={() => {
                        useArStore.getState().setScaleMode(option.id)
                        if (model) {
                          const next = scaleFactorForMode(model, option.id)
                          userScaleRef.current = next
                          placementGroupRef.current?.scale.setScalar(next)
                        }
                      }}
                      type="button"
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="pointer-events-none absolute inset-x-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] flex justify-center">
              <div
                aria-live="polite"
                className="ui-glass relative max-w-sm rounded-full px-4 py-2.5 text-center text-foreground text-xs"
              >
                {hintText}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}

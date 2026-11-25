import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BackSide,
  CanvasTexture,
  type Group,
  LinearFilter,
  type Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { useVrStore } from './store'

const MIN_VISIBLE_MS = 600
const FADE_DURATION_MS = 400
const PANEL_DISTANCE = 2.5
const YAW_FOLLOW_SPEED = 4.5

const headPos = new Vector3()
const headDir = new Vector3()

function createGradientTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height)
    grad.addColorStop(0, '#07090d')
    grad.addColorStop(0.45, '#12161f')
    grad.addColorStop(0.55, '#171c26')
    grad.addColorStop(1, '#090b10')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  return texture
}

function createPanelTexture(projectName: string | null): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 384
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Subtle frosted dark pill card
    const x = 48
    const y = 32
    const w = canvas.width - 96
    const h = canvas.height - 64
    const r = 44
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.fillStyle = 'rgba(18, 22, 30, 0.82)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const title = (projectName?.trim() || 'Pascal viewer').slice(0, 36)
    ctx.fillStyle = '#f4f4f4'
    ctx.font = '300 54px "Barlow", system-ui, -apple-system, sans-serif'
    ctx.fillText(title, canvas.width / 2, 134)

    // Architectural hairline rule
    ctx.fillStyle = 'rgba(244, 244, 244, 0.28)'
    ctx.fillRect(canvas.width / 2 - 44, 184, 88, 2)

    ctx.fillStyle = 'rgba(244, 244, 244, 0.72)'
    ctx.font = '400 30px "Barlow", system-ui, -apple-system, sans-serif'
    ctx.fillText('Preparing your walkthrough', canvas.width / 2, 238)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  return texture
}

function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

/**
 * 360° inside-out VR loading environment shown while WebGL-XR initializes, the scene rebuilds,
 * and the BVH collider + spawn settle. Uses only MeshBasicMaterial + CanvasTexture (compatible
 * with Three's WebGPURenderer WebGL backend — no ShaderMaterial or troika text).
 */
export function VrLoadingDome({ projectName }: { projectName: string | null }) {
  const { camera } = useThree()
  const ready = useVrStore((s) => s.sceneReady && s.colliderReady && s.spawnPlaced)
  const [done, setDone] = useState(false)

  const sphereRef = useRef<Mesh>(null)
  const panelGroupRef = useRef<Group>(null)
  const ringRef = useRef<Mesh>(null)

  const startTimeRef = useRef<number | null>(null)
  const fadeStartRef = useRef<number | null>(null)
  const yawInitRef = useRef(false)
  const panelYawRef = useRef(0)

  const resources = useMemo(() => {
    const gradientTex = createGradientTexture()
    const panelTex = createPanelTexture(projectName)
    const sphereGeo = new SphereGeometry(6, 32, 24)
    const sphereMat = new MeshBasicMaterial({
      map: gradientTex,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 1,
    })
    const panelGeo = new PlaneGeometry(1.75, 0.65)
    const panelMat = new MeshBasicMaterial({
      map: panelTex,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 1,
    })
    const ringGeo = new RingGeometry(0.055, 0.072, 36, 1, 0, Math.PI * 1.45)
    const ringMat = new MeshBasicMaterial({
      color: 0xf4f4f4,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    })
    return { gradientTex, panelTex, sphereGeo, sphereMat, panelGeo, panelMat, ringGeo, ringMat }
  }, [projectName])

  useEffect(
    () => () => {
      resources.gradientTex.dispose()
      resources.panelTex.dispose()
      resources.sphereGeo.dispose()
      resources.sphereMat.dispose()
      resources.panelGeo.dispose()
      resources.panelMat.dispose()
      resources.ringGeo.dispose()
      resources.ringMat.dispose()
    },
    [resources],
  )

  useFrame((_, delta) => {
    if (done) return
    const now = performance.now()
    if (startTimeRef.current === null) startTimeRef.current = now

    camera.getWorldPosition(headPos)
    camera.getWorldDirection(headDir)

    if (sphereRef.current) {
      sphereRef.current.position.copy(headPos)
    }

    const flatLenSq = headDir.x * headDir.x + headDir.z * headDir.z
    if (flatLenSq > 1e-4) {
      const targetYaw = Math.atan2(-headDir.x, -headDir.z)
      if (!yawInitRef.current) {
        panelYawRef.current = targetYaw
        yawInitRef.current = true
      } else {
        panelYawRef.current += shortestAngleDelta(panelYawRef.current, targetYaw) * Math.min(1, delta * YAW_FOLLOW_SPEED)
      }
    }

    if (panelGroupRef.current) {
      const yaw = panelYawRef.current
      panelGroupRef.current.position.set(
        headPos.x - Math.sin(yaw) * PANEL_DISTANCE,
        headPos.y - 0.04,
        headPos.z - Math.cos(yaw) * PANEL_DISTANCE,
      )
      panelGroupRef.current.rotation.set(0, yaw, 0)
    }

    if (ringRef.current) {
      ringRef.current.rotation.z -= delta * 2.4
    }

    if (ready && now - startTimeRef.current >= MIN_VISIBLE_MS) {
      if (fadeStartRef.current === null) fadeStartRef.current = now
      const t = Math.min(1, (now - fadeStartRef.current) / FADE_DURATION_MS)
      const opacity = 1 - t
      resources.sphereMat.opacity = opacity
      resources.panelMat.opacity = opacity
      resources.ringMat.opacity = opacity * 0.9
      if (t >= 1) setDone(true)
    }
  }, 0.6)

  if (done) return null

  return (
    <group name="vr-loading-dome" userData={{ vrIgnore: true }}>
      <mesh
        frustumCulled={false}
        geometry={resources.sphereGeo}
        material={resources.sphereMat}
        ref={sphereRef}
        renderOrder={999}
      />
      <group ref={panelGroupRef}>
        <mesh
          frustumCulled={false}
          geometry={resources.panelGeo}
          material={resources.panelMat}
          renderOrder={1000}
        />
        <mesh
          frustumCulled={false}
          geometry={resources.ringGeo}
          material={resources.ringMat}
          position={[0, -0.46, 0.01]}
          ref={ringRef}
          renderOrder={1001}
        />
      </group>
    </group>
  )
}

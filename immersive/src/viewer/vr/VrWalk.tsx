import {
  BVHEcctrl,
  type BVHEcctrlApi,
  type GlbWalkthrough,
  setSurfaceRaycastLayers,
  STAND_CAPSULE,
  STAND_FLOAT_HEIGHT,
} from '@pascal-app/viewer'
import { KeyboardControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  Box3,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  EdgesGeometry,
  type Group,
  LinearFilter,
  LineBasicMaterial,
  type LineSegments,
  type Material,
  Matrix4,
  type Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Ray,
  Raycaster,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from 'three'
import { playOrbTap } from '../chrome/orbSounds'
import { buildVrColliderWorld, resolveVrSpawn, type VrColliderWorld } from './collider'
import { useVrLook, type VrContrast } from './look'
import {
  type LiveVrTarget,
  objectForLiveVrTarget,
  operateLiveVrTarget,
  resolveLiveHudInteract,
  resolveLiveVrTarget,
} from './liveInteract'
import {
  createMenuCanvas,
  drawMenu,
  MENU_PANEL_H,
  MENU_PANEL_W,
  menuButtonAt,
  useVrMenu,
} from './menuPanel'
import { useVrStore } from './store'

const EMPTY_KEY_MAP: { name: string; keys: string[] }[] = []

// Capsule centre to feet: half cylinder (0.4) + radius (0.25) + floatHeight (0.5) - static spring sag (~0.008).
const CAPSULE_FEET_OFFSET = STAND_CAPSULE[1] / 2 + STAND_CAPSULE[0] + STAND_FLOAT_HEIGHT - 0.008
const CONTROLLER_CENTER_FROM_EYE = 0.85
const VOID_FALL_RESPAWN_DEPTH = 12
/** The bake's interaction reach (`WALK_REACH` in the viewer's GLB scene), metres. */
const GLB_WALK_REACH = 3
const STICK_DEADZONE = 0.18
const SNAP_TURN_ANGLE = Math.PI / 6
const SNAP_TURN_THRESHOLD = 0.65
const SNAP_TURN_RELEASE = 0.35
const SETTLE_FRAMES_BEFORE_COLLIDER = 2
/** Exposure ceiling in the headset (about +0.7 EV): the metered indoor lift goes to +2.4 EV. */
const VR_MAX_EXPOSURE = 1.6
/** How fast the floor height follows the capsule (stairs, the float spring's bob), per second. */
const FLOOR_FOLLOW_RATE = 10
/** A floor change bigger than this (a respawn, a fall) is taken at once. */
const FLOOR_SNAP = 0.8
const LASER_LENGTH = 6
const MENU_DISTANCE = 0.7
/** A pointer steeper than this (|y| of its direction) doesn't steer the bake's targeting. */
const MAX_AIM_STEEPNESS = 0.94

const TONE_MAPPING: Record<VrContrast, number> = {
  soft: AgXToneMapping,
  natural: NeutralToneMapping,
  punchy: ACESFilmicToneMapping,
}

type Hand = 'left' | 'right'

type HandState = {
  valid: boolean
  rayOrigin: Vector3
  rayDir: Vector3
  rayQuat: Quaternion
  gripPos: Vector3
  gripQuat: Quaternion
  primaryPressed: boolean
  menuPressed: boolean
}

function createHand(): HandState {
  return {
    valid: false,
    rayOrigin: new Vector3(),
    rayDir: new Vector3(0, 0, -1),
    rayQuat: new Quaternion(),
    gripPos: new Vector3(),
    gripQuat: new Quaternion(),
    primaryPressed: false,
    menuPressed: false,
  }
}

const UP = new Vector3(0, 1, 0)
const FORWARD = new Vector3(0, 0, -1)
const bakeRaycaster = new Raycaster()
setSurfaceRaycastLayers(bakeRaycaster.layers)
bakeRaycaster.far = GLB_WALK_REACH
const laserRaycaster = new Raycaster()
laserRaycaster.far = LASER_LENGTH
const menuRaycaster = new Raycaster()
menuRaycaster.far = LASER_LENGTH
const aimRay = new Ray()
const headWorld = new Vector3()
const headLocal = new Vector3()
const headForward = new Vector3()
const aimForward = new Vector3()
const aimRight = new Vector3()
const desired = new Vector3()
const tempVec = new Vector3()
const tempVecB = new Vector3()
const tempQuat = new Quaternion()
const tempMatrix = new Matrix4()
const tempBox = new Box3()
const tempBoxCenter = new Vector3()
const tempBoxSize = new Vector3()
const yawQuat = new Quaternion()
const offsetPos = new Vector3()
const offsetQuat = new Quaternion()
const offsetScale = new Vector3()
/** A symmetric frustum the bake's centre ray can be cast through when a pointer steers it. */
const aimCamera = new PerspectiveCamera(50, 1, 0.05, 100)
aimCamera.updateProjectionMatrix()
const savedPosition = new Vector3()
const savedQuaternion = new Quaternion()
const savedProjection = new Matrix4()
const savedProjectionInverse = new Matrix4()

function identityAncestor(object: Object3D | null): Object3D | null {
  for (let current = object; current; current = current.parent) {
    if (current.userData.pascalId) return current
  }
  return null
}

/** `xr-standard` puts the thumbstick on axes 2 and 3; two-axis devices use 0 and 1. */
function readStickAxes(gamepad: Gamepad): { x: number; y: number } {
  if (gamepad.axes.length >= 4) return { x: gamepad.axes[2] ?? 0, y: gamepad.axes[3] ?? 0 }
  return { x: gamepad.axes[0] ?? 0, y: gamepad.axes[1] ?? 0 }
}

/** Horizontal forward and right of a direction, for steering on the floor. */
function flatBasis(direction: Vector3, forward: Vector3, right: Vector3): boolean {
  forward.set(direction.x, 0, direction.z)
  if (forward.lengthSq() < 1e-6) return false
  forward.normalize()
  right.crossVectors(forward, UP).normalize()
  return true
}

function createPromptCanvas(): { canvas: HTMLCanvasElement; texture: CanvasTexture } {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 112
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  return { canvas, texture }
}

function drawPromptLabel(canvas: HTMLCanvasElement, texture: CanvasTexture, text: string) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (text) {
    ctx.font = '500 32px "Barlow", system-ui, -apple-system, sans-serif'
    const measured = Math.min(canvas.width - 72, Math.max(160, ctx.measureText(text).width + 64))
    const x = (canvas.width - measured) / 2
    const h = canvas.height - 36
    ctx.beginPath()
    ctx.roundRect(x, 18, measured, h, h / 2)
    ctx.fillStyle = 'rgba(14, 17, 23, 0.84)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#f4f4f4'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1, measured - 40)
  }
  texture.needsUpdate = true
}

function formatSentenceCase(verb: string, label: string): string {
  const raw = `${verb} ${label}`.trim()
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : ''
}

export interface VrWalkProps {
  glbActive: boolean
  glbObjects: ReadonlyMap<string, Object3D>
  glbWalk: GlbWalkthrough
}

/**
 * The VR walkthrough rig, a sibling of the spatial scene inside `immersive.Scene`.
 *
 * The camera stays a plain scene camera whose pose WebXR writes in world space: walking moves
 * the XR reference space instead (an offset of the session's floor space), so everything that
 * reads the camera (the bake's targeting, the floor and room under it, the exposure meter)
 * sees where the head really is in the building.
 *
 * A `BVHEcctrl` capsule does the walking on a collider built from the drawn scene: the left
 * stick pushes it along the head's heading, real steps in the room push it too (walls stop
 * both), and the right stick snap-turns 30° around the head. The play space's floor follows the
 * capsule's feet, eased so stairs and the float spring don't bob the view.
 *
 * Each controller is drawn with a pointer: the trigger, or A / X, uses what it points at;
 * B / Y opens a menu (brightness, contrast, light, exit) clicked with the same pointer. Without
 * controllers, the head's forward ray aims. On the bake, whose interaction stays inside
 * `GlbScene` (its centre ray from the camera, E to use), the camera borrows the active
 * pointer's pose for the scene's frame callbacks, then gets the head pose back before drawing.
 */
export function VrWalk({ glbActive, glbObjects, glbWalk }: VrWalkProps) {
  const { camera, gl, scene } = useThree()
  const session = useVrStore((s) => s.session)
  const sessionId = useVrStore((s) => s.sessionId)
  const sceneReady = useVrStore((s) => s.sceneReady)
  const contrast = useVrLook((s) => s.contrast)
  const menuOpen = useVrMenu((s) => s.open)

  const handRefs = { left: useRef<Group>(null), right: useRef<Group>(null) }
  const laserRef = useRef<Mesh>(null)
  const dotRef = useRef<Mesh>(null)
  const reticleRef = useRef<Mesh>(null)
  const promptMeshRef = useRef<Mesh>(null)
  const highlightRef = useRef<LineSegments>(null)
  const menuMeshRef = useRef<Mesh>(null)

  const controllerRef = useRef<BVHEcctrlApi | null>(null)
  const worldRef = useRef<VrColliderWorld | null>(null)
  const [world, setWorld] = useState<VrColliderWorld | null>(null)
  const [start, setStart] = useState<{ position: [number, number, number]; yaw: number } | null>(null)

  const settleFramesRef = useRef(0)
  const builtColliderRef = useRef(false)
  const placedRef = useRef(false)
  const baseSpaceRef = useRef<XRReferenceSpace | null>(null)
  /** The play space's pose in the world, as the current frame's head pose was read with. */
  const appliedOrigin = useRef(new Matrix4())
  const appliedOriginInverse = useRef(new Matrix4())
  const appliedYawRef = useRef(0)
  const yawRef = useRef(0)
  const floorYRef = useRef(0)
  const prevHeadLocalRef = useRef<{ x: number; z: number } | null>(null)
  const snapArmedRef = useRef(true)
  const hands = useRef<Record<Hand, HandState>>({ left: createHand(), right: createHand() })
  const activeHandRef = useRef<Hand>('right')
  const aimBorrowedRef = useRef(false)
  const pendingInteractRef = useRef<{ hand: Hand | null; wait: number } | null>(null)
  const liveTargetRef = useRef<LiveVrTarget | null>(null)
  const lastPromptTextRef = useRef('')
  const menuHoverRef = useRef<string | null>(null)
  const menuLocalRef = useRef(new Matrix4())
  const exposureRef = useRef({ base: 1, written: Number.NaN })

  const glbWalkRef = useRef(glbWalk)
  glbWalkRef.current = glbWalk

  const glbRoot = useMemo(() => {
    if (!glbActive) return null
    let root: Object3D | null = glbObjects.values().next().value ?? null
    while (root?.parent && root.parent.type !== 'Scene') root = root.parent
    return root
  }, [glbActive, glbObjects])

  const visuals = useMemo(() => {
    const overlay = (color: number, opacity: number) => new MeshBasicMaterial({
      color, depthTest: false, depthWrite: false, transparent: true, opacity,
    })
    const { canvas: promptCanvas, texture: promptTex } = createPromptCanvas()
    const unitBox = new BoxGeometry(1, 1, 1)
    const highlightGeo = new EdgesGeometry(unitBox)
    unitBox.dispose()
    // A controller: a grip tilted back from the pointer, a ring around the pointer's start.
    const gripGeo = new CylinderGeometry(0.017, 0.021, 0.11, 18)
    gripGeo.rotateX(Math.PI / 2.6)
    gripGeo.translate(0, -0.03, 0.045)
    const ringGeo = new TorusGeometry(0.032, 0.006, 10, 32)
    const laserGeo = new BoxGeometry(0.0025, 0.0025, 1)
    laserGeo.translate(0, 0, -0.5)
    const menu = createMenuCanvas()
    return {
      reticleGeo: new RingGeometry(0.014, 0.022, 28),
      reticleMat: overlay(0xffffff, 0.85),
      promptCanvas,
      promptTex,
      promptGeo: new PlaneGeometry(0.56, 0.122),
      promptMat: new MeshBasicMaterial({ map: promptTex, depthTest: false, depthWrite: false, transparent: true }),
      highlightGeo,
      highlightMat: new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 }),
      gripGeo,
      gripMat: new MeshBasicMaterial({ color: 0x2a2f3a }),
      ringGeo,
      ringMat: new MeshBasicMaterial({ color: 0xd4d7de }),
      ringActiveMat: new MeshBasicMaterial({ color: 0x34d399 }),
      laserGeo,
      laserMat: overlay(0xffffff, 0.55),
      dotGeo: new SphereGeometry(0.012, 14, 10),
      dotMat: overlay(0xffffff, 0.95),
      menu,
      menuGeo: new PlaneGeometry(MENU_PANEL_W, MENU_PANEL_H),
      menuMat: new MeshBasicMaterial({ map: menu.texture, depthTest: false, depthWrite: false, transparent: true }),
    }
  }, [])

  useEffect(() => () => {
    for (const value of Object.values(visuals)) {
      if (value && typeof (value as { dispose?: unknown }).dispose === 'function') {
        (value as { dispose: () => void }).dispose()
      }
    }
    visuals.menu.texture.dispose()
  }, [visuals])

  // Contrast picks the tone mapping curve; materials rebuild their output with it.
  useEffect(() => {
    const previous = gl.toneMapping
    gl.toneMapping = TONE_MAPPING[contrast] as typeof gl.toneMapping
    scene.traverse((object) => {
      const material = (object as Mesh).material as Material | Material[] | undefined
      if (Array.isArray(material)) for (const m of material) m.needsUpdate = true
      else if (material) material.needsUpdate = true
    })
    return () => {
      gl.toneMapping = previous
    }
  }, [contrast, gl, scene])

  // The trigger (select) uses what that hand points at, or clicks the menu.
  useEffect(() => {
    if (!session) return
    const onSelectStart = (event: XRInputSourceEvent) => {
      const hand = event.inputSource.handedness
      queueInteract(hand === 'left' || hand === 'right' ? hand : null)
    }
    session.addEventListener('selectstart', onSelectStart)
    return () => session.removeEventListener('selectstart', onSelectStart)
  }, [session])

  // A new session starts with the menu closed.
  useEffect(() => {
    useVrMenu.getState().setOpen(false)
    return () => useVrMenu.getState().setOpen(false)
  }, [sessionId])

  useEffect(() => () => {
    worldRef.current?.dispose()
    worldRef.current = null
  }, [])

  function queueInteract(hand: Hand | null) {
    let wait = 0
    if (hand && hand !== activeHandRef.current) {
      activeHandRef.current = hand
      // The bake aims with the active pointer from the next frame's callbacks on.
      wait = 1
    }
    pendingInteractRef.current = { hand, wait }
  }

  // Once the scene is ready and its floors have settled, build the collider and find the spawn.
  useFrame(() => {
    if (builtColliderRef.current || !sceneReady) return
    settleFramesRef.current += 1
    if (settleFramesRef.current < SETTLE_FRAMES_BEFORE_COLLIDER) return
    builtColliderRef.current = true
    const built = buildVrColliderWorld(scene, glbActive)
    worldRef.current = built
    setWorld(built)
    const spawn = resolveVrSpawn(scene, built, glbActive)
    yawRef.current = spawn.yaw
    setStart({
      position: [spawn.position[0], spawn.position[1] - CONTROLLER_CENTER_FROM_EYE, spawn.position[2]],
      yaw: spawn.yaw,
    })
    useVrStore.getState().markColliderReady(sessionId)
  }, 0.2)

  const setControllerApi = useCallback((api: BVHEcctrlApi | null) => {
    controllerRef.current = api
  }, [])

  // Before physics: read the head and controllers, sticks and buttons, push real steps into the
  // capsule, and (on the bake) lend the active pointer's pose to the camera.
  useFrame((_, _delta, frame?: XRFrame) => {
    if (!session || !frame) return
    const xr = gl.xr
    if (!baseSpaceRef.current) {
      const space = xr.getReferenceSpace()
      if (!space) return
      baseSpaceRef.current = space
    }

    camera.getWorldPosition(headWorld)
    headLocal.copy(headWorld).applyMatrix4(appliedOriginInverse.current)
    camera.getWorldDirection(headForward)

    const space = xr.getReferenceSpace()
    const state = hands.current
    state.left.valid = false
    state.right.valid = false
    let moveX = 0
    let moveY = 0
    let turnX = 0
    let toggleMenu = false

    for (const source of session.inputSources) {
      const handedness = source.handedness
      if (handedness !== 'left' && handedness !== 'right') continue
      const hand = state[handedness]
      const rayPose = space ? frame.getPose(source.targetRaySpace, space) : undefined
      if (rayPose) {
        const { position: p, orientation: o } = rayPose.transform
        hand.valid = true
        hand.rayOrigin.set(p.x, p.y, p.z)
        hand.rayQuat.set(o.x, o.y, o.z, o.w)
        hand.rayDir.copy(FORWARD).applyQuaternion(hand.rayQuat)
        const gripPose = source.gripSpace && space ? frame.getPose(source.gripSpace, space) : undefined
        if (gripPose) {
          const { position: gp, orientation: go } = gripPose.transform
          hand.gripPos.set(gp.x, gp.y, gp.z)
          hand.gripQuat.set(go.x, go.y, go.z, go.w)
        } else {
          hand.gripPos.copy(hand.rayOrigin)
          hand.gripQuat.copy(hand.rayQuat)
        }
      }
      const gamepad = source.gamepad
      if (!gamepad) continue
      const stick = readStickAxes(gamepad)
      if (handedness === 'left') {
        moveX = stick.x
        moveY = stick.y
      } else {
        turnX = stick.x
      }
      // A / X (button 4) uses what this hand points at; B / Y (button 5) opens the menu.
      const primary = Boolean(gamepad.buttons[4]?.pressed)
      if (primary && !hand.primaryPressed) queueInteract(handedness)
      hand.primaryPressed = primary
      const menuButton = Boolean(gamepad.buttons[5]?.pressed)
      if (menuButton && !hand.menuPressed) toggleMenu = true
      hand.menuPressed = menuButton
    }

    if (!state[activeHandRef.current].valid) {
      const other: Hand = activeHandRef.current === 'right' ? 'left' : 'right'
      if (state[other].valid) activeHandRef.current = other
    }

    if (toggleMenu) {
      const open = !useVrMenu.getState().open
      if (open) placeMenu()
      useVrMenu.getState().setOpen(open)
      playOrbTap(open ? 'open' : 'close')
    }

    const api = controllerRef.current
    const group = api?.group
    if (!api || !group) return

    // Snap turn on the right stick, once per push.
    if (snapArmedRef.current && Math.abs(turnX) >= SNAP_TURN_THRESHOLD) {
      yawRef.current += turnX > 0 ? -SNAP_TURN_ANGLE : SNAP_TURN_ANGLE
      snapArmedRef.current = false
    } else if (!snapArmedRef.current && Math.abs(turnX) <= SNAP_TURN_RELEASE) {
      snapArmedRef.current = true
    }

    // Real steps in the room move the capsule too, so walls stop them like the stick.
    const prev = prevHeadLocalRef.current
    if (prev && placedRef.current) {
      const dx = headLocal.x - prev.x
      const dz = headLocal.z - prev.z
      if (dx * dx + dz * dz > 1e-8) {
        const cos = Math.cos(appliedYawRef.current)
        const sin = Math.sin(appliedYawRef.current)
        group.position.x += dx * cos + dz * sin
        group.position.z += -dx * sin + dz * cos
      }
    }
    prevHeadLocalRef.current = { x: headLocal.x, z: headLocal.z }

    // The bake aims with the camera's centre ray: lend it the active pointer for this frame.
    const active = state[activeHandRef.current]
    const borrow = glbActive && placedRef.current && active.valid && !useVrMenu.getState().open &&
      Math.abs(active.rayDir.y) < MAX_AIM_STEEPNESS
    if (borrow) lendCameraTo(active)

    // The stick walks along the head's heading. BVHEcctrl steers by the camera's direction,
    // which is the pointer's while it's lent, so the stick is turned into the pointer's frame.
    const magnitude = Math.hypot(moveX, moveY)
    if (magnitude < STICK_DEADZONE || !flatBasis(headForward, tempVec, tempVecB)) {
      api.setMovement({ joystick: { x: 0, y: 0 } })
    } else {
      desired.copy(tempVec).multiplyScalar(-moveY).addScaledVector(tempVecB, moveX)
      if (borrow && flatBasis(active.rayDir, aimForward, aimRight)) {
        api.setMovement({ joystick: { x: desired.dot(aimRight), y: desired.dot(aimForward) } })
      } else {
        api.setMovement({ joystick: { x: moveX, y: -moveY } })
      }
    }
  }, -0.5)

  function lendCameraTo(hand: HandState) {
    savedPosition.copy(camera.position)
    savedQuaternion.copy(camera.quaternion)
    savedProjection.copy(camera.projectionMatrix)
    savedProjectionInverse.copy(camera.projectionMatrixInverse)
    const parent = camera.parent
    if (parent) {
      parent.updateWorldMatrix(true, false)
      tempMatrix.copy(parent.matrixWorld).invert()
      camera.position.copy(hand.rayOrigin).applyMatrix4(tempMatrix)
      parent.getWorldQuaternion(tempQuat).invert()
      camera.quaternion.copy(tempQuat).multiply(hand.rayQuat)
    } else {
      camera.position.copy(hand.rayOrigin)
      camera.quaternion.copy(hand.rayQuat)
    }
    camera.projectionMatrix.copy(aimCamera.projectionMatrix)
    camera.projectionMatrixInverse.copy(aimCamera.projectionMatrixInverse)
    camera.updateMatrixWorld(true)
    aimBorrowedRef.current = true
  }

  function placeMenu() {
    // In front of the head, a little low, facing it; kept in the play space so it walks along.
    flatBasis(headForward, tempVec, tempVecB)
    const position = tempVecB.copy(headWorld).addScaledVector(tempVec, MENU_DISTANCE)
    position.y -= 0.12
    const facing = Math.atan2(-tempVec.x, -tempVec.z)
    tempQuat.setFromAxisAngle(UP, facing)
    tempMatrix.compose(position, tempQuat, offsetScale.set(1, 1, 1))
    menuLocalRef.current.copy(appliedOriginInverse.current).multiply(tempMatrix)
  }

  // After the scene's callbacks: the head pose back on the camera, and the headset's exposure.
  useFrame(() => {
    if (aimBorrowedRef.current) {
      camera.position.copy(savedPosition)
      camera.quaternion.copy(savedQuaternion)
      camera.projectionMatrix.copy(savedProjection)
      camera.projectionMatrixInverse.copy(savedProjectionInverse)
      camera.updateMatrixWorld(true)
      aimBorrowedRef.current = false
    }
    // The viewer writes the metered exposure each frame (once, without daylight): keep its value
    // as the base, cap it (no SSGI or AO in the headset to darken rooms) and apply brightness.
    const exposure = exposureRef.current
    if (gl.toneMappingExposure !== exposure.written) exposure.base = gl.toneMappingExposure
    exposure.written = Math.min(exposure.base, VR_MAX_EXPOSURE) * useVrLook.getState().brightness
    gl.toneMappingExposure = exposure.written
  }, 0.45)

  // After physics: move the play space onto the capsule, then aim, draw and act.
  useFrame((_, delta) => {
    const api = controllerRef.current
    const group = api?.group
    const xr = gl.xr
    const base = baseSpaceRef.current

    if (api && group && start && base) {
      const collider = worldRef.current
      if (collider && group.position.y < collider.minY - VOID_FALL_RESPAWN_DEPTH) {
        group.position.set(start.position[0], start.position[1], start.position[2])
        api.resetLinVel()
        yawRef.current = start.yaw
      }

      // Head over the capsule, feet on its floor (eased), turned by the snap yaw.
      const yaw = yawRef.current
      const cos = Math.cos(yaw)
      const sin = Math.sin(yaw)
      const feetY = group.position.y - CAPSULE_FEET_OFFSET
      if (!placedRef.current || Math.abs(feetY - floorYRef.current) > FLOOR_SNAP) floorYRef.current = feetY
      else floorYRef.current += (feetY - floorYRef.current) * Math.min(1, delta * FLOOR_FOLLOW_RATE)
      tempVec.set(
        group.position.x - (headLocal.x * cos + headLocal.z * sin),
        floorYRef.current,
        group.position.z - (-headLocal.x * sin + headLocal.z * cos),
      )
      yawQuat.setFromAxisAngle(UP, yaw)
      tempMatrix.compose(tempVec, yawQuat, offsetScale.set(1, 1, 1))
      if (!tempMatrix.equals(appliedOrigin.current)) {
        appliedOrigin.current.copy(tempMatrix)
        appliedOriginInverse.current.copy(tempMatrix).invert()
        appliedYawRef.current = yaw
        // The session's floor space, offset so the play space sits at the origin above.
        appliedOriginInverse.current.decompose(offsetPos, offsetQuat, offsetScale)
        xr.setReferenceSpace(base.getOffsetReferenceSpace(new XRRigidTransform(
          { x: offsetPos.x, y: offsetPos.y, z: offsetPos.z },
          { x: offsetQuat.x, y: offsetQuat.y, z: offsetQuat.z, w: offsetQuat.w },
        )))
      }
      if (!placedRef.current) {
        placedRef.current = true
        prevHeadLocalRef.current = { x: headLocal.x, z: headLocal.z }
        useVrStore.getState().markSpawnPlaced(sessionId)
      }
    }

    // Controllers, the active one with its ring lit.
    const state = hands.current
    for (const handedness of ['left', 'right'] as const) {
      const model = handRefs[handedness].current
      const hand = state[handedness]
      if (!model) continue
      model.visible = hand.valid
      if (!hand.valid) continue
      model.position.copy(hand.rayOrigin)
      model.quaternion.copy(hand.rayQuat)
      const ring = model.children[1] as Mesh | undefined
      if (ring) ring.material = handedness === activeHandRef.current ? visuals.ringActiveMat : visuals.ringMat
    }

    // The aim: the active pointer, or the head's forward ray without controllers.
    const active = state[activeHandRef.current]
    const pointing = active.valid
    if (pointing) aimRay.set(active.rayOrigin, active.rayDir)
    else aimRay.set(headWorld, headForward)

    let targetObject: Object3D | null = null
    let promptText = ''
    let endDistance = LASER_LENGTH
    let onTarget = false

    // The menu takes the pointer first.
    const menuMesh = menuMeshRef.current
    let menuHover: string | null = null
    let onMenu = false
    if (menuMesh) {
      menuMesh.visible = menuOpen
      if (menuOpen) {
        tempMatrix.copy(appliedOrigin.current).multiply(menuLocalRef.current)
        tempMatrix.decompose(menuMesh.position, menuMesh.quaternion, menuMesh.scale)
        menuMesh.updateMatrixWorld(true)
        menuRaycaster.ray.copy(aimRay)
        const hit = menuRaycaster.intersectObject(menuMesh, false)[0]
        if (hit?.uv) {
          onMenu = true
          endDistance = hit.distance
          menuHover = menuButtonAt(visuals.menu, hit.uv.x, hit.uv.y)?.id ?? null
        }
        drawMenu(visuals.menu, menuHover)
      }
    }
    if (menuHover !== menuHoverRef.current && menuHover) playOrbTap('press')
    menuHoverRef.current = menuHover

    if (!onMenu && placedRef.current) {
      if (glbActive) {
        // GlbScene aimed with the same ray (lent above); it reports the openable it found.
        const door = glbWalkRef.current?.door ?? null
        if (door && glbRoot) {
          bakeRaycaster.ray.copy(aimRay)
          const hit = bakeRaycaster.intersectObject(glbRoot, true)[0]
          if (hit) {
            targetObject = identityAncestor(hit.object)
            endDistance = hit.distance
            onTarget = true
          }
          promptText = formatSentenceCase(door.verb ?? (door.isOpen ? 'close' : 'open'), door.label)
        }
      } else {
        const liveTarget = resolveLiveVrTarget(aimRay, headWorld)
        liveTargetRef.current = liveTarget
        if (liveTarget) {
          targetObject = objectForLiveVrTarget(liveTarget)
          endDistance = liveTarget.distance
          onTarget = true
          const prompt = resolveLiveHudInteract(liveTarget)
          if (prompt) promptText = formatSentenceCase(prompt.verb, prompt.label)
        }
      }
      // Otherwise the pointer ends on the nearest surface.
      const collider = worldRef.current?.mesh
      if (!onTarget && collider) {
        laserRaycaster.ray.copy(aimRay)
        const hit = laserRaycaster.intersectObject(collider, false)[0]
        if (hit) endDistance = hit.distance
      }
    }

    // The pointer's beam and its end dot; the head's ring when there are no controllers.
    const laser = laserRef.current
    const dot = dotRef.current
    const reticle = reticleRef.current
    const end = tempVec.copy(aimRay.origin).addScaledVector(aimRay.direction, endDistance - 0.01)
    if (laser) {
      laser.visible = pointing
      if (pointing) {
        laser.position.copy(aimRay.origin)
        laser.quaternion.copy(active.rayQuat)
        laser.scale.set(1, 1, Math.max(0.01, endDistance - 0.01))
        visuals.laserMat.opacity = onTarget || menuHover ? 0.9 : 0.45
        visuals.laserMat.color.setHex(onTarget ? 0x34d399 : 0xffffff)
      }
    }
    const headDistance = end.distanceTo(headWorld)
    if (dot) {
      dot.visible = pointing && endDistance < LASER_LENGTH
      dot.position.copy(end)
      dot.scale.setScalar(Math.max(0.6, headDistance * 0.6))
      visuals.dotMat.color.setHex(onTarget ? 0x34d399 : 0xffffff)
    }
    if (reticle) {
      reticle.visible = !pointing
      if (!pointing) {
        const distance = Math.min(2, Math.max(0.45, endDistance - 0.05))
        reticle.position.copy(aimRay.origin).addScaledVector(aimRay.direction, distance)
        camera.getWorldQuaternion(tempQuat)
        reticle.quaternion.copy(tempQuat)
        reticle.scale.setScalar((distance / 2) * (onTarget ? 1.25 : 1))
        visuals.reticleMat.color.setHex(onTarget ? 0x34d399 : 0xffffff)
      }
    }

    // What the pointer would use, named just above where it lands, facing the head.
    const promptMesh = promptMeshRef.current
    if (promptMesh) {
      if (promptText !== lastPromptTextRef.current) {
        lastPromptTextRef.current = promptText
        drawPromptLabel(visuals.promptCanvas, visuals.promptTex, promptText)
      }
      promptMesh.visible = promptText.length > 0
      if (promptMesh.visible) {
        const scale = Math.min(2, Math.max(0.5, headDistance / 1.6))
        camera.getWorldQuaternion(tempQuat)
        promptMesh.quaternion.copy(tempQuat)
        promptMesh.position.copy(end).lerp(headWorld, 0.08)
        promptMesh.position.addScaledVector(tempVecB.set(0, 1, 0).applyQuaternion(tempQuat), 0.09 * scale)
        promptMesh.scale.setScalar(scale)
      }
    }

    // A white box around the target, standing in for the desktop's outline pass.
    const highlight = highlightRef.current
    if (highlight) {
      highlight.visible = false
      if (targetObject) {
        tempBox.setFromObject(targetObject)
        if (!tempBox.isEmpty()) {
          tempBox.getCenter(tempBoxCenter)
          tempBox.getSize(tempBoxSize)
          highlight.position.copy(tempBoxCenter)
          highlight.scale.set(
            Math.max(0.02, tempBoxSize.x + 0.015),
            Math.max(0.02, tempBoxSize.y + 0.015),
            Math.max(0.02, tempBoxSize.z + 0.015),
          )
          highlight.visible = true
        }
      }
    }

    // A queued trigger, A or X: click the menu, or use the target.
    const pending = pendingInteractRef.current
    if (pending) {
      if (pending.wait > 0) {
        pending.wait -= 1
      } else {
        pendingInteractRef.current = null
        if (menuOpen && onMenu) {
          const button = visuals.menu.buttons.find((b) => b.id === menuHover)
          if (button) {
            playOrbTap('press')
            button.run()
            visuals.menu.drawnKey = ''
          }
        } else if (placedRef.current && !onMenu) {
          if (glbActive) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', code: 'KeyE', bubbles: true }))
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'e', code: 'KeyE', bubbles: true }))
          } else {
            operateLiveVrTarget(liveTargetRef.current)
          }
        }
      }
    }
  }, 0.5)

  const controller = (handedness: Hand) => (
    <group name={`vr-controller-${handedness}`} ref={handRefs[handedness]} visible={false}>
      <mesh geometry={visuals.gripGeo} material={visuals.gripMat} />
      <mesh geometry={visuals.ringGeo} material={visuals.ringMat} />
    </group>
  )

  return (
    <>
      <group name="vr-ui" userData={{ vrIgnore: true }}>
        {controller('left')}
        {controller('right')}
        <mesh frustumCulled={false} geometry={visuals.laserGeo} material={visuals.laserMat} ref={laserRef}
          renderOrder={997} visible={false} />
        <mesh frustumCulled={false} geometry={visuals.dotGeo} material={visuals.dotMat} ref={dotRef}
          renderOrder={998} visible={false} />
        <mesh frustumCulled={false} geometry={visuals.reticleGeo} material={visuals.reticleMat} ref={reticleRef}
          renderOrder={998} />
        <mesh frustumCulled={false} geometry={visuals.promptGeo} material={visuals.promptMat} ref={promptMeshRef}
          renderOrder={999} visible={false} />
        <lineSegments frustumCulled={false} geometry={visuals.highlightGeo} material={visuals.highlightMat}
          ref={highlightRef} visible={false} />
        <mesh frustumCulled={false} geometry={visuals.menuGeo} material={visuals.menuMat} ref={menuMeshRef}
          renderOrder={1000} visible={false} />
      </group>

      {world && start && (
        <KeyboardControls map={EMPTY_KEY_MAP}>
          <BVHEcctrl
            acceleration={26}
            airDragFactor={0.3}
            colliderCapsuleArgs={STAND_CAPSULE}
            colliderMeshes={[world.mesh]}
            collisionCheckIteration={3}
            collisionPushBackDamping={0.1}
            collisionPushBackThreshold={0.001}
            deceleration={30}
            delay={0}
            fallGravityFactor={4}
            floatCheckType="BOTH"
            floatDampingC={36}
            floatHeight={STAND_FLOAT_HEIGHT}
            floatPullBackHeight={0.35}
            floatSensorRadius={0.15}
            floatSpringK={1200}
            gravity={9.81}
            jumpVel={5}
            maxRunSpeed={4}
            maxSlope={1.2}
            maxWalkSpeed={2}
            position={start.position}
            ref={setControllerApi}
            sleepTimeout={1e9}
          />
        </KeyboardControls>
      )}
    </>
  )
}

import { useInteractive, useScene, type AnyNodeId } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ALERT, alarmColor, isOn, openness, tripped, type Area, type HassEntities, type HassEntity, type HomeDevice } from '../entities'
import { approach, useFlow } from './common'
import { beamMaterial, frameMaterial, ringsMaterial } from './materials'

/* The safety and security families: covers, locks, door and window contacts, smoke, leaks, motion,
   sirens and the alarm panel. Each takes the entity, its device placement and the floor height. */

export type FamilyProps = { entity: HassEntity; device: HomeDevice; entities: HassEntities; floorY: number }

const set = (m: { uniforms: Record<string, { value: unknown }> }, k: string, v: unknown) => {
  const u = m.uniforms[k] as { value: { set?: (v: unknown) => void } | unknown }
  if (u.value && typeof (u.value as THREE.Color).set === 'function' && typeof v === 'string') (u.value as THREE.Color).set(v)
  else u.value = v
}

type WindowField = 'operationState' | 'shutterOpen' | 'rollerShutterOpen'
type WindowLike = { type?: string; rollerShutter?: string; shutters?: string; shutterOpen?: number; rollerShutterOpen?: number; operationState?: number }

/** The part of a window a device opens: a cover its roller or side shutters (none where the model
    has none: a blind open is not the window open), anything else (a contact sensor) the sash. */
function windowField(node: WindowLike, cover: boolean): WindowField | null {
  if (!cover) return 'operationState'
  if (node.rollerShutter && node.rollerShutter !== 'none') return 'rollerShutterOpen'
  if (node.shutters && node.shutters !== 'none') return 'shutterOpen'
  return null
}

/**
 * Opens or closes a Pascal door or window node the way its own interaction does, so the model
 * moves: a door swings, a window's sash or shutters open.
 * @param cover the device is a blind or shutter (on a window it moves the shutters, not the sash)
 */
export function usePascalDoor(nodeId: string | undefined, open: boolean, cover = false) {
  const first = useRef(true)
  useEffect(() => {
    if (!nodeId) return
    const store = useInteractive.getState()
    const id = nodeId as AnyNodeId
    const node = useScene.getState().nodes[id] as WindowLike | undefined
    const wasFirst = first.current
    first.current = false
    if (node?.type === 'window') {
      const field = windowField(node, cover)
      if (!field) return
      const from = store.windows[id]?.[field] ?? node[field] ?? (open ? 0 : 1)
      if (from === (open ? 1 : 0)) return
      store.startWindowAnimation(id, { field, from, to: open ? 1 : 0, startedAt: null, durationMs: 1100, persist: true })
      return
    }
    const from = store.doors[id]?.operationState ?? (open ? 0 : 1)
    if (wasFirst && !open) return
    store.startDoorAnimation(id, { field: 'operationState', from, to: open ? 1 : 0, startedAt: null, durationMs: 1100, persist: true })
  }, [nodeId, open, cover])
}

/** How much daylight there is outside, 0 (night) to 1 (midday), from the viewer's time of day. */
function useDaylight() {
  const t = useViewer((s) => s.timeOfDay)
  return t === 'midday' ? 1 : t === 'golden' ? 0.75 : t === 'blue' ? 0.25 : 0.05
}

/* ---------------- covers: blinds, curtains, shutters, garage doors ---------------- */

/** Family "opening": daylight falls through the cover as far as it is open (warm by day, nothing at
    night), and its edge glows while it travels. The cover itself moves in its own model. */
export function OpeningEffect({ entity, device, floorY }: FamilyProps) {
  const { position, rotationY, size = [0.1, 1.4, 1.2] } = device.anchor
  const [, h, w] = size
  const day = useDaylight()
  const shaft = useMemo(() => beamMaterial(), [])
  const patch = useMemo(() => ringsMaterial(), [])
  const edge = useMemo(() => frameMaterial(), [])
  const k = useRef(0)
  const move = useRef(0)
  useFrame((st, dt) => {
    k.current = approach(k.current, openness(entity) * day, dt, 3)
    const moving = entity.state === 'opening' || entity.state === 'closing'
    move.current = approach(move.current, moving ? 1 : 0, dt, 6)
    set(shaft, 'uColor', day > 0.5 ? '#fff1d6' : '#ffc98a')
    shaft.uniforms.uA.value = k.current * 0.5
    set(patch, 'uColor', '#fff1d6')
    patch.uniforms.uA.value = k.current * 0.5
    patch.uniforms.uFill.value = 1
    patch.uniforms.uRing.value = 0
    set(edge, 'uColor', ALERT.info)
    edge.uniforms.uA.value = move.current * 0.9
    edge.uniforms.uT.value = st.clock.elapsedTime
    edge.uniforms.uPulse.value = 1
  })
  const fall = position[1] - floorY
  return (
    <group position={position} rotation-y={rotationY}>
      {/* the shaft leans in from the window and down to the floor */}
      <mesh position={[fall * 0.55, -fall * 0.45, 0]} rotation-z={Math.PI / 2 - 0.85} material={shaft} renderOrder={6}>
        <planeGeometry args={[w, fall * 1.5]} />
      </mesh>
      <mesh position={[fall * 1.1, floorY - position[1] + 0.03, 0]} rotation-x={-Math.PI / 2} scale={[1.3, 0.9, 1]} material={patch} renderOrder={5}>
        <planeGeometry args={[w * 1.6, w * 1.6]} />
      </mesh>
      <mesh position={[0.06, 0, 0]} rotation-y={Math.PI / 2} material={edge}>
        <planeGeometry args={[w + 0.08, h + 0.08]} />
      </mesh>
    </group>
  )
}

/* ---------------- locks ---------------- */

const LOCK_COLOR: Record<string, string> = { locked: ALERT.ok, unlocked: ALERT.warn, open: ALERT.warn, jammed: ALERT.danger, locking: ALERT.info, unlocking: ALERT.info, opening: ALERT.info }

/** Family "lock": a ring on the door at the lock, green locked, amber unlocked, red jammed, chasing
    while it turns; opening the lock swings its Pascal door. */
export function LockEffect({ entity, device }: FamilyProps) {
  const ring = useMemo(() => ringsMaterial(), [])
  const k = useRef(0)
  usePascalDoor(device.nodeId, entity.state === 'open' || entity.state === 'opening', true)
  useFrame((st, dt) => {
    const busy = entity.state.endsWith('ing')
    k.current = approach(k.current, busy ? 1 : 0, dt, 5)
    set(ring, 'uColor', LOCK_COLOR[entity.state] ?? ALERT.idle)
    ring.uniforms.uT.value = st.clock.elapsedTime
    ring.uniforms.uA.value = 0.9
    ring.uniforms.uFreq.value = 3
    ring.uniforms.uSpeed.value = 6
    ring.uniforms.uSharp.value = 2 + k.current * 10
    ring.uniforms.uRing.value = k.current
    ring.uniforms.uFill.value = 0.55 - k.current * 0.4
    ring.uniforms.uInner.value = 0.55
  })
  return (
    <group position={device.anchor.position} rotation-y={device.anchor.rotationY}>
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * 0.06, 0, 0]} rotation-y={(s * Math.PI) / 2} material={ring}>
          <planeGeometry args={[0.36, 0.36]} />
        </mesh>
      ))}
    </group>
  )
}

/* ---------------- door and window contacts ---------------- */

/** Family "contact": an amber frame round the opening while it is open; a door sensor linked to a
    Pascal door swings it too. */
export function ContactEffect({ entity, device }: FamilyProps) {
  const { size = [0.1, 2.1, 1] } = device.anchor
  const frame = useMemo(() => frameMaterial(), [])
  const k = useRef(0)
  usePascalDoor(device.nodeId, tripped(entity))
  useFrame((st, dt) => {
    k.current = approach(k.current, tripped(entity) ? 1 : 0, dt, 4)
    set(frame, 'uColor', ALERT.warn)
    frame.uniforms.uA.value = k.current
    frame.uniforms.uT.value = st.clock.elapsedTime
    frame.uniforms.uPulse.value = 0.4
    frame.uniforms.uWidth.value = 0.05
  })
  return (
    <group position={device.anchor.position} rotation-y={device.anchor.rotationY}>
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * 0.08, 0, 0]} rotation-y={Math.PI / 2} material={frame}>
          <planeGeometry args={[size[2] + 0.1, size[1] + 0.1]} />
        </mesh>
      ))}
    </group>
  )
}

/* ---------------- smoke, gas and CO ---------------- */

/** Family "smoke": with smoke, red rings pulse out across the ceiling and a grey plume spreads down
    from the detector. */
export function SmokeEffect({ entity, device, floorY }: FamilyProps) {
  const rings = useMemo(() => ringsMaterial(), [])
  const plume = useFlow(160, 0.9)
  const k = useRef(0)
  const drop = device.anchor.position[1] - floorY
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    k.current = approach(k.current, tripped(entity) ? 1 : 0, dt, 2)
    set(rings, 'uColor', ALERT.danger)
    rings.uniforms.uT.value = t
    rings.uniforms.uA.value = k.current
    rings.uniforms.uSpeed.value = 5
    rings.uniforms.uFreq.value = 4
    rings.uniforms.uSharp.value = 6
    plume.mat.uniforms.uColor.value.set('#8c8f94')
    plume.update(
      (out, life, seed) => {
        const a = seed * 53.1
        const r = life * (0.6 + seed * 2.2)
        out.set(Math.cos(a) * r, -0.15 - life * drop * 0.55 * ((seed * 3.7) % 1), Math.sin(a) * r)
      },
      t,
      0.12,
      k.current * 0.28,
    )
  })
  return (
    <group position={device.anchor.position}>
      <mesh position={[0, -0.06, 0]} rotation-x={Math.PI / 2} material={rings} renderOrder={6}>
        <planeGeometry args={[4.5, 4.5]} />
      </mesh>
      <primitive object={plume.points} />
    </group>
  )
}

/* ---------------- water leaks ---------------- */

/** Family "leak": water spreads across the floor from the sensor, with ripples, and shrinks back
    once it reads dry. */
export function LeakEffect({ entity, device, floorY }: FamilyProps) {
  const pool = useMemo(() => ringsMaterial(), [])
  const r = useRef(0)
  const mesh = useRef<THREE.Mesh>(null)
  useFrame((st, dt) => {
    r.current = approach(r.current, tripped(entity) ? 1 : 0, dt, tripped(entity) ? 0.35 : 0.8)
    set(pool, 'uColor', ALERT.water)
    pool.uniforms.uT.value = st.clock.elapsedTime
    pool.uniforms.uA.value = Math.min(1, r.current * 3)
    pool.uniforms.uFill.value = 0.55
    pool.uniforms.uFreq.value = 18
    pool.uniforms.uSpeed.value = 3
    pool.uniforms.uSharp.value = 3
    pool.uniforms.uRing.value = 0.5
    if (mesh.current) mesh.current.scale.setScalar(0.05 + r.current * 2.6)
  })
  const [x, , z] = device.anchor.position
  return (
    <mesh ref={mesh} position={[x, floorY + 0.035, z]} rotation-x={-Math.PI / 2} material={pool} renderOrder={5}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  )
}

/* ---------------- motion and presence ---------------- */

/** Family "motion": the sensor's field of view on the floor, faint while it watches and flashing
    with rings when something moves in it. */
export function MotionEffect({ entity, device, floorY }: FamilyProps) {
  const cone = useMemo(() => ringsMaterial(), [])
  const k = useRef(0)
  const reach = Number(entity.attributes._reach ?? 6)
  useFrame((st, dt) => {
    k.current = approach(k.current, tripped(entity) ? 1 : 0, dt, 6)
    set(cone, 'uColor', tripped(entity) ? ALERT.warn : ALERT.info)
    cone.uniforms.uT.value = st.clock.elapsedTime
    cone.uniforms.uA.value = 0.35 + k.current * 0.65
    cone.uniforms.uHalf.value = 0.7
    cone.uniforms.uDir.value = 0
    cone.uniforms.uFill.value = 0.25 + k.current * 0.2
    cone.uniforms.uRing.value = 0.2 + k.current * 0.8
    cone.uniforms.uSpeed.value = 6
    cone.uniforms.uFreq.value = 9
  })
  const [x, y, z] = device.anchor.position
  return (
    <group position={[x, floorY + 0.04, z]} rotation-y={device.anchor.rotationY}>
      <mesh rotation-x={-Math.PI / 2} material={cone} renderOrder={5}>
        <planeGeometry args={[reach * 2, reach * 2]} />
      </mesh>
      <mesh position={[0, (y - floorY) / 2, 0]}>
        <cylinderGeometry args={[0.004, 0.004, y - floorY, 4]} />
        <meshBasicMaterial color={ALERT.info} transparent opacity={0.15} depthWrite={false} />
      </mesh>
    </group>
  )
}

/* ---------------- sirens ---------------- */

/** Family "siren": two red beams sweep the room, its light flashes and rings pulse off it. */
export function SirenEffect({ entity, device }: FamilyProps) {
  const beams = useRef<THREE.Group>(null)
  const beam = useMemo(() => beamMaterial(), [])
  const rings = useMemo(() => ringsMaterial(), [])
  const light = useRef<THREE.PointLight>(null)
  const gl = useThree((s) => s.gl)
  const k = useRef(0)
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime
    k.current = approach(k.current, isOn(entity) ? 1 : 0, dt, 6)
    const col = entity.attributes.tone === 'fire' ? '#ff5a2a' : ALERT.danger
    if (beams.current) beams.current.rotation.y = t * 4
    set(beam, 'uColor', col)
    beam.uniforms.uA.value = k.current * 0.55
    set(rings, 'uColor', col)
    rings.uniforms.uT.value = t
    rings.uniforms.uA.value = k.current
    rings.uniforms.uSpeed.value = 9
    rings.uniforms.uFreq.value = 5
    if (light.current) {
      light.current.color.set(col)
      light.current.intensity = (k.current * (Math.sin(t * 12) > 0 ? 6 : 0.5)) / Math.max(1, gl.toneMappingExposure)
    }
  })
  return (
    <group position={device.anchor.position} rotation-y={device.anchor.rotationY}>
      <pointLight ref={light} intensity={0} distance={9} decay={1.6} />
      <group ref={beams}>
        {[0, Math.PI].map((a) => (
          <group key={a} rotation-y={a}>
            {/* apex at the siren, opening outwards along +x */}
            <mesh position={[2.5, 0, 0]} rotation-z={Math.PI / 2} material={beam}>
              <coneGeometry args={[1.2, 5, 24, 1, true]} />
            </mesh>
          </group>
        ))}
      </group>
      <mesh rotation-y={Math.PI / 2} material={rings}>
        <planeGeometry args={[3, 3]} />
      </mesh>
    </group>
  )
}

/* ---------------- the alarm panel ---------------- */

/** Family "alarm": the whole home's outline glows with the panel's state (green disarmed, amber at
    home or arming, red away or triggered), flashing on entry delay and when triggered. */
export function AlarmEffect({ entity, areas, floorY }: FamilyProps & { areas: Area[] }) {
  const frame = useMemo(() => frameMaterial(), [])
  const k = useRef(0)
  const x0 = Math.min(...areas.map((a) => a.bounds[0])) - 0.3
  const z0 = Math.min(...areas.map((a) => a.bounds[1])) - 0.3
  const x1 = Math.max(...areas.map((a) => a.bounds[2])) + 0.3
  const z1 = Math.max(...areas.map((a) => a.bounds[3])) + 0.3
  useFrame((st, dt) => {
    const s = entity.state
    k.current = approach(k.current, s === 'disarmed' ? 0.35 : 1, dt, 3)
    set(frame, 'uColor', alarmColor(s))
    frame.uniforms.uA.value = k.current
    frame.uniforms.uT.value = st.clock.elapsedTime * (s === 'triggered' ? 2 : 1)
    frame.uniforms.uPulse.value = s === 'triggered' || s === 'pending' || s === 'arming' ? 1 : 0
    frame.uniforms.uWidth.value = 0.025
  })
  return (
    <mesh position={[(x0 + x1) / 2, floorY + 0.045, (z0 + z1) / 2]} rotation-x={-Math.PI / 2} material={frame} renderOrder={5}>
      <planeGeometry args={[x1 - x0, z1 - z0]} />
    </mesh>
  )
}

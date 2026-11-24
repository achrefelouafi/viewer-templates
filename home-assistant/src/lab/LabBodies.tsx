import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { approach, fanSwing } from '../home/effects/common'
import { alarmColor, climateColor, fanSpin, fieldColor, fieldOf, isOn, lightColor, lightLevel, openness, tripped, type HassEntity } from '../home/entities'
import { FLOOR_Y, type LabModel } from './labHome'

/* Stand-in device models for the lab. In a project the Pascal item draws the device; these only
   give the effects something to sit on, and answer the same entity state (blades spin, lamps glow,
   screens read out). Every body is built facing +x, like the effects. */

const BODY = '#e8eaed'
const DARK = '#23272c'

function useScreen(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, deps: unknown[]) {
  const s = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return { c, t }
  }, [w, h])
  useEffect(() => {
    const g = s.c.getContext('2d')!
    g.fillStyle = '#0b0e12'
    g.fillRect(0, 0, w, h)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    draw(g)
    s.t.needsUpdate = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return s.t
}

function WallAc({ e }: { e: HassEntity }) {
  const louver = useRef<THREE.Group>(null)
  const k = useRef(0)
  const body = useMemo(() => new THREE.MeshStandardMaterial({ color: BODY, roughness: 0.42 }), [])
  const led = useMemo(() => new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false }), [])
  const on = e.state !== 'off'
  const screen = useScreen(256, 96, (g) => {
    if (!on) return
    g.fillStyle = climateColor(e)
    g.font = '700 70px ui-monospace, Menlo, Consolas, monospace'
    g.fillText(e.state === 'fan_only' ? 'FAN' : e.state === 'dry' ? 'DRY' : `${e.attributes.temperature}°`, 128, 52)
  }, [on, e.state, e.attributes.temperature, climateColor(e)])
  useFrame((st, dt) => {
    k.current = approach(k.current, on ? 1 : 0, dt, on ? 2.2 : 3.4)
    if (louver.current) louver.current.rotation.z = -k.current * (1.85 + Math.sin(st.clock.elapsedTime * 0.8) * 0.1)
    led.color.set(on ? climateColor(e) : '#2a2f35')
  })
  // the unit's long side runs across z, its face looks along +x
  return (
    <group>
      <RoundedBox args={[0.24, 0.32, 1.12]} radius={0.05} smoothness={4} material={body} />
      <mesh position={[0.122, 0.015, -0.31]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[0.27, 0.1]} />
        <meshBasicMaterial map={screen} toneMapped={false} />
      </mesh>
      <mesh position={[0.123, 0.015, 0.44]} rotation-y={Math.PI / 2} material={led}>
        <circleGeometry args={[0.012, 14]} />
      </mesh>
      <mesh position={[0.09, -0.12, 0]}>
        <boxGeometry args={[0.07, 0.06, 0.98]} />
        <meshStandardMaterial color="#14171b" />
      </mesh>
      <group ref={louver} position={[0.13, -0.152, 0]}>
        <mesh position={[0, 0.034, 0]} material={body}>
          <boxGeometry args={[0.01, 0.068, 0.98]} />
        </mesh>
      </group>
    </group>
  )
}

function Pendant({ e }: { e: HassEntity }) {
  const lamp = useMemo(() => new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#000', roughness: 0.4 }), [])
  const k = useRef(0)
  const c = useMemo(() => new THREE.Color(), [])
  useFrame((_, dt) => {
    k.current = approach(k.current, lightLevel(e), dt, 5)
    lamp.emissive.copy(c.set(lightColor(e))).multiplyScalar(k.current * 3.2)
  })
  return (
    <group>
      {[-0.68, 0.68].map((z) => (
        <mesh key={z} position={[0, 0.36, z]}>
          <cylinderGeometry args={[0.007, 0.007, 0.7, 6]} />
          <meshStandardMaterial color={DARK} />
        </mesh>
      ))}
      <RoundedBox args={[0.11, 0.05, 1.72]} radius={0.02} smoothness={3}>
        <meshStandardMaterial color={DARK} metalness={0.5} roughness={0.35} />
      </RoundedBox>
      <mesh position={[0, -0.028, 0]} material={lamp}>
        <boxGeometry args={[0.075, 0.012, 1.62]} />
      </mesh>
    </group>
  )
}

function FloorLamp({ e }: { e: HassEntity }) {
  const shade = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f3efe8', emissive: '#000', roughness: 0.7, side: THREE.DoubleSide }), [])
  const k = useRef(0)
  const c = useMemo(() => new THREE.Color(), [])
  useFrame((_, dt) => {
    k.current = approach(k.current, lightLevel(e), dt, 5)
    shade.emissive.copy(c.set(lightColor(e))).multiplyScalar(k.current * 1.6)
  })
  const stem = 1.62 - FLOOR_Y
  return (
    <group>
      <mesh position={[0, 0.02, 0]} material={shade}>
        <cylinderGeometry args={[0.14, 0.2, 0.26, 32, 1, true]} />
      </mesh>
      <mesh position={[0, -stem / 2, 0]}>
        <cylinderGeometry args={[0.012, 0.012, stem, 8]} />
        <meshStandardMaterial color={DARK} metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, -stem + 0.012, 0]}>
        <cylinderGeometry args={[0.16, 0.17, 0.024, 32]} />
        <meshStandardMaterial color={DARK} metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  )
}

function Blades({ count, length, width, color, tilt }: { count: number; length: number; width: number; color: string; tilt: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <group key={i} rotation-y={(i * Math.PI * 2) / count}>
          <mesh position={[length / 2 + 0.1, 0, 0]} rotation-x={tilt}>
            <boxGeometry args={[length, 0.016, width]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
        </group>
      ))}
    </>
  )
}

function CeilingFan({ e }: { e: HassEntity }) {
  const blades = useRef<THREE.Group>(null)
  const spin = useRef(0)
  const blur = useMemo(() => new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }), [])
  useFrame((_, dt) => {
    spin.current = approach(spin.current, fanSpin(e), dt, isOn(e) ? 1.5 : 0.8)
    const dir = e.attributes.direction === 'reverse' ? 1 : -1
    if (blades.current) blades.current.rotation.y += dir * spin.current * dt
    blur.opacity = (spin.current / 18) * 0.09
  })
  return (
    <group>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 0.42, 10]} />
        <meshStandardMaterial color={DARK} metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[0.13, 0.15, 0.13, 28]} />
        <meshStandardMaterial color={DARK} metalness={0.6} roughness={0.32} />
      </mesh>
      <mesh position={[0, -0.02, 0]} rotation-x={Math.PI / 2} material={blur}>
        <circleGeometry args={[1.25, 48]} />
      </mesh>
      <group ref={blades}>
        <Blades count={3} length={1.14} width={0.2} color="#c99c6d" tilt={0.2} />
      </group>
    </group>
  )
}

function FloorFan({ e }: { e: HassEntity }) {
  const head = useRef<THREE.Group>(null)
  const rotor = useRef<THREE.Group>(null)
  const spin = useRef(0)
  const swing = useRef(0)
  useFrame((st, dt) => {
    spin.current = approach(spin.current, fanSpin(e) * 1.6, dt, isOn(e) ? 1.5 : 0.8)
    if (rotor.current) rotor.current.rotation.x += spin.current * dt
    if (e.attributes.oscillating) swing.current = approach(swing.current, fanSwing(st.clock.elapsedTime), dt, 30)
    if (head.current) head.current.rotation.y = swing.current
  })
  const pole = 1.15 - FLOOR_Y - 0.12
  return (
    <group>
      <mesh position={[0, -0.12 - pole / 2, 0]}>
        <cylinderGeometry args={[0.018, 0.022, pole, 10]} />
        <meshStandardMaterial color={BODY} roughness={0.4} />
      </mesh>
      <mesh position={[0, -0.12 - pole + 0.02, 0]}>
        <cylinderGeometry args={[0.2, 0.22, 0.04, 32]} />
        <meshStandardMaterial color={BODY} roughness={0.4} />
      </mesh>
      <group ref={head}>
        <mesh position={[-0.08, 0, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.06, 0.07, 0.14, 20]} />
          <meshStandardMaterial color={BODY} roughness={0.4} />
        </mesh>
        <mesh position={[0.04, 0, 0]} rotation-y={Math.PI / 2}>
          <torusGeometry args={[0.24, 0.008, 8, 48]} />
          <meshStandardMaterial color="#c9ccd1" metalness={0.5} roughness={0.3} />
        </mesh>
        <group ref={rotor} position={[0.04, 0, 0]}>
          <group rotation-z={Math.PI / 2}>
            <Blades count={4} length={0.18} width={0.1} color="#dfe3e8" tilt={0.5} />
          </group>
        </group>
      </group>
    </group>
  )
}

function WallSensor({ e }: { e: HassEntity }) {
  const k = fieldOf(e)
  const v = Number(e.state)
  const col = k ? fieldColor(k, v) : '#9aa3ad'
  const text = k === 'temperature' ? `${v.toFixed(1)}°` : k === 'humidity' ? `${Math.round(v)}%` : k ? `${Math.round(v)}` : e.state
  const screen = useScreen(256, 256, (g) => {
    g.fillStyle = '#fff'
    g.font = `700 ${text.length > 4 ? 62 : 74}px ui-monospace, Menlo, Consolas, monospace`
    g.fillText(text, 128, 128)
  }, [text])
  const ring = useMemo(() => new THREE.MeshBasicMaterial({ color: '#fff', toneMapped: false }), [])
  ring.color.set(col)
  // the puck stands off the wall facing +x
  return (
    <group rotation-z={-Math.PI / 2}>
      <mesh>
        <cylinderGeometry args={[0.125, 0.125, 0.03, 44]} />
        <meshStandardMaterial color={BODY} roughness={0.35} />
      </mesh>
      <group position={[0, 0.0155, 0]} rotation-x={-Math.PI / 2}>
        <mesh material={ring}>
          <ringGeometry args={[0.099, 0.112, 56]} />
        </mesh>
        <mesh position={[0, 0, 0.001]} rotation-z={Math.PI / 2}>
          <circleGeometry args={[0.096, 44]} />
          <meshBasicMaterial map={screen} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

/* ---------------- the rest of the device families ---------------- */

const Box = ({ args, position, color = BODY, ...rest }: { args: [number, number, number]; position?: [number, number, number]; color?: string; metalness?: number; roughness?: number }) => (
  <mesh position={position}>
    <boxGeometry args={args} />
    <meshStandardMaterial color={color} roughness={rest.roughness ?? 0.45} metalness={rest.metalness ?? 0} />
  </mesh>
)
/** A small status light that follows a colour, unlit so it reads in any light. */
function Led({ color, position, r = 0.012, blink = false }: { color: string; position: [number, number, number]; r?: number; blink?: boolean }) {
  const m = useMemo(() => new THREE.MeshBasicMaterial({ color: '#000', toneMapped: false }), [])
  useFrame((st) => {
    m.color.set(color).multiplyScalar(blink && Math.sin(st.clock.elapsedTime * 8) < 0 ? 0.15 : 1)
  })
  return (
    <mesh position={position} material={m}>
      <sphereGeometry args={[r, 12, 8]} />
    </mesh>
  )
}

/** A window with a roller blind that lowers as the cover closes. */
function Blind({ e }: { e: HassEntity }) {
  const blind = useRef<THREE.Mesh>(null)
  const p = useRef(openness(e))
  useFrame((_, dt) => {
    p.current = approach(p.current, openness(e), dt, 8)
    if (blind.current) {
      const down = Math.max(0.02, 1 - p.current)
      blind.current.scale.y = down
      blind.current.position.y = 0.7 - (1.4 * down) / 2
    }
  })
  return (
    <group>
      {/* the glass, its frame and the roller box */}
      <mesh position={[-0.03, 0, 0]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[1.5, 1.4]} />
        <meshStandardMaterial color="#9fc4e8" emissive="#3a5d80" emissiveIntensity={0.6} roughness={0.1} metalness={0.2} />
      </mesh>
      {[[0, 0.72, 0, 1.6, 0.05], [0, -0.72, 0, 1.6, 0.05], [0, 0, 0.77, 0.05, 1.5], [0, 0, -0.77, 0.05, 1.5]].map(([x, yy, z, w, h], i) => (
        <Box key={i} position={[x!, yy!, z!]} args={[0.08, h!, w!]} color="#f2f2f2" />
      ))}
      <Box position={[0.04, 0.78, 0]} args={[0.1, 0.1, 1.58]} color="#e4e4e4" />
      <mesh ref={blind} position={[0.03, 0, 0]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[1.48, 1.4]} />
        <meshStandardMaterial color="#d9cfc1" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

const LOCK_LED: Record<string, string> = { locked: '#3ddc97', unlocked: '#ffb020', open: '#ffb020', jammed: '#ff4d4f' }
function DoorLock({ e }: { e: HassEntity }) {
  return (
    <group>
      {[1, -1].map((s) => (
        <group key={s} position={[s * 0.035, 0, 0]}>
          <Box args={[0.02, 0.18, 0.07]} color="#2b2f35" metalness={0.5} roughness={0.3} />
          <Led color={LOCK_LED[e.state] ?? '#5ab0ff'} position={[s * 0.012, 0.06, 0]} r={0.008} blink={e.state.endsWith('ing')} />
        </group>
      ))}
    </group>
  )
}

const Puck = ({ r, h, color = BODY }: { r: number; h: number; color?: string }) => (
  <mesh>
    <cylinderGeometry args={[r, r, h, 32]} />
    <meshStandardMaterial color={color} roughness={0.4} />
  </mesh>
)

function Smoke({ e }: { e: HassEntity }) {
  return (
    <group>
      <Puck r={0.07} h={0.04} />
      <Led color={tripped(e) ? '#ff4d4f' : '#3ddc97'} position={[0.03, -0.022, 0]} r={0.008} blink={tripped(e)} />
    </group>
  )
}
function Leak({ e }: { e: HassEntity }) {
  return (
    <group>
      <Puck r={0.045} h={0.025} color="#f4f6f8" />
      <Led color={tripped(e) ? '#4fb3ff' : '#3a3f45'} position={[0, 0.014, 0]} r={0.008} blink={tripped(e)} />
    </group>
  )
}
function Motion({ e }: { e: HassEntity }) {
  return (
    <group>
      <Box args={[0.05, 0.09, 0.07]} />
      <mesh position={[0.03, 0, 0]}>
        <sphereGeometry args={[0.03, 16, 12, 0, Math.PI]} />
        <meshStandardMaterial color="#f7f7f7" roughness={0.2} transparent opacity={0.9} />
      </mesh>
      <Led color={tripped(e) ? '#ffb020' : '#3a3f45'} position={[0.03, -0.035, 0]} r={0.006} />
    </group>
  )
}
function Siren({ e }: { e: HassEntity }) {
  return (
    <group>
      <Box args={[0.06, 0.16, 0.16]} />
      <mesh position={[0.06, 0, 0]} rotation-z={-Math.PI / 2}>
        <sphereGeometry args={[0.06, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={isOn(e) ? '#ff4d4f' : '#8a2a2c'} emissive={isOn(e) ? '#ff2a2a' : '#000'} emissiveIntensity={2} transparent opacity={0.85} />
      </mesh>
    </group>
  )
}
function Keypad({ e }: { e: HassEntity }) {
  const screen = useScreen(160, 220, (g) => {
    g.fillStyle = alarmColor(e.state)
    g.font = '700 30px system-ui, sans-serif'
    g.fillText(e.state === 'disarmed' ? 'OFF' : e.state === 'triggered' ? 'ALARM' : e.state.startsWith('armed') ? 'ARMED' : '…', 80, 50)
    g.fillStyle = '#3a404a'
    for (let i = 0; i < 9; i++) g.fillRect(28 + (i % 3) * 38, 95 + Math.floor(i / 3) * 38, 28, 28)
  }, [e.state])
  return (
    <group>
      <Box args={[0.03, 0.22, 0.16]} color="#1d2126" />
      <mesh position={[0.016, 0, 0]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[0.14, 0.19]} />
        <meshBasicMaterial map={screen} toneMapped={false} />
      </mesh>
    </group>
  )
}
function Tv() {
  return (
    <group>
      <Box args={[0.05, 0.68, 1.2]} color="#121418" metalness={0.4} roughness={0.3} />
    </group>
  )
}
function Speaker({ e }: { e: HassEntity }) {
  return (
    <group>
      <mesh>
        <cylinderGeometry args={[0.1, 0.11, 1.0, 28]} />
        <meshStandardMaterial color="#2a2e34" roughness={0.8} />
      </mesh>
      <Led color={e.state === 'playing' ? '#3ddc97' : e.state === 'paused' ? '#ffb020' : '#3a3f45'} position={[0, 0.51, 0]} r={0.012} />
    </group>
  )
}
function Voice({ e }: { e: HassEntity }) {
  const col = e.state === 'listening' ? '#5ab0ff' : e.state === 'processing' ? '#b48cff' : e.state === 'responding' ? '#3ddc97' : '#dfe7ef'
  return (
    <group>
      {/* a small side table to stand on */}
      <mesh position={[0, -0.36, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.03, 32]} />
        <meshStandardMaterial color="#b08a62" roughness={0.6} />
      </mesh>
      <mesh position={[0, -0.53, 0]}>
        <cylinderGeometry args={[0.03, 0.04, 0.34, 10]} />
        <meshStandardMaterial color={DARK} />
      </mesh>
      <mesh position={[0, -0.31, 0]}>
        <cylinderGeometry args={[0.07, 0.08, 0.07, 32]} />
        <meshStandardMaterial color="#e9ecef" roughness={0.5} />
      </mesh>
      <mesh position={[0, -0.27, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.05, 0.065, 40]} />
        <meshBasicMaterial color={col} toneMapped={false} />
      </mesh>
    </group>
  )
}
function Camera({ e }: { e: HassEntity }) {
  return (
    <group rotation-z={-0.42}>
      <Box args={[0.16, 0.08, 0.08]} color="#eef1f4" />
      <mesh position={[0.085, 0, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.025, 0.025, 0.02, 20]} />
        <meshStandardMaterial color="#0c0e11" roughness={0.2} />
      </mesh>
      <Box position={[-0.1, 0.02, 0]} args={[0.06, 0.03, 0.03]} color="#d0d4d9" />
      <Led color={e.state === 'recording' ? '#ff4d4f' : e.state === 'off' ? '#3a3f45' : '#5ab0ff'} position={[0.08, 0.035, 0.025]} r={0.006} />
    </group>
  )
}
function Router({ e }: { e: HassEntity }) {
  return (
    <group>
      {/* the desk it stands on */}
      <Box position={[0.1, -0.05, 0]} args={[0.8, 0.04, 1.4]} color="#b08a62" roughness={0.6} />
      <Box position={[0.1, -0.42, 0.6]} args={[0.6, 0.7, 0.04]} color="#9b7653" />
      <Box position={[0.1, -0.42, -0.6]} args={[0.6, 0.7, 0.04]} color="#9b7653" />
      <Box position={[0, 0.0, 0]} args={[0.27, 0.05, 0.4]} color="#2b2f35" metalness={0.25} />
      {[-0.12, -0.04, 0.04, 0.12].map((z) => (
        <mesh key={z} position={[-0.1, 0.14, z]} rotation-z={0.15}>
          <capsuleGeometry args={[0.012, 0.24, 4, 10]} />
          <meshStandardMaterial color="#24282d" />
        </mesh>
      ))}
      {[-0.1, -0.05, 0, 0.05, 0.1].map((z) => <Led key={z} color={tripped(e) ? '#5ce1c6' : '#ff4d4f'} position={[0.137, 0, z]} r={0.006} />)}
    </group>
  )
}
function VacuumDock() {
  return (
    <group>
      <Box position={[-0.05, 0, 0]} args={[0.12, 0.3, 0.34]} color="#2a2e34" />
      <Box position={[0.12, -0.13, 0]} args={[0.26, 0.02, 0.34]} color="#3a3f46" />
    </group>
  )
}
function MowerDock() {
  return (
    <group>
      <Box position={[0, -0.1, 0]} args={[0.8, 0.03, 0.7]} color="#3a3f46" />
      <Box position={[0.3, 0.05, 0]} args={[0.12, 0.3, 0.5]} color="#2a2e34" />
    </group>
  )
}
function Heater({ e }: { e: HassEntity }) {
  const fins = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f1f1f1', emissive: '#000', roughness: 0.5 }), [])
  const k = useRef(0)
  useFrame((_, dt) => {
    k.current = approach(k.current, Math.min(1, Number(e.attributes.current_power_w ?? 0) / 1800), dt, 1.5)
    fins.emissive.set('#ff5a1f').multiplyScalar(k.current * 0.6)
  })
  return (
    <group>
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[0, 0, -0.52 + i * 0.13]} material={fins}>
          <boxGeometry args={[0.08, 0.55, 0.1]} />
        </mesh>
      ))}
      <Box position={[0, -0.33, -0.45]} args={[0.08, 0.12, 0.04]} color={DARK} />
      <Box position={[0, -0.33, 0.45]} args={[0.08, 0.12, 0.04]} color={DARK} />
    </group>
  )
}
function Plug() {
  return <Box args={[0.03, 0.08, 0.06]} color="#f4f6f8" />
}
function Boiler() {
  return (
    <group>
      <mesh>
        <cylinderGeometry args={[0.3, 0.3, 1.6, 36]} />
        <meshStandardMaterial color="#e8ebee" roughness={0.35} metalness={0.15} />
      </mesh>
      <mesh position={[0, 0.82, 0]}>
        <sphereGeometry args={[0.3, 36, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#e8ebee" roughness={0.35} metalness={0.15} />
      </mesh>
    </group>
  )
}
function Valve({ e }: { e: HassEntity }) {
  const handle = useRef<THREE.Group>(null)
  const p = useRef(openness(e))
  useFrame((_, dt) => {
    p.current = approach(p.current, openness(e), dt, 6)
    // a quarter turn: in line with the pipe open, across it closed
    if (handle.current) handle.current.rotation.x = (1 - p.current) * (Math.PI / 2)
  })
  return (
    <group>
      <mesh rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.06, 0.06, 0.16, 20]} />
        <meshStandardMaterial color="#b9893f" metalness={0.7} roughness={0.3} />
      </mesh>
      <group ref={handle} position={[0.09, 0, 0]}>
        <Box args={[0.03, 0.03, 0.22]} color={openness(e) > 0.5 ? '#3ddc97' : '#ff4d4f'} />
      </group>
    </group>
  )
}
/** Eases towards a cover's openness, for the bodies that move with it. */
function useOpen(e: HassEntity) {
  const p = useRef(openness(e))
  useFrame((_, dt) => {
    p.current = approach(p.current, openness(e), dt, 8)
  })
  return p
}

/** Two curtain panels that draw back to the sides as the cover opens. */
function Curtain({ e }: { e: HassEntity }) {
  const l = useRef<THREE.Mesh>(null)
  const r = useRef<THREE.Mesh>(null)
  const p = useOpen(e)
  useFrame(() => {
    const w = 0.92 - p.current * 0.72
    for (const [m, s] of [[l.current, -1], [r.current, 1]] as const) {
      if (!m) continue
      m.scale.z = w / 0.92
      m.position.z = s * (0.92 - w / 2)
    }
  })
  return (
    <group>
      <mesh position={[-0.03, 0, 0]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[1.7, 1.9]} />
        <meshStandardMaterial color="#9fc4e8" emissive="#3a5d80" emissiveIntensity={0.6} />
      </mesh>
      <Box position={[0.08, 1.08, 0]} args={[0.03, 0.03, 2]} color={DARK} metalness={0.5} />
      {[l, r].map((ref, i) => (
        <mesh key={i} ref={ref} position={[0.06, 0, 0]}>
          <boxGeometry args={[0.04, 2.1, 0.92]} />
          <meshStandardMaterial color="#b9a38a" roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}

/** A sectional garage door that slides up into the ceiling as it opens. */
function Garage({ e }: { e: HassEntity }) {
  const door = useRef<THREE.Group>(null)
  const p = useOpen(e)
  useFrame(() => {
    if (!door.current) return
    door.current.scale.y = Math.max(0.04, 1 - p.current)
    door.current.position.y = 1.2 - (2.4 * door.current.scale.y) / 2
  })
  return (
    <group>
      <group ref={door}>
        {Array.from({ length: 5 }, (_, i) => <Box key={i} position={[0.02, -0.96 + i * 0.48, 0]} args={[0.05, 0.46, 2.4]} color="#d9dde2" />)}
      </group>
      <Box position={[0.1, 1.28, 0]} args={[0.18, 0.16, 2.5]} color="#aab0b7" />
    </group>
  )
}

/** A roller shutter outside a window: slats roll down as it closes. */
function Shutter({ e }: { e: HassEntity }) {
  const slats = useRef<THREE.Mesh>(null)
  const p = useOpen(e)
  useFrame(() => {
    if (!slats.current) return
    const down = Math.max(0.03, 1 - p.current)
    slats.current.scale.y = down
    slats.current.position.y = 0.6 - (1.2 * down) / 2
  })
  return (
    <group>
      <mesh position={[-0.03, 0, 0]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[1.2, 1.2]} />
        <meshStandardMaterial color="#9fc4e8" emissive="#3a5d80" emissiveIntensity={0.6} />
      </mesh>
      <mesh ref={slats} position={[0.04, 0, 0]}>
        <boxGeometry args={[0.03, 1.2, 1.22]} />
        <meshStandardMaterial color="#8e959d" metalness={0.4} roughness={0.5} />
      </mesh>
      <Box position={[0.06, 0.66, 0]} args={[0.14, 0.14, 1.3]} color="#7d848c" />
    </group>
  )
}

/** A garden gate that swings open on its hinge. */
function Gate({ e }: { e: HassEntity }) {
  const leaf = useRef<THREE.Group>(null)
  const p = useOpen(e)
  useFrame(() => {
    if (leaf.current) leaf.current.rotation.y = p.current * 1.4
  })
  return (
    <group>
      {[-0.95, 0.95].map((z) => <Box key={z} position={[0, 0, z]} args={[0.1, 1.3, 0.1]} color="#4a3a2c" />)}
      <group ref={leaf} position={[0, 0, -0.9]}>
        {Array.from({ length: 7 }, (_, i) => <Box key={i} position={[0, 0, 0.13 + i * 0.26]} args={[0.04, 1.1, 0.16]} color="#8a6a4c" />)}
        <Box position={[0, 0.35, 0.9]} args={[0.05, 0.08, 1.8]} color="#6e5338" />
        <Box position={[0, -0.35, 0.9]} args={[0.05, 0.08, 1.8]} color="#6e5338" />
      </group>
    </group>
  )
}

function WeatherStation() {
  const cups = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (cups.current) cups.current.rotation.y += dt * 4
  })
  return (
    <group>
      <mesh position={[0, -0.9, 0]}>
        <cylinderGeometry args={[0.025, 0.03, 1.8, 10]} />
        <meshStandardMaterial color="#c9cdd2" metalness={0.5} />
      </mesh>
      <Box position={[0, -0.45, 0.1]} args={[0.14, 0.2, 0.14]} />
      <group ref={cups} position={[0, 0.35, 0]}>
        {[0, 1, 2].map((i) => (
          <group key={i} rotation-y={(i * Math.PI * 2) / 3}>
            <Box position={[0.09, 0, 0]} args={[0.18, 0.01, 0.01]} color="#c9cdd2" />
            <mesh position={[0.18, 0, 0]}>
              <sphereGeometry args={[0.03, 10, 8, 0, Math.PI]} />
              <meshStandardMaterial color="#f2f4f6" side={THREE.DoubleSide} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  )
}

function Doorbell({ e }: { e: HassEntity }) {
  const since = (Date.now() - Date.parse(e.state)) / 1000
  return (
    <group>
      <Box args={[0.025, 0.13, 0.05]} color="#1d2126" />
      <Led color={Number.isFinite(since) && since < 4 ? '#ffd166' : '#5ab0ff'} position={[0.014, -0.03, 0]} r={0.012} />
      <mesh position={[0.014, 0.035, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.009, 0.009, 0.004, 16]} />
        <meshStandardMaterial color="#0b0d10" />
      </mesh>
    </group>
  )
}

function SensorPuck({ e }: { e: HassEntity }) {
  return (
    <group rotation-z={-Math.PI / 2}>
      <Puck r={0.045} h={0.02} />
      <Led color={tripped(e) ? '#ff4d4f' : '#3ddc97'} position={[0, 0.012, 0.025]} r={0.006} />
    </group>
  )
}

function Remote({ e }: { e: HassEntity }) {
  return (
    <group>
      {/* the coffee table it lies on */}
      <Box position={[0, -0.03, 0.3]} args={[0.7, 0.04, 1.2]} color="#b08a62" roughness={0.6} />
      {[[-0.3, -0.5], [0.3, -0.5], [-0.3, 1.1], [0.3, 1.1]].map(([x, z], i) => <Box key={i} position={[x!, -0.25, z! * 0.75 + 0.12]} args={[0.04, 0.4, 0.04]} color={DARK} />)}
      <Box position={[0, 0.01, 0]} args={[0.05, 0.02, 0.18]} color="#25292e" />
      <Led color={isOn(e) ? '#ffd166' : '#3a3f45'} position={[0, 0.022, -0.07]} r={0.005} />
    </group>
  )
}

function IrBlaster() {
  return (
    <group>
      <mesh>
        <cylinderGeometry args={[0.05, 0.055, 0.035, 28]} />
        <meshStandardMaterial color="#25292e" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <sphereGeometry args={[0.03, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#5b1a2e" roughness={0.2} transparent opacity={0.85} />
      </mesh>
    </group>
  )
}

function Humidifier({ e }: { e: HassEntity }) {
  const col = isOn(e) ? (e.attributes.action === 'humidifying' ? '#5ab0ff' : '#3ddc97') : '#3a3f45'
  return (
    <group>
      <mesh>
        <cylinderGeometry args={[0.13, 0.16, 0.5, 32]} />
        <meshStandardMaterial color="#eef1f4" roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 0.04, 20]} />
        <meshStandardMaterial color="#cfd5db" />
      </mesh>
      <mesh position={[0, 0.1, 0.13]} rotation-x={Math.PI / 2}>
        <ringGeometry args={[0.025, 0.035, 24]} />
        <meshBasicMaterial color={col} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** A washing machine that shakes while its vibration sensor is on. */
function Washer({ e }: { e: HassEntity }) {
  const body = useRef<THREE.Group>(null)
  const drum = useRef<THREE.Mesh>(null)
  useFrame((st, dt) => {
    const on = tripped(e)
    if (body.current) body.current.position.z = on ? Math.sin(st.clock.elapsedTime * 50) * 0.006 : 0
    if (drum.current && on) drum.current.rotation.x += dt * 9
  })
  return (
    <group ref={body}>
      <Box args={[0.6, 0.85, 0.6]} color="#f2f4f6" />
      <mesh ref={drum} position={[0.305, 0.02, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.2, 0.2, 0.02, 32]} />
        <meshStandardMaterial color="#5b6672" metalness={0.5} roughness={0.2} transparent opacity={0.8} />
      </mesh>
      <Box position={[0.305, 0.36, 0]} args={[0.01, 0.08, 0.5]} color="#d6dbe0" />
    </group>
  )
}

function Freezer({ e }: { e: HassEntity }) {
  const door = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (door.current) door.current.rotation.y = approach(door.current.rotation.y, tripped(e) ? -0.35 : 0, dt, 5)
  })
  return (
    <group>
      <Box args={[0.6, 1.6, 0.6]} color="#e9edf1" />
      <group ref={door} position={[0.31, 0, 0.3]}>
        <Box position={[0.02, 0, -0.3]} args={[0.04, 1.58, 0.6]} color="#f6f8fa" />
        <Box position={[0.05, 0.2, -0.52]} args={[0.02, 0.4, 0.03]} color="#9aa3ad" />
      </group>
    </group>
  )
}

export function Panel() {
  return (
    <group>
      <Box args={[0.1, 0.6, 0.4]} color="#c9cdd2" metalness={0.4} roughness={0.35} />
      <Box position={[0.051, 0.18, 0]} args={[0.005, 0.1, 0.3]} color="#2a2e34" />
    </group>
  )
}

export function LabBody({ model, e, position, rotationY }: { model: LabModel; e: HassEntity; position: [number, number, number]; rotationY: number }) {
  const body = (() => {
    switch (model) {
      case 'wall-ac': return <WallAc e={e} />
      case 'pendant': return <Pendant e={e} />
      case 'floor-lamp': return <FloorLamp e={e} />
      case 'ceiling-fan': return <CeilingFan e={e} />
      case 'floor-fan': return <FloorFan e={e} />
      case 'wall-sensor': return <WallSensor e={e} />
      case 'blind': return <Blind e={e} />
      case 'door-lock': return <DoorLock e={e} />
      case 'smoke': return <Smoke e={e} />
      case 'leak': return <Leak e={e} />
      case 'motion': return <Motion e={e} />
      case 'siren': return <Siren e={e} />
      case 'keypad': return <Keypad e={e} />
      case 'tv': return <Tv />
      case 'speaker': return <Speaker e={e} />
      case 'voice': return <Voice e={e} />
      case 'camera': return <Camera e={e} />
      case 'router': return <Router e={e} />
      case 'vacuum-dock': return <VacuumDock />
      case 'mower-dock': return <MowerDock />
      case 'heater': return <Heater e={e} />
      case 'plug': return <Plug />
      case 'boiler': return <Boiler />
      case 'valve': return <Valve e={e} />
      case 'curtain': return <Curtain e={e} />
      case 'garage': return <Garage e={e} />
      case 'shutter': return <Shutter e={e} />
      case 'gate': return <Gate e={e} />
      case 'weather-station': return <WeatherStation />
      case 'doorbell': return <Doorbell e={e} />
      case 'puck': return <SensorPuck e={e} />
      case 'remote': return <Remote e={e} />
      case 'ir': return <IrBlaster />
      case 'humidifier': return <Humidifier e={e} />
      case 'washer': return <Washer e={e} />
      case 'freezer': return <Freezer e={e} />
      default: return null
    }
  })()
  return (
    <group position={position} rotation-y={rotationY}>
      {body}
    </group>
  )
}

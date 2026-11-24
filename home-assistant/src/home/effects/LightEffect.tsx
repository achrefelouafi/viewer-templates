import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { lightColor, lightLevel, type Anchor, type HassEntity } from '../entities'
import { N, shader } from '../tsl'
import { additive, additiveSprite, approach } from './common'

const { uniform, uv } = N

/** Family "light": a real light, the beam it throws, the halo round the fitting and the pool it
    leaves on the floor, all following brightness and colour. Ceiling fittings throw a beam;
    wall, table and floor lamps glow and pool. */
export function LightEffect({ entity, anchor, floorY }: { entity: HassEntity; anchor: Anchor; floorY: number }) {
  const [x, y, z] = anchor.position
  const drop = Math.max(0.4, y - floorY)
  const ceiling = anchor.mount === 'ceiling'
  const k = useRef(0)
  const color = useRef(new THREE.Color(lightColor(entity)))
  const want = useMemo(() => new THREE.Color(), [])
  const pool = useMemo(() => additive('#fff'), [])
  const halo = useMemo(() => additiveSprite(), [])
  const beam = useMemo(
    () =>
      shader(
        { uColor: uniform(new THREE.Color('#fff')), uA: uniform(0) },
        (u) => {
          const h = uv().y
          return { color: u.uColor, opacity: u.uA.mul(h).mul(h).mul(0.3) }
        },
        { transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending },
      ),
    [],
  )
  const light = useRef<THREE.PointLight>(null)
  const gl = useThree((s) => s.gl)

  useFrame((_, dt) => {
    k.current = approach(k.current, lightLevel(entity), dt, 5)
    color.current.lerp(want.set(lightColor(entity)), 1 - Math.exp(-dt * 5))
    pool.color.copy(color.current)
    halo.color.copy(color.current)
    pool.opacity = k.current * 0.55
    halo.opacity = k.current * 0.5
    beam.uniforms.uColor.value.copy(color.current)
    beam.uniforms.uA.value = k.current
    if (light.current) {
      light.current.color.copy(color.current)
      // Pascal's daylight meters exposure for the time of day (several times brighter at dusk and
      // night); a real light has to stay the same lamp under it, so it divides the boost back out
      light.current.intensity = (k.current * (ceiling ? 9 : 6)) / Math.max(1, gl.toneMappingExposure)
    }
  })

  const spread = ceiling ? drop * 0.62 : drop * 0.45
  return (
    <group position={[x, y, z]} rotation-y={anchor.rotationY}>
      <pointLight ref={light} position={[0, -0.12, 0]} intensity={0} distance={ceiling ? drop * 3.2 : 5} decay={1.6} />
      <sprite position={[0, -0.05, 0]} material={halo} scale={ceiling ? 0.9 : 1.2} />
      {ceiling && (
        <mesh position={[0, -drop / 2, 0]} material={beam} renderOrder={6}>
          <cylinderGeometry args={[0.16, spread, drop, 32, 1, true]} />
        </mesh>
      )}
      <mesh position={[0, floorY - y + 0.025, 0]} rotation-x={-Math.PI / 2} material={pool} renderOrder={5}>
        <planeGeometry args={[spread * 3.2, spread * 3.2]} />
      </mesh>
    </group>
  )
}

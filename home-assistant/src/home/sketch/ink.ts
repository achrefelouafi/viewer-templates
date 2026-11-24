import { Color, type Material, Vector2, Vector4 } from 'three'
import {
  bool,
  Break,
  cameraPosition,
  clamp,
  cross,
  diffuseColor,
  dFdx,
  dFdy,
  dot,
  exp,
  float,
  Fn,
  If,
  int,
  length,
  Loop,
  max,
  mix,
  mrt,
  normalize,
  normalView,
  output,
  packNormalToRGB,
  positionWorld,
  select,
  sign,
  smoothstep,
  step,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, type NodeMaterial, type WebGPURenderer } from 'three/webgpu'

/**
 * The guided tour's look, the monograph's X-ray ported to TSL so it draws in Pascal's own
 * WebGPU renderer: the house as frosted glass and pale ghosts, and one room at a time developed
 * back into its real colours, a circle growing from the room's centre inside its outline.
 *
 * Every ink copy of a viewer material (`xrayMaterial`) and every outline reads the same `ink`
 * uniforms, so one write per frame moves them all.
 */

/** Room outlines with more corners than this fall back to their bounding box. */
export const MAX_OUTLINE = 32

export type InkTheme = 'paper' | 'noir'

/** The X-ray's palettes, light and dark (display colours, converted to linear by `Color`). */
export const THEMES: Record<InkTheme, {
  paper: string; ink: string; floor: string; ground: string; shell: string; shellAlpha: number
  glow: string; ghost: string; ghostAlpha: number; shade: number
}> = {
  paper: {
    paper: '#f2f1ec', ink: '#2b2d31', floor: '#e3e1da', ground: '#eae8e2',
    shell: '#ffffff', shellAlpha: 0.22, glow: '#000000', ghost: '#f3f2ee', ghostAlpha: 0.42, shade: 0.16,
  },
  noir: {
    paper: '#08090a', ink: '#f1f3f6', floor: '#131518', ground: '#0c0d0f',
    shell: '#b9c2cc', shellAlpha: 0.1, glow: '#3a4048', ghost: '#cfd4da', ghostAlpha: 0.2, shade: 0.35,
  },
}

/** How a part of the house is drawn in X-ray. */
export type SurfaceClass = 'shell' | 'floor' | 'ghost' | 'planting' | 'ground'

export const ink = {
  ink: uniform(new Color(THEMES.paper.ink)),
  floor: uniform(new Color(THEMES.paper.floor)),
  ground: uniform(new Color(THEMES.paper.ground)),
  shell: uniform(new Color(THEMES.paper.shell)),
  shellAlpha: uniform(THEMES.paper.shellAlpha),
  glow: uniform(new Color(THEMES.paper.glow)),
  ghost: uniform(new Color(THEMES.paper.ghost)),
  ghostAlpha: uniform(THEMES.paper.ghostAlpha),
  shade: uniform(THEMES.paper.shade),
  houseCentre: uniform(new Vector2()),
  /** 0: the whole house in X-ray; huge: the whole house in its own colours. */
  houseRadius: uniform(1e5),
  houseFeather: uniform(2.5),
  houseGlow: uniform(0),
  roomOn: uniform(0),
  // vec4s: arrays of vec2 pad differently between the WebGPU and WebGL2 backends.
  roomOutline: uniformArray(Array.from({ length: MAX_OUTLINE }, () => new Vector4()), 'vec4'),
  roomCorners: uniform(0),
  /** The room's floor and ceiling heights in the world. */
  roomFloor: uniform(new Vector2(-1e4, 1e4)),
  roomCentre: uniform(new Vector2()),
  roomRadius: uniform(0),
  roomGlow: uniform(0),
  /** How far the outlines have been drafted out from `draftCentre`, in metres. */
  draft: uniform(0),
  draftCentre: uniform(new Vector2()),
  /** The whole sketch's fade, 0..1. */
  lines: uniform(0),
}

export function setInkTheme(theme: InkTheme) {
  const t = THEMES[theme]
  ink.ink.value.set(t.ink)
  ink.floor.value.set(t.floor)
  ink.ground.value.set(t.ground)
  ink.shell.value.set(t.shell)
  ink.shellAlpha.value = t.shellAlpha
  ink.glow.value.set(t.glow)
  ink.ghost.value.set(t.ghost)
  ink.ghostAlpha.value = t.ghostAlpha
  ink.shade.value = t.shade
}

/** Room outline in world x/z, closed, at most `MAX_OUTLINE` corners (else its bounding box). */
export function setRoomOutline(points: readonly [number, number][]) {
  let shape = points
  if (shape.length > MAX_OUTLINE) {
    const xs = points.map((p) => p[0])
    const zs = points.map((p) => p[1])
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]
    shape = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
  }
  const array = ink.roomOutline.array as Vector4[]
  shape.forEach(([x, z], i) => array[i]!.set(x, z, 0, 0))
  ink.roomCorners.value = shape.length
}

/**
 * A TSL node. three's TSL typings can't follow swizzles and mixed float/vec maths through
 * generic code like this, so the graph below is typed loosely; the shaders are checked when built.
 */
// biome-ignore lint/suspicious/noExplicitAny: see above
type N = any

/** Signed distance to the room outline, positive inside. */
const roomDistance: (p: N) => N = Fn(([p]: [N]) => {
  const corners: N = int(ink.roomCorners)
  const inside = float(0).toVar()
  const d = float(1e4).toVar()
  Loop({ start: int(0), end: int(MAX_OUTLINE), type: 'int', condition: '<' }, ({ i }: { i: N }) => {
    If(i.greaterThanEqual(corners), () => {
      Break()
    })
    const j: N = select(i.equal(0), corners.sub(1), i.sub(1))
    const a: N = (ink.roomOutline.element(i) as N).xy.toVar()
    const b: N = (ink.roomOutline.element(j) as N).xy.toVar()
    const crosses = a.y.greaterThan(p.y).notEqual(b.y.greaterThan(p.y))
    const at = b.x.sub(a.x).mul(p.y.sub(a.y)).div(b.y.sub(a.y)).add(a.x)
    If(crosses.and(p.x.lessThan(at)), () => {
      inside.assign(float(1).sub(inside))
    })
    const pa = p.sub(a)
    const ba = b.sub(a)
    const h = clamp(dot(pa, ba).div(max(dot(ba, ba), 1e-6)), 0, 1)
    d.assign(d.min(length(pa.sub(ba.mul(h)))))
  })
  return select(corners.lessThan(3), float(-1e4), select(inside.greaterThan(0.5), d, d.negate()))
}) as N

const square = (x: N): N => x.mul(x)

/** x: how developed this point is (0 X-ray, 1 render). y: the glow of a moving front. */
export const develop: (w: N) => N = Fn(([w]: [N]) => {
  const dh: N = length(w.xz.sub(ink.houseCentre))
  const R: N = ink.houseRadius
  const F: N = ink.houseFeather
  const house = float(1).sub(smoothstep(R.sub(F), R, dh))
  const houseRing = exp(square(dh.sub(R).add(F.mul(0.5)).div(F.mul(0.07))).negate()).mul(ink.houseGlow).mul(0.4)
  // The room: inside its outline up to its walls' inner faces, never the far side of a wall
  // (a wall is at least 6 cm thick), on its floor, inside its front.
  const inRoom: N = smoothstep(-0.06, 0, roomDistance(w.xz))
    .mul(step(ink.roomFloor.x, w.y)).mul(step(w.y, ink.roomFloor.y)).mul(ink.roomOn)
  const dr: N = length(w.xz.sub(ink.roomCentre))
  const room = inRoom.mul(float(1).sub(smoothstep(ink.roomRadius.sub(0.9), ink.roomRadius, dr)))
  // A thin line, the edge of the developing print.
  const roomRing = inRoom.mul(exp(square(dr.sub(ink.roomRadius).add(0.45).div(0.06)).negate())).mul(ink.roomGlow).mul(0.7)
  return vec2(max(house, room), clamp(max(houseRing, roomRing), 0, 1))
}) as N

const LIGHT: N = normalize(vec3(-0.45, 0.82, 0.36))

/** The X-ray colour and alpha of one surface class at a point. */
function xrayOf(surface: SurfaceClass, storey: N, w: N): { colour: N; alpha: N } {
  // The face's normal from the screen-space derivatives, turned towards the eye.
  const flat: N = normalize(cross(dFdx(w) as N, dFdy(w) as N))
  const n: N = flat.mul(sign(dot(flat, cameraPosition.sub(w))))
  const lit: N = clamp(dot(n, LIGHT).mul(0.5).add(0.5), 0, 1)
  const shade: N = float(1).sub(ink.shade.mul(float(1).sub(lit)))
  switch (surface) {
    case 'shell': {
      // Height within its storey: glass reads denser towards the top, like frosted panes.
      const h = clamp(w.y.sub(storey.x).div(max(storey.y, 0.5)), 0, 1)
      return {
        colour: ink.shell.mul(shade).add(ink.glow.mul(smoothstep(0.45, 1, h))),
        alpha: ink.shellAlpha.mul(mix(0.35, 1, smoothstep(0, 1, h))),
      }
    }
    case 'floor':
      return { colour: ink.floor.mul(mix(0.94, 1, lit)), alpha: float(1) }
    case 'ghost':
      return { colour: ink.ghost.mul(shade), alpha: ink.ghostAlpha }
    case 'planting':
      return { colour: ink.ghost.mul(shade), alpha: ink.ghostAlpha.mul(0.5) }
    case 'ground':
      return { colour: ink.ground as N, alpha: float(1) }
  }
}

/** Keys of a classic material that must not be copied onto its node twin. */
const OWN_KEYS = new Set(['uuid', 'id', 'type', 'version', '_listeners'])

/** The material as a node material of its own, as three's renderer converts it, never shared. */
function nodeCopy(source: Material, renderer: WebGPURenderer | null): NodeMaterial {
  if ((source as NodeMaterial).isNodeMaterial) return (source as NodeMaterial).clone()
  const library = (renderer as unknown as { library?: { getMaterialNodeClass(type: string): (new () => NodeMaterial) | null } } | null)?.library
  const NodeClass = library?.getMaterialNodeClass(source.type) ?? MeshStandardNodeMaterial
  const material = new NodeClass()
  const target = material as unknown as Record<string, unknown>
  for (const key in source) {
    if (OWN_KEYS.has(key)) continue
    const value = (source as unknown as Record<string, unknown>)[key]
    if (typeof value === 'function') continue
    target[key] = value
  }
  material.name = source.name
  return material
}

/** Where colour has come in: the developed copy draws here, the X-ray copy everywhere else. */
export const SEAM = 0.5

/** Both masks: the material's own (an item's cut-outs) and the develop seam. */
function masked(source: Material, seam: N): N {
  const own = (source as NodeMaterial).maskNode as N
  return own ? bool(own).and(seam) : seam
}

/**
 * The viewer's material as it is, drawn only where the house or the room has developed. It
 * keeps everything of the original (transparency, depth, sides, MRT), so a developed room is the
 * viewer's own render; the moving front adds a thin line of ink. Shadows are cast whole, so the
 * light in a room is the light the viewer gives it.
 */
export function developedMaterial(source: Material, renderer: WebGPURenderer | null): NodeMaterial {
  const material = nodeCopy(source, renderer)
  const base: N = material.outputNode ?? output
  const d: N = develop(positionWorld)
  material.outputNode = vec4(mix(base.rgb, ink.ink, d.y.mul(0.65)), base.a)
  material.maskNode = masked(source, d.x.greaterThanEqual(SEAM))
  const ownShadow = (source as NodeMaterial).maskShadowNode ?? (source as NodeMaterial).maskNode
  material.maskShadowNode = ownShadow ?? bool(true)
  material.needsUpdate = true
  return material
}

/**
 * A copy of a viewer material that draws in X-ray until developed. `surface` picks the X-ray
 * treatment; `storey` is the floor height and storey height it sits in, for the glass.
 *
 * Floors and the ground are opaque either way, so they blend X-ray into colour in one material.
 * Glass and ghosts draw only short of the seam (`developedMaterial` draws the rest) and lean
 * towards their own colour as they near it, so nothing developed is ever drawn see-through.
 */
export function xrayMaterial(source: Material, surface: SurfaceClass, storey: [number, number], renderer: WebGPURenderer | null): NodeMaterial {
  const material = nodeCopy(source, renderer)
  const opaque = surface === 'floor' || surface === 'ground'
  // What draws nothing in the viewer (an item's drop zone, a door's pick proxy) is no ghost either.
  if (!source.visible || source.colorWrite === false || (source.transparent && source.opacity <= 0.001)) {
    material.visible = false
    return material
  }
  // Glass and ghosts are see-through. Ghosts keep depth so a chair's legs don't show through its
  // seat; glass doesn't, so what stands behind it shows.
  if (!opaque) {
    material.transparent = true
    material.depthWrite = surface === 'ghost' && !source.transparent
  }
  const storeyUniform = uniform(new Vector2(...storey))
  const base: N = material.outputNode ?? output
  const w: N = positionWorld
  const d: N = develop(w)
  const { colour, alpha } = xrayOf(surface, storeyUniform, w)
  const k: N = opaque ? d.x : clamp(d.x.div(SEAM), 0, 1)
  const rgb = mix(mix(colour, base.rgb, k), ink.ink, d.y.mul(0.65))
  const a = mix(alpha, base.a, k)
  const result: N = vec4(rgb, a)
  material.outputNode = result
  if (!opaque) {
    material.maskNode = masked(source, d.x.lessThan(SEAM))
    material.maskShadowNode = (source as NodeMaterial).maskShadowNode ?? (source as NodeMaterial).maskNode ?? bool(true)
    // The viewer's screen-space ink and AO read the scene pass's normals and colours: glass and
    // ghosts leave them as the developed house wrote them. `output` is written too: a pass
    // without attachments of its own draws this MRT alone.
    material.mrtNode = mrt({
      output: result,
      diffuseColor: vec4(diffuseColor.rgb, 0),
      normal: vec4(packNormalToRGB(normalView), 0),
    })
  }
  material.needsUpdate = true
  return material
}

/** Whether a material's own shape (cut-out leaves, a mask) must survive into its X-ray. */
export function needsOwnXray(source: Material) {
  const m = source as Material & { alphaMap?: unknown; alphaTest: number }
  const n = source as NodeMaterial
  return m.alphaTest > 0 || !!m.alphaMap || !!n.maskNode || !!n.opacityNode || !!n.positionNode
}

/**
 * One X-ray material for every glass or ghost surface that needs nothing of its own: a single
 * shader for the whole class, so starting the tour compiles almost nothing. `side` and
 * `seeThrough` (a source already transparent: glass never writes depth) follow the source.
 */
export function sharedXrayMaterial(surface: SurfaceClass, storey: [number, number], side: number, seeThrough: boolean): NodeMaterial {
  const material = new MeshBasicNodeMaterial()
  material.side = side as Material['side']
  material.transparent = true
  material.depthWrite = surface === 'ghost' && !seeThrough
  const w: N = positionWorld
  const d: N = develop(w)
  const { colour, alpha } = xrayOf(surface, uniform(new Vector2(...storey)), w)
  const result: N = vec4(mix(colour, ink.ink, d.y.mul(0.65)), alpha)
  material.outputNode = result
  material.maskNode = d.x.lessThan(SEAM)
  material.maskShadowNode = bool(true)
  material.mrtNode = mrt({
    output: result,
    diffuseColor: vec4(vec3(0), 0),
    normal: vec4(packNormalToRGB(normalView), 0),
  })
  material.needsUpdate = true
  return material
}

const smoothstepJs = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** `develop(...).x` on the CPU, from the same uniforms: whether a point has developed. */
export function developedAt(x: number, y: number, z: number): number {
  const centre = ink.houseCentre.value as Vector2
  const R = ink.houseRadius.value as number
  const F = ink.houseFeather.value as number
  const house = 1 - smoothstepJs(R - F, R, Math.hypot(x - centre.x, z - centre.y))
  if (house >= 1 || (ink.roomOn.value as number) < 0.5) return house
  const band = ink.roomFloor.value as Vector2
  if (y < band.x || y > band.y) return house
  const rc = ink.roomCentre.value as Vector2
  const rr = ink.roomRadius.value as number
  const front = 1 - smoothstepJs(rr - 0.9, rr, Math.hypot(x - rc.x, z - rc.y))
  if (front <= 0) return house
  // Signed distance to the outline, positive inside.
  const corners = ink.roomCorners.value as number
  const outline = ink.roomOutline.array as Vector4[]
  let inside = false
  let d = 1e4
  for (let i = 0, j = corners - 1; i < corners; j = i++) {
    const a = outline[i]!
    const b = outline[j]!
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) inside = !inside
    const bax = b.x - a.x
    const baz = b.y - a.y
    const h = Math.min(1, Math.max(0, ((x - a.x) * bax + (z - a.y) * baz) / Math.max(bax * bax + baz * baz, 1e-6)))
    d = Math.min(d, Math.hypot(x - a.x - bax * h, z - a.y - baz * h))
  }
  const inRoom = corners < 3 ? 0 : smoothstepJs(-0.06, 0, inside ? d : -d)
  return Math.max(house, inRoom * front)
}

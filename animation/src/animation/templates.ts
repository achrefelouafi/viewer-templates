import * as THREE from 'three'
import { type BuildElement, type BuildPhase, type BuildSet, PHASE_ORDER } from './elements'

/**
 * The animation templates. Each one turns the build into a timeline: for every piece, when it
 * starts, how long it moves and in which motion. The timeline is a pure function of the build, so
 * any moment can be shown at once (scrubbing, replays), and the same project always plays alike.
 */

export type Motion =
  /** Grows up out of the floor from its base. */
  | { kind: 'rise'; overshoot?: number }
  /** Spreads out flat from its centre (slabs, floors). */
  | { kind: 'spread' }
  /** Scales up from its base, with a springy overshoot. */
  | { kind: 'pop'; overshoot?: number }
  /** Falls from `height` metres above and lands with a squash. */
  | { kind: 'drop'; height: number; spin?: number }
  /** Lies flat on its long bottom edge and tilts up into place (tilt-up wall panels). */
  | { kind: 'tilt'; axis: 'x' | 'z'; side: 1 | -1 }
  /** Grows along its longest horizontal side, from one end to the other. */
  | { kind: 'extend'; axis: 'x' | 'z'; side: 1 | -1 }
  /** Flies in from `from` (a world offset) tumbling about `axis`, along an arc. */
  | { kind: 'fly'; from: THREE.Vector3; axis: THREE.Vector3; turns: number; arc: number; hover: number }
  /** An elastic pop as a wave front passes, with a little bump up. */
  | { kind: 'ripple'; bump: number }

export type Track = {
  start: number
  duration: number
  motion: Motion
  /** Puff of dust where it lands (base of its bounds), on arrival. */
  dust?: number
  /** Visible before its start, held at the motion's first pose (exploded views). */
  showBefore?: boolean
}

/** The build's blueprint lines, drawn on before the solids arrive. */
export type LinePlan = {
  /** Per element: when its outline starts drawing, and how long it takes. */
  draw: Map<string, { start: number; duration: number }>
  fadeStart: number
  fadeEnd: number
}

/** Rings that sweep the ground from a point (the ripple's wave fronts). */
export type WavePlan = {
  origin: THREE.Vector3
  waves: Array<{ start: number; speed: number; reach: number; color: string }>
}

export type Timeline = {
  tracks: Map<string, Track>
  duration: number
  lines?: LinePlan
  waves?: WavePlan
  /** The camera turns this many radians over the whole timeline when the cinematic camera is on. */
  orbit: number
}

export type TemplateId = 'blueprint' | 'timelapse' | 'skydrop' | 'magnetic' | 'ripple'

export type AnimationTemplate = {
  id: TemplateId
  name: string
  tagline: string
  /** Accent for the card and the template's overlays. */
  accent: string
  build: (set: BuildSet) => Timeline
}

// ---------------------------------------------------------------------------------------------
// Helpers

const TAU = Math.PI * 2

function byPhase(set: BuildSet): Map<BuildPhase, BuildElement[]> {
  const map = new Map<BuildPhase, BuildElement[]>()
  for (const phase of PHASE_ORDER) map.set(phase, [])
  for (const element of set.elements) map.get(element.phase)!.push(element)
  return map
}

/**
 * Spreads `items` over the window `[from, to]`: the first starts at `from`, the last ends at `to`.
 * Each moves for `duration` (shortened when the window is too tight for it).
 */
function stagger<T>(
  items: readonly T[],
  from: number,
  to: number,
  duration: number,
  assign: (item: T, start: number, duration: number, index: number) => void,
) {
  if (items.length === 0) return
  const span = Math.max(0.05, to - from)
  const d = Math.min(duration, span)
  const step = items.length > 1 ? (span - d) / (items.length - 1) : 0
  items.forEach((item, index) => assign(item, from + step * index, d, index))
}

/** Angle of the element's centre around the build's centre, 0 → 2π from +x, counter-clockwise. */
function angleAround(element: BuildElement, set: BuildSet, offset = 0): number {
  const a = Math.atan2(element.center.z - set.center.z, element.center.x - set.center.x) + offset
  return ((a % TAU) + TAU) % TAU
}

function distanceFrom(element: BuildElement, origin: THREE.Vector3): number {
  return Math.hypot(element.center.x - origin.x, element.center.z - origin.z)
}

/** The longer horizontal side of the element, and which end faces away from the build's centre. */
function longAxis(element: BuildElement, set: BuildSet): { axis: 'x' | 'z'; side: 1 | -1 } {
  const axis = element.size.x >= element.size.z ? 'x' : 'z'
  const across = axis === 'x' ? element.center.z - set.center.z : element.center.x - set.center.x
  return { axis, side: across >= 0 ? 1 : -1 }
}

/** Scales a phase plan so huge projects don't run forever and tiny ones aren't over in a blink. */
function crowd(count: number, base: number, max: number): number {
  return Math.min(max, base + Math.sqrt(Math.max(0, count)) * 0.18)
}

// ---------------------------------------------------------------------------------------------
// 1. Blueprint: the drawing comes first, then the house fills its own lines.

const blueprint: AnimationTemplate = {
  id: 'blueprint',
  name: 'Blueprint',
  tagline: 'Glowing plan lines draw the house, then it fills itself in.',
  accent: '#3aa8ff',
  build(set) {
    const tracks = new Map<string, Track>()
    const phases = byPhase(set)
    const draw = new Map<string, { start: number; duration: number }>()

    // The pen sweeps across the plan, floor by floor, structure before furniture.
    const sweep = [...set.elements].sort((a, b) =>
      (a.phase === 'items' ? 1 : 0) - (b.phase === 'items' ? 1 : 0) ||
      a.storey - b.storey ||
      (a.center.x + a.center.z) - (b.center.x + b.center.z))
    const penEnd = crowd(sweep.length, 2.6, 4.2)
    stagger(sweep, 0.2, penEnd, 0.9, (element, start, duration) => draw.set(element.id, { start, duration }))

    let t = penEnd - 0.6
    const ground = phases.get('ground')!.sort((a, b) => a.storey - b.storey)
    stagger(ground, t, t + 1.2, 0.9, (e, start, duration) => tracks.set(e.id, { start, duration, motion: { kind: 'spread' } }))
    t += 0.9

    const frame = phases.get('frame')!.sort((a, b) => a.storey - b.storey || a.seed - b.seed)
    stagger(frame, t, t + 0.8, 0.6, (e, start, duration) => tracks.set(e.id, { start, duration, motion: { kind: 'rise' } }))

    const walls = phases.get('walls')!.sort((a, b) => a.storey - b.storey ||
      (a.center.x + a.center.z) - (b.center.x + b.center.z))
    const wallsEnd = t + crowd(walls.length, 2.4, 4)
    stagger(walls, t, wallsEnd, 1.1, (e, start, duration) =>
      tracks.set(e.id, { start, duration, motion: { kind: 'rise', overshoot: 0.6 } }))
    t = wallsEnd - 0.5

    const upper = [...phases.get('stairs')!, ...phases.get('ceilings')!, ...phases.get('roof')!]
      .sort((a, b) => a.box.min.y - b.box.min.y)
    stagger(upper, t, t + 1.6, 0.9, (e, start, duration) => tracks.set(e.id, {
      start, duration, motion: e.phase === 'roof' ? { kind: 'drop', height: 2.5 } : { kind: 'rise' },
    }))
    t += 1.2

    const openings = [...phases.get('openings')!, ...phases.get('exterior')!]
      .sort((a, b) => a.storey - b.storey || a.seed - b.seed)
    stagger(openings, t, t + 1.4, 0.6, (e, start, duration) =>
      tracks.set(e.id, { start, duration, motion: { kind: 'pop', overshoot: 1.6 } }))
    t += 1

    const items = phases.get('items')!.sort((a, b) => a.storey - b.storey || distanceFrom(a, set.center) - distanceFrom(b, set.center))
    const itemsEnd = t + crowd(items.length, 1.6, 3)
    stagger(items, t, itemsEnd, 0.7, (e, start, duration) =>
      tracks.set(e.id, { start, duration, motion: { kind: 'pop', overshoot: 2 } }))

    const end = Math.max(itemsEnd, t + 0.8)
    return {
      tracks,
      duration: end + 1.4,
      lines: { draw, fadeStart: end - 0.4, fadeEnd: end + 1.2 },
      orbit: Math.PI / 3,
    }
  },
}

// ---------------------------------------------------------------------------------------------
// 2. Time-lapse: a building site played fast. Slabs poured, wall panels tilted up as a crane
//    swings round, the roof lowered on, then windows and furniture.

const timelapse: AnimationTemplate = {
  id: 'timelapse',
  name: 'Time-lapse',
  tagline: 'A crane swings round: slabs poured, wall panels tilted up, roof lowered on.',
  accent: '#f5a524',
  build(set) {
    const tracks = new Map<string, Track>()
    const phases = byPhase(set)
    let t = 0.2

    for (let storey = 0; storey < set.storeys; storey++) {
      const onStorey = (list: BuildElement[]) => list.filter((e) => e.storey === storey)
      const ground = onStorey(phases.get('ground')!).sort((a, b) => distanceFrom(a, set.center) - distanceFrom(b, set.center))
      stagger(ground, t, t + 1, 0.8, (e, start, duration) => tracks.set(e.id, { start, duration, motion: { kind: 'spread' } }))
      if (ground.length) t += 0.8

      const frame = onStorey(phases.get('frame')!).sort((a, b) => angleAround(a, set) - angleAround(b, set))
      stagger(frame, t, t + 0.9, 0.5, (e, start, duration) =>
        tracks.set(e.id, { start, duration, motion: { kind: 'drop', height: 3 }, dust: 0.5 }))
      if (frame.length) t += 0.5

      // The crane goes round the floor once: each panel is tilted up where it stands.
      const walls = onStorey(phases.get('walls')!).sort((a, b) => angleAround(a, set, 0.6) - angleAround(b, set, 0.6))
      const span = crowd(walls.length, 2.2, 4.2)
      stagger(walls, t, t + span, 0.9, (e, start, duration) =>
        tracks.set(e.id, { start, duration, motion: { kind: 'tilt', ...longAxis(e, set) }, dust: 0.8 }))
      if (walls.length) t += span - 0.3

      const stairs = onStorey([...phases.get('stairs')!, ...phases.get('ceilings')!])
      stagger(stairs, t, t + 0.8, 0.6, (e, start, duration) =>
        tracks.set(e.id, { start, duration, motion: { kind: e.phase === 'stairs' ? 'extend' : 'spread', ...longAxis(e, set) } as Motion }))
      if (stairs.length) t += 0.5
    }

    const roof = phases.get('roof')!.sort((a, b) => a.box.min.y - b.box.min.y || a.seed - b.seed)
    stagger(roof, t, t + 1.6, 1.2, (e, start, duration) =>
      tracks.set(e.id, { start, duration, motion: { kind: 'drop', height: 4 }, dust: 0.6 }))
    if (roof.length) t += 1.2

    const openings = [...phases.get('openings')!, ...phases.get('exterior')!]
      .sort((a, b) => angleAround(a, set) - angleAround(b, set))
    stagger(openings, t, t + crowd(openings.length, 1.2, 2.4), 0.55, (e, start, duration) =>
      tracks.set(e.id, { start, duration, motion: { kind: 'pop', overshoot: 1.2 } }))
    if (openings.length) t += 1

    const items = phases.get('items')!.sort((a, b) => a.storey - b.storey || angleAround(a, set) - angleAround(b, set))
    const itemsEnd = t + crowd(items.length, 1.6, 3.2)
    stagger(items, t, itemsEnd, 0.8, (e, start, duration) =>
      tracks.set(e.id, { start, duration, motion: { kind: 'drop', height: 1.6 }, dust: 0.25 }))

    return { tracks, duration: Math.max(itemsEnd, t) + 0.8, orbit: Math.PI * 0.9 }
  },
}

// ---------------------------------------------------------------------------------------------
// 3. Sky drop: every piece falls out of the sky, bottom first, and lands with a thump.

const skydrop: AnimationTemplate = {
  id: 'skydrop',
  name: 'Sky drop',
  tagline: 'Every piece falls from the sky and lands with a thump and a puff of dust.',
  accent: '#ff5d73',
  build(set) {
    const tracks = new Map<string, Track>()
    const structure = set.elements.filter((e) => e.phase !== 'items')
      .sort((a, b) => a.storey - b.storey ||
        PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) || a.seed - b.seed)
    const sky = Math.max(8, set.size.y * 2.2 + 6)
    const structureEnd = crowd(structure.length, 4.5, 7)
    stagger(structure, 0.2, structureEnd, 1.1, (e, start, duration) => tracks.set(e.id, {
      start, duration,
      motion: { kind: 'drop', height: sky * (0.8 + e.seed * 0.4) },
      dust: e.phase === 'ground' || e.phase === 'walls' ? 1 : 0.6,
    }))

    // Furniture rains in last, tumbling a little on the way down.
    const items = set.elements.filter((e) => e.phase === 'items').sort((a, b) => a.storey - b.storey || a.seed - b.seed)
    const itemsEnd = structureEnd + crowd(items.length, 2, 3.4)
    stagger(items, structureEnd - 0.4, itemsEnd, 0.9, (e, start, duration) => tracks.set(e.id, {
      start, duration,
      motion: { kind: 'drop', height: sky * 0.6, spin: (e.seed - 0.5) * 2 },
      dust: 0.35,
    }))

    return { tracks, duration: itemsEnd + 1, orbit: Math.PI / 2.5 }
  },
}

// ---------------------------------------------------------------------------------------------
// 4. Magnetic: the house hangs in the air exploded into its parts, then snaps together.

const magnetic: AnimationTemplate = {
  id: 'magnetic',
  name: 'Magnetic',
  tagline: 'The house floats exploded into its parts, then snaps together piece by piece.',
  accent: '#a46bff',
  build(set) {
    const tracks = new Map<string, Track>()
    const reach = set.radius * 1.6 + 3
    // Inside out would hide the core behind the shell; the shell lands last, so the core is seen.
    const order = [...set.elements].sort((a, b) =>
      PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) || a.storey - b.storey || a.seed - b.seed)
    const end = crowd(order.length, 6, 8.5)
    stagger(order, 1.2, end, 1.6, (e, start, duration) => {
      const dir = new THREE.Vector3(e.center.x - set.center.x, 0, e.center.z - set.center.z)
      if (dir.lengthSq() < 1e-4) dir.set(Math.cos(e.seed * TAU), 0, Math.sin(e.seed * TAU))
      dir.normalize()
      const out = dir.multiplyScalar(reach * (0.55 + e.seed * 0.7))
      out.y = set.size.y * 0.6 + (e.storey + 1) * 2.2 + e.seed * 3 + PHASE_ORDER.indexOf(e.phase) * 0.6
      const axis = new THREE.Vector3(e.seed - 0.5, 0.6, 0.5 - ((e.seed * 7) % 1)).normalize()
      tracks.set(e.id, {
        start, duration,
        motion: { kind: 'fly', from: out, axis, turns: 0.35 + e.seed * 0.5, arc: 1.5 + e.seed * 2, hover: e.seed * TAU },
        showBefore: true,
        dust: e.phase === 'items' ? 0.2 : 0.45,
      })
    })
    return { tracks, duration: end + 1, orbit: Math.PI * 0.75 }
  },
}

// ---------------------------------------------------------------------------------------------
// 5. Ripple: a wave crosses the ground from the front door; the house springs up behind it,
//    then a second wave brings the furniture.

const ripple: AnimationTemplate = {
  id: 'ripple',
  name: 'Ripple',
  tagline: 'A shockwave rolls out from the front door and the house springs up behind it.',
  accent: '#2fd4a7',
  build(set) {
    const tracks = new Map<string, Track>()
    // The front door if there is one on the ground floor, the middle otherwise.
    const door = set.elements
      .filter((e) => e.kind === 'door' && e.storey === 0)
      .sort((a, b) => distanceFrom(b, set.center) - distanceFrom(a, set.center))[0]
    const origin = door ? door.center.clone() : set.center.clone()
    origin.y = set.groundY

    let farthest = 1
    for (const e of set.elements) farthest = Math.max(farthest, distanceFrom(e, origin) + Math.max(e.size.x, e.size.z) / 2)
    // The front takes about 3.6 s to cross the plot, however big the house is.
    const speed = Math.max(1.2, farthest / 3.6)
    const structureStart = 0.4

    for (const e of set.elements) {
      if (e.phase === 'items') continue
      const arrive = structureStart + distanceFrom(e, origin) / speed
      // Higher floors trail the wave a little, so the house grows upward as well as outward.
      const delay = e.storey * 0.45 + (PHASE_ORDER.indexOf(e.phase) / PHASE_ORDER.length) * 0.5
      tracks.set(e.id, { start: arrive + delay, duration: 1.1, motion: { kind: 'ripple', bump: 0.35 } })
    }
    const secondStart = structureStart + farthest / speed + 0.6 + (set.storeys - 1) * 0.45
    for (const e of set.elements) {
      if (e.phase !== 'items') continue
      tracks.set(e.id, {
        start: secondStart + distanceFrom(e, origin) / (speed * 1.3) + e.storey * 0.3,
        duration: 0.7,
        motion: { kind: 'ripple', bump: 0.6 },
      })
    }

    let duration = 0
    for (const track of tracks.values()) duration = Math.max(duration, track.start + track.duration)
    return {
      tracks,
      duration: duration + 0.8,
      orbit: Math.PI / 2,
      waves: {
        origin,
        waves: [
          { start: structureStart, speed, reach: farthest + 2, color: '#2fd4a7' },
          { start: secondStart, speed: speed * 1.3, reach: farthest + 2, color: '#7ce8ff' },
        ],
      },
    }
  },
}

export const TEMPLATES: readonly AnimationTemplate[] = [blueprint, timelapse, skydrop, magnetic, ripple]

export function templateById(id: TemplateId): AnimationTemplate {
  return TEMPLATES.find((template) => template.id === id) ?? blueprint
}

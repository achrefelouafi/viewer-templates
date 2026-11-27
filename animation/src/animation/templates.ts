import * as THREE from 'three'
import {
  type BuildElement, type BuildPhase, type BuildRoom, type BuildSet, distanceToOutline, insideOutline, PHASE_ORDER,
} from './elements'

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
  /** Whirls in a funnel (`level` 0 bottom to 1 top) until its turn, then spirals down into place. */
  | { kind: 'vortex'; funnel: Funnel; level: number; phase: number; axis: THREE.Vector3 }
  /** Solidifies where it stands: a breath of growth about its centre. */
  | { kind: 'settle' }

/** A tornado's funnel: its foot, height, radius at the foot and how much it widens per metre. */
export type Funnel = { center: THREE.Vector3; bottom: number; height: number; radius: number; flare: number }

export type Track = {
  start: number
  duration: number
  motion: Motion
  /** Puff of dust where it lands (base of its bounds), on arrival. */
  dust?: number
  /** Visible before its start, held at the motion's first pose (exploded views). */
  showBefore?: boolean
  /** Visible (and growing in) from this time, waiting in the motion's first pose until its start. */
  showFrom?: number
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

/** Sand: each piece's grains wait in a swirling cloud, then stream in and land by its start. */
export type SandPlan = { flight: number }

/** The day the build takes: time of day (minutes after midnight) at moments of the timeline. */
export type SunPlan = Array<{ time: number; minutes: number }>

export type Caption = { start: number; end: number; title: string; sub?: string }

/** Where the cinematic camera goes, and when: it frames `box` from `polar` (radians from straight down). */
export type CameraKey = { time: number; box: THREE.Box3; polar: number }

export type Timeline = {
  tracks: Map<string, Track>
  duration: number
  lines?: LinePlan
  waves?: WavePlan
  sand?: SandPlan
  sun?: SunPlan
  captions?: Caption[]
  cameraKeys?: CameraKey[]
  /** Pieces show as white clay until their time here, then in their own materials. */
  clay?: Map<string, number>
  /** The camera turns this many radians over the whole timeline when the cinematic camera is on. */
  orbit: number
}

export type TemplateId =
  | 'blueprint' | 'timelapse' | 'skydrop' | 'magnetic' | 'ripple'
  | 'goldenhour' | 'tornado' | 'sand' | 'clay' | 'rooms'

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

// ---------------------------------------------------------------------------------------------
// 6. Golden hour: the house goes up over one day, dawn to night. The sun climbs and sets as it
//    builds, the shadows swing round the plot, and the finished house stands in the evening.

const goldenhour: AnimationTemplate = {
  id: 'goldenhour',
  name: 'Golden hour',
  tagline: 'Built over one day: dawn light on the slab, long sunset shadows on the roof.',
  accent: '#ff9f43',
  build(set) {
    const tracks = new Map<string, Track>()
    const phases = byPhase(set)
    // The sun rises in the east: the build follows it round, east side first.
    const sunOrder = (a: BuildElement, b: BuildElement) => b.center.x - a.center.x
    let t = 0.6
    const ground = phases.get('ground')!.sort((a, b) => a.storey - b.storey || sunOrder(a, b))
    stagger(ground, t, t + 1.8, 1.4, (e, start, duration) => tracks.set(e.id, { start, duration, motion: { kind: 'spread' } }))
    t += 1.6
    for (let storey = 0; storey < set.storeys; storey++) {
      const level = [...phases.get('frame')!, ...phases.get('walls')!, ...phases.get('stairs')!, ...phases.get('ceilings')!]
        .filter((e) => e.storey === storey).sort((a, b) => sunOrder(a, b) || a.seed - b.seed)
      const span = crowd(level.length, 2.6, 4.4)
      stagger(level, t, t + span, 1.5, (e, start, duration) =>
        tracks.set(e.id, { start, duration, motion: { kind: 'rise', overshoot: 0.3 }, dust: e.phase === 'walls' ? 0.35 : 0 }))
      if (level.length) t += span - 0.6
    }
    const roof = phases.get('roof')!.sort((a, b) => a.box.min.y - b.box.min.y || sunOrder(a, b))
    stagger(roof, t, t + 1.8, 1.5, (e, start, duration) =>
      tracks.set(e.id, { start, duration, motion: { kind: 'drop', height: 2.2 }, dust: 0.4 }))
    t += 1.4
    const finish = [...phases.get('openings')!, ...phases.get('exterior')!, ...phases.get('items')!]
      .sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) || sunOrder(a, b))
    const end = t + crowd(finish.length, 2.2, 3.6)
    stagger(finish, t, end, 0.8, (e, start, duration) =>
      tracks.set(e.id, { start, duration, motion: { kind: 'pop', overshoot: 1.1 } }))
    const duration = end + 2.6
    return {
      tracks,
      duration,
      // Dawn, a quick morning, a long golden afternoon, dusk as the last pieces land, then night.
      sun: [
        { time: 0, minutes: 5 * 60 + 40 },
        { time: duration * 0.25, minutes: 9 * 60 },
        { time: duration * 0.55, minutes: 15 * 60 },
        { time: duration * 0.82, minutes: 19 * 60 + 10 },
        { time: duration - 0.6, minutes: 21 * 60 + 15 },
        { time: duration, minutes: 21 * 60 + 15 },
      ],
      captions: [
        { start: 0.3, end: 2.6, title: 'Dawn', sub: 'Breaking ground' },
        { start: duration * 0.42, end: duration * 0.42 + 2.2, title: 'Afternoon', sub: 'Walls up' },
        { start: duration - 2.4, end: duration, title: 'Evening', sub: 'Home' },
      ],
      orbit: Math.PI * 0.6,
    }
  },
}

// ---------------------------------------------------------------------------------------------
// 7. Tornado: a twister picks the house up in pieces and puts it down, the slab first, the
//    furniture last, each piece spiralling down out of the funnel into its place.

const tornado: AnimationTemplate = {
  id: 'tornado',
  name: 'Tornado',
  tagline: 'A twister carries every piece round and round, then sets the house down.',
  accent: '#7f8cff',
  build(set) {
    const tracks = new Map<string, Track>()
    const funnel: Funnel = {
      center: set.center.clone(),
      bottom: set.groundY + set.size.y + 3,
      height: Math.max(8, set.size.y * 2.5),
      radius: Math.max(2, set.radius * 0.35),
      flare: 0.45,
    }
    const order = [...set.elements].sort((a, b) =>
      a.storey - b.storey || PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) || a.seed - b.seed)
    const end = crowd(order.length, 7, 10)
    stagger(order, 2.6, end, 1.5, (e, start, duration, index) => {
      // The last to land rides highest; everyone is swept up in the first couple of seconds.
      const level = 0.1 + 0.9 * (order.length > 1 ? index / (order.length - 1) : 0.5)
      tracks.set(e.id, {
        start, duration,
        showFrom: 0.1 + e.seed * 1.8,
        motion: {
          kind: 'vortex', funnel, level, phase: e.seed * TAU * 3,
          axis: new THREE.Vector3(e.seed - 0.5, 0.4, ((e.seed * 13) % 1) - 0.5).normalize(),
        },
        dust: e.phase === 'items' ? 0.3 : 0.8,
      })
    })
    // The storm in frame while it whirls, then down to the house as the last pieces land.
    const storm = set.box.clone()
    storm.max.y = funnel.bottom + funnel.height
    const reach = funnel.radius + funnel.height * funnel.flare
    storm.expandByPoint(new THREE.Vector3(set.center.x - reach, storm.max.y, set.center.z - reach))
    storm.expandByPoint(new THREE.Vector3(set.center.x + reach, storm.max.y, set.center.z + reach))
    const cameraKeys: CameraKey[] = [
      { time: 0, box: storm, polar: Math.PI * 0.42 },
      { time: end - 2.4, box: set.box.clone().expandByScalar(set.radius * 0.2), polar: Math.PI * 0.32 },
    ]
    return { tracks, duration: end + 1.2, cameraKeys, orbit: Math.PI * 0.8 }
  },
}

// ---------------------------------------------------------------------------------------------
// 8. Sand: a ring of sand swirls round the plot; it streams in grain by grain, settles on each
//    piece's surfaces, and the piece hardens out of it.

const sand: AnimationTemplate = {
  id: 'sand',
  name: 'Sand',
  tagline: 'A swirling ring of sand streams in and hardens into the house, piece by piece.',
  accent: '#e0b46c',
  build(set) {
    const tracks = new Map<string, Track>()
    const order = [...set.elements].sort((a, b) =>
      a.storey - b.storey || PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) ||
      distanceFrom(a, set.center) - distanceFrom(b, set.center))
    const flight = 1.6
    const end = crowd(order.length, 7.5, 10)
    stagger(order, 2.4, end, 0.6, (e, start, duration) =>
      tracks.set(e.id, { start, duration, motion: { kind: 'settle' } }))
    return { tracks, duration: end + 1.4, sand: { flight }, orbit: Math.PI * 0.7 }
  },
}

// ---------------------------------------------------------------------------------------------
// 9. Clay model: the house goes up as an architect's white model, then a wave of colour washes
//    over it and paints in the real materials.

const clay: AnimationTemplate = {
  id: 'clay',
  name: 'Clay model',
  tagline: 'Built as a white architect’s model, then a wave of colour paints it real.',
  accent: '#ff6fb5',
  build(set) {
    const tracks = new Map<string, Track>()
    const phases = byPhase(set)
    let t = 0.3
    for (const phase of PHASE_ORDER) {
      const list = phases.get(phase)!.sort((a, b) => a.storey - b.storey || (a.center.x - a.center.z) - (b.center.x - b.center.z))
      if (list.length === 0) continue
      const span = phase === 'items' ? crowd(list.length, 1.4, 2.6) : crowd(list.length, 0.9, 2)
      const motion: Motion = phase === 'ground' ? { kind: 'spread' }
        : phase === 'roof' ? { kind: 'drop', height: 1.5 }
        : phase === 'walls' || phase === 'frame' ? { kind: 'rise', overshoot: 0.5 }
        : { kind: 'pop', overshoot: 1.4 }
      stagger(list, t, t + span, 0.7, (e, start, duration) => tracks.set(e.id, { start, duration, motion }))
      t += span * 0.7
    }
    // A beat to look at the model, then the colour sweeps across from one corner.
    const paintStart = t + 1.4
    const origin = new THREE.Vector3(set.box.min.x, set.groundY, set.box.max.z)
    let farthest = 1
    for (const e of set.elements) farthest = Math.max(farthest, distanceFrom(e, origin))
    const speed = farthest / 2.6
    const paint = new Map<string, number>()
    for (const e of set.elements) paint.set(e.id, paintStart + distanceFrom(e, origin) / speed + e.storey * 0.15)
    const duration = paintStart + 2.6 + (set.storeys - 1) * 0.15 + 1.2
    return {
      tracks,
      duration,
      clay: paint,
      waves: { origin, waves: [{ start: paintStart, speed, reach: farthest + 1.5, color: '#ff6fb5' }] },
      captions: [{ start: paintStart - 1.2, end: paintStart + 1.4, title: 'Model', sub: 'Now in colour' }],
      orbit: Math.PI * 0.5,
    }
  },
}

// ---------------------------------------------------------------------------------------------
// 10. Room by room: the camera visits each room in turn while its walls rise, its doors and
//     windows open up and its furniture moves in; then it pulls out as the roof goes on.

function roomOf(element: BuildElement, rooms: readonly BuildRoom[]): BuildRoom | null {
  const sameStorey = rooms.filter((room) => room.storey === element.storey)
  if (element.phase === 'walls' || element.phase === 'frame') {
    // A wall belongs to the first room it bounds.
    for (const room of sameStorey) {
      if (distanceToOutline(room.outline, element.center.x, element.center.z) < 0.45) return room
    }
  }
  for (const room of sameStorey) {
    if (insideOutline(room.outline, element.center.x, element.center.z)) return room
  }
  if (element.phase === 'openings') {
    for (const room of sameStorey) {
      if (distanceToOutline(room.outline, element.center.x, element.center.z) < 0.45) return room
    }
  }
  return null
}

const rooms: AnimationTemplate = {
  id: 'rooms',
  name: 'Room tour',
  tagline: 'The camera walks you through each room as it is built and furnished.',
  accent: '#4cc3ff',
  build(set) {
    const tracks = new Map<string, Track>()
    const captions: Caption[] = []
    const cameraKeys: CameraKey[] = [{ time: 0, box: set.box.clone(), polar: Math.PI * 0.27 }]
    const ordered = [...set.rooms].sort((a, b) => a.storey - b.storey ||
      (a.box.min.x + a.box.min.z) - (b.box.min.x + b.box.min.z))
    const byRoom = new Map<string, BuildElement[]>()
    const later: BuildElement[] = []
    const ground: BuildElement[] = []
    for (const e of set.elements) {
      if (e.phase === 'ground' && e.storey === 0) {
        ground.push(e)
        continue
      }
      const room = e.phase === 'roof' || e.phase === 'exterior' ? null : roomOf(e, ordered)
      if (!room) {
        later.push(e)
        continue
      }
      const list = byRoom.get(room.id)
      if (list) list.push(e)
      else byRoom.set(room.id, [e])
    }

    let t = 0.3
    stagger(ground, t, t + 1.2, 1, (e, start, duration) => tracks.set(e.id, { start, duration, motion: { kind: 'spread' } }))
    t += 1.4
    const visited = ordered.filter((room) => byRoom.has(room.id))
    visited.forEach((room, index) => {
      const list = byRoom.get(room.id)!
      const span = Math.min(4.2, 2.4 + list.length * 0.06)
      cameraKeys.push({ time: t - 0.3, box: room.box.clone().expandByScalar(0.6), polar: Math.PI * 0.2 })
      const name = room.name || `Room ${index + 1}`
      captions.push({
        start: t, end: t + span - 0.2, title: name,
        sub: `${index + 1} of ${visited.length}${room.area > 0.5 ? ` · ${room.area.toFixed(1)} m²` : ''}`,
      })
      const structure = list.filter((e) => e.phase !== 'items' && e.phase !== 'openings')
        .sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) || a.seed - b.seed)
      const openings = list.filter((e) => e.phase === 'openings')
      const items = list.filter((e) => e.phase === 'items').sort((a, b) => a.box.min.y - b.box.min.y || a.seed - b.seed)
      stagger(structure, t, t + span * 0.4, 0.8, (e, start, duration) =>
        tracks.set(e.id, { start, duration, motion: e.phase === 'ground' ? { kind: 'spread' } : { kind: 'rise', overshoot: 0.5 }, dust: 0.25 }))
      stagger(openings, t + span * 0.3, t + span * 0.55, 0.5, (e, start, duration) =>
        tracks.set(e.id, { start, duration, motion: { kind: 'pop', overshoot: 1.4 } }))
      stagger(items, t + span * 0.45, t + span * 0.95, 0.6, (e, start, duration) =>
        tracks.set(e.id, { start, duration, motion: { kind: 'drop', height: 1.2 }, dust: 0.2 }))
      t += span
    })

    // Out to the whole house for the shell: anything no room claimed, then the roof.
    cameraKeys.push({ time: t - 0.2, box: set.box.clone().expandByScalar(set.radius * 0.35), polar: Math.PI * 0.33 })
    later.sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) || a.box.min.y - b.box.min.y)
    const end = t + crowd(later.length, 1.6, 3)
    stagger(later, t, end, 0.9, (e, start, duration) => tracks.set(e.id, {
      start, duration,
      motion: e.phase === 'roof' ? { kind: 'drop', height: 2.5 } : e.phase === 'items' ? { kind: 'pop' } : { kind: 'rise' },
      dust: e.phase === 'roof' ? 0.5 : 0,
    }))
    captions.push({ start: end - 0.6, end: end + 1.6, title: 'Home', sub: `${visited.length} rooms` })
    return { tracks, duration: end + 1.6, captions, cameraKeys, orbit: Math.PI * 0.35 }
  },
}

export const TEMPLATES: readonly AnimationTemplate[] = [
  blueprint, timelapse, skydrop, magnetic, ripple, goldenhour, tornado, sand, clay, rooms,
]


export function templateById(id: TemplateId): AnimationTemplate {
  return TEMPLATES.find((template) => template.id === id) ?? blueprint
}

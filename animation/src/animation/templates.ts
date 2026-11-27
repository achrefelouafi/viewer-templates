import * as THREE from 'three'
import {
  type BuildElement, type BuildPhase, type BuildRoom, type BuildSet, distanceToOutline, insideOutline,
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

/**
 * The order a house goes up in, on every floor: the slab, the frame, the walls, the stairs, the
 * doors and windows, the furniture, and only then what closes it over (ceilings, the outside
 * fittings, the roof), so nothing covers a piece before it has been seen arriving.
 */
const BUILD_ORDER: readonly BuildPhase[] = [
  'ground', 'frame', 'walls', 'stairs', 'openings', 'items', 'ceilings', 'exterior', 'roof',
]

/** Floor first (bottom up), then the place in `BUILD_ORDER`: the hierarchy every template follows. */
function buildRank(element: BuildElement): number {
  return element.storey * BUILD_ORDER.length + BUILD_ORDER.indexOf(element.phase)
}

const byRank = (a: BuildElement, b: BuildElement) => buildRank(a) - buildRank(b)

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

/** How one group of a floor (its walls, its furniture...) arrives. */
type Step = {
  motion: (element: BuildElement) => Motion
  /** Seconds over which the group's pieces start. */
  span: number
  /** Seconds each piece moves. */
  each: number
  sort?: (a: BuildElement, b: BuildElement) => number
  dust?: number
  /** Share of `span` before the next group starts (1 waits for the last start). */
  overlap?: number
}

/**
 * Schedules the build in hierarchy order: floor by floor from the bottom, each floor in
 * `BUILD_ORDER`, every group starting once most of the one before it has started. Returns the time
 * the last piece comes to rest.
 */
function floorByFloor(
  set: BuildSet,
  tracks: Map<string, Track>,
  from: number,
  step: (phase: BuildPhase, group: BuildElement[]) => Step,
): number {
  let t = from
  let end = from
  let top = 0
  for (const element of set.elements) top = Math.max(top, element.storey)
  for (let storey = 0; storey <= top; storey++) {
    for (const phase of BUILD_ORDER) {
      const group = set.elements.filter((e) => e.storey === storey && e.phase === phase)
      if (group.length === 0) continue
      const s = step(phase, group)
      group.sort(s.sort ?? ((a, b) => a.seed - b.seed))
      stagger(group, t, t + s.span, s.each, (e, start, duration) => {
        tracks.set(e.id, { start, duration, motion: s.motion(e), dust: s.dust })
        end = Math.max(end, start + duration)
      })
      t += s.span * (s.overlap ?? 0.7)
    }
  }
  return end
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
    const draw = new Map<string, { start: number; duration: number }>()

    // The pen draws in the same hierarchy, sweeping across the plan within each group.
    const sweep = [...set.elements].sort((a, b) => byRank(a, b) || (a.center.x + a.center.z) - (b.center.x + b.center.z))
    const penEnd = crowd(sweep.length, 2.6, 4.2)
    stagger(sweep, 0.2, penEnd, 0.9, (element, start, duration) => draw.set(element.id, { start, duration }))

    const plan = (a: BuildElement, b: BuildElement) => (a.center.x + a.center.z) - (b.center.x + b.center.z)
    const end = floorByFloor(set, tracks, penEnd - 0.6, (phase, group) => {
      switch (phase) {
        case 'ground': return { motion: () => ({ kind: 'spread' }), span: 1.2, each: 0.9 }
        case 'frame': return { motion: () => ({ kind: 'rise' }), span: 0.8, each: 0.6 }
        case 'walls': return { motion: () => ({ kind: 'rise', overshoot: 0.6 }), span: crowd(group.length, 2.2, 3.8), each: 1.1, sort: plan }
        case 'stairs': return { motion: () => ({ kind: 'rise' }), span: 0.8, each: 0.7 }
        case 'openings': return { motion: () => ({ kind: 'pop', overshoot: 1.6 }), span: crowd(group.length, 0.9, 1.8), each: 0.6 }
        case 'items': return {
          motion: () => ({ kind: 'pop', overshoot: 2 }), span: crowd(group.length, 1.4, 2.8), each: 0.7,
          sort: (a, b) => distanceFrom(a, set.center) - distanceFrom(b, set.center), overlap: 0.9,
        }
        case 'ceilings': return { motion: () => ({ kind: 'spread' }), span: 0.9, each: 0.7 }
        case 'exterior': return { motion: () => ({ kind: 'pop', overshoot: 1.2 }), span: 0.9, each: 0.6 }
        case 'roof': return { motion: () => ({ kind: 'drop', height: 2.5 }), span: 1.2, each: 1, dust: 0.4 }
      }
    })
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
//    swings round, doors and windows fitted, furniture moved in, then the roof lowered on.

const timelapse: AnimationTemplate = {
  id: 'timelapse',
  name: 'Time-lapse',
  tagline: 'A crane swings round: slabs poured, wall panels tilted up, roof lowered on.',
  accent: '#f5a524',
  build(set) {
    const tracks = new Map<string, Track>()
    const around = (a: BuildElement, b: BuildElement) => angleAround(a, set, 0.6) - angleAround(b, set, 0.6)
    const end = floorByFloor(set, tracks, 0.2, (phase, group) => {
      switch (phase) {
        case 'ground': return {
          motion: () => ({ kind: 'spread' }), span: 1, each: 0.8,
          sort: (a, b) => distanceFrom(a, set.center) - distanceFrom(b, set.center),
        }
        case 'frame': return { motion: () => ({ kind: 'drop', height: 3 }), span: 0.9, each: 0.5, sort: around, dust: 0.5 }
        // The crane goes round the floor once: each panel is tilted up where it stands.
        case 'walls': return {
          motion: (e) => ({ kind: 'tilt', ...longAxis(e, set) }), span: crowd(group.length, 2.2, 4.2), each: 0.9,
          sort: around, dust: 0.8, overlap: 0.85,
        }
        case 'stairs': return { motion: (e) => ({ kind: 'extend', ...longAxis(e, set) }), span: 0.8, each: 0.6 }
        case 'openings': return { motion: () => ({ kind: 'pop', overshoot: 1.2 }), span: crowd(group.length, 1, 2), each: 0.55, sort: around }
        case 'items': return {
          motion: () => ({ kind: 'drop', height: 1.6 }), span: crowd(group.length, 1.4, 3), each: 0.8,
          sort: around, dust: 0.25, overlap: 0.9,
        }
        case 'ceilings': return { motion: () => ({ kind: 'spread' }), span: 0.8, each: 0.6 }
        case 'exterior': return { motion: () => ({ kind: 'pop', overshoot: 1 }), span: 0.9, each: 0.5, sort: around }
        case 'roof': return { motion: () => ({ kind: 'drop', height: 4 }), span: 1.4, each: 1.2, dust: 0.6 }
      }
    })
    return { tracks, duration: end + 0.8, orbit: Math.PI * 0.9 }
  },
}

// ---------------------------------------------------------------------------------------------
// 3. Sky drop: every piece falls out of the sky, floor by floor, and lands with a thump.

const skydrop: AnimationTemplate = {
  id: 'skydrop',
  name: 'Sky drop',
  tagline: 'Every piece falls from the sky and lands with a thump and a puff of dust.',
  accent: '#ff5d73',
  build(set) {
    const tracks = new Map<string, Track>()
    const order = [...set.elements].sort((a, b) => byRank(a, b) || a.seed - b.seed)
    const sky = Math.max(8, set.size.y * 2.2 + 6)
    const end = crowd(order.length, 6.5, 10)
    stagger(order, 0.2, end, 1.1, (e, start, duration) => tracks.set(e.id, {
      start, duration,
      // Furniture tumbles a little on the way down.
      motion: e.phase === 'items'
        ? { kind: 'drop', height: sky * 0.6, spin: (e.seed - 0.5) * 2 }
        : { kind: 'drop', height: sky * (0.8 + e.seed * 0.4) },
      dust: e.phase === 'ground' || e.phase === 'walls' ? 1 : e.phase === 'items' ? 0.35 : 0.6,
    }))
    return { tracks, duration: end + 1, orbit: Math.PI / 2.5 }
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
    const order = [...set.elements].sort((a, b) => byRank(a, b) || a.seed - b.seed)
    const end = crowd(order.length, 6, 8.5)
    stagger(order, 1.2, end, 1.6, (e, start, duration) => {
      const dir = new THREE.Vector3(e.center.x - set.center.x, 0, e.center.z - set.center.z)
      if (dir.lengthSq() < 1e-4) dir.set(Math.cos(e.seed * TAU), 0, Math.sin(e.seed * TAU))
      dir.normalize()
      const out = dir.multiplyScalar(reach * (0.55 + e.seed * 0.7))
      out.y = set.size.y * 0.6 + (e.storey + 1) * 2.2 + e.seed * 3 + BUILD_ORDER.indexOf(e.phase) * 0.6
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
// 5. Ripple: waves cross the ground from the front door, floor by floor: one raises the floor's
//    shell, the next brings its furniture, the last closes it over with its ceilings and roof.

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
    // A front takes about 3 s to cross the plot, however big the house is.
    const speed = Math.max(1.2, farthest / 3)
    const groups: Array<{ phases: BuildPhase[]; bump: number; duration: number; speed: number; color: string }> = [
      { phases: ['ground', 'frame', 'walls', 'stairs', 'openings'], bump: 0.35, duration: 1.1, speed, color: '#2fd4a7' },
      { phases: ['items'], bump: 0.6, duration: 0.7, speed: speed * 1.3, color: '#7ce8ff' },
      { phases: ['ceilings', 'exterior', 'roof'], bump: 0.3, duration: 1, speed: speed * 1.15, color: '#b6f7e2' },
    ]
    const waves: WavePlan['waves'] = []
    let top = 0
    for (const e of set.elements) top = Math.max(top, e.storey)
    let t = 0.4
    for (let storey = 0; storey <= top; storey++) {
      for (const group of groups) {
        const list = set.elements.filter((e) => e.storey === storey && group.phases.includes(e.phase))
        if (list.length === 0) continue
        for (const e of list) {
          // Within a wave the slab leads, the walls follow a beat behind, the openings last.
          const lag = (group.phases.indexOf(e.phase) / group.phases.length) * 0.5
          // The slab is laid as its wave sets off (its rooms grow from their centres); the rest
          // rises where the front reaches it.
          const reached = e.phase === 'ground' ? 0 : distanceFrom(e, origin) / group.speed
          tracks.set(e.id, {
            start: t + reached + lag + (e.phase === 'ground' ? 0 : 0.25),
            duration: group.duration,
            motion: { kind: 'ripple', bump: group.bump },
          })
        }
        waves.push({ start: t, speed: group.speed, reach: farthest + 2, color: group.color })
        t += (farthest / group.speed) * 0.8 + 0.35
      }
    }

    let duration = 0
    for (const track of tracks.values()) duration = Math.max(duration, track.start + track.duration)
    return { tracks, duration: duration + 0.8, orbit: Math.PI / 2, waves: { origin, waves } }
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
    // The sun rises in the east: each group follows it round, east side first.
    const sunOrder = (a: BuildElement, b: BuildElement) => b.center.x - a.center.x
    const end = floorByFloor(set, tracks, 0.6, (phase, group) => {
      switch (phase) {
        case 'ground': return { motion: () => ({ kind: 'spread' }), span: 1.8, each: 1.4, sort: sunOrder }
        case 'walls': return {
          motion: () => ({ kind: 'rise', overshoot: 0.3 }), span: crowd(group.length, 2.4, 4), each: 1.5,
          sort: sunOrder, dust: 0.35,
        }
        case 'openings':
        case 'items':
        case 'exterior': return {
          motion: () => ({ kind: 'pop', overshoot: 1.1 }), span: crowd(group.length, 1.2, 2.6), each: 0.8,
          sort: sunOrder, overlap: phase === 'items' ? 0.9 : 0.7,
        }
        case 'roof': return { motion: () => ({ kind: 'drop', height: 2.2 }), span: 1.6, each: 1.5, sort: sunOrder, dust: 0.4 }
        default: return { motion: () => ({ kind: 'rise', overshoot: 0.3 }), span: 1.2, each: 1.2, sort: sunOrder }
      }
    })
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
    const order = [...set.elements].sort((a, b) => byRank(a, b) || a.seed - b.seed)
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
      byRank(a, b) || distanceFrom(a, set.center) - distanceFrom(b, set.center))
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
    const across = (a: BuildElement, b: BuildElement) => (a.center.x - a.center.z) - (b.center.x - b.center.z)
    const t = floorByFloor(set, tracks, 0.3, (phase, group) => {
      const motion: Motion = phase === 'ground' || phase === 'ceilings' ? { kind: 'spread' }
        : phase === 'roof' ? { kind: 'drop', height: 1.5 }
        : phase === 'walls' || phase === 'frame' || phase === 'stairs' ? { kind: 'rise', overshoot: 0.5 }
        : { kind: 'pop', overshoot: 1.4 }
      const span = phase === 'items' ? crowd(group.length, 1.4, 2.6) : crowd(group.length, 0.9, 2)
      return { motion: () => motion, span, each: 0.7, sort: across, overlap: phase === 'items' ? 0.9 : 0.7 }
    })
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
      // Ceilings would hide the room from the camera above it: they close over with the roof.
      const room = e.phase === 'roof' || e.phase === 'exterior' || e.phase === 'ceilings' ? null : roomOf(e, ordered)
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
        .sort((a, b) => BUILD_ORDER.indexOf(a.phase) - BUILD_ORDER.indexOf(b.phase) || a.seed - b.seed)
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
    later.sort((a, b) => byRank(a, b) || a.box.min.y - b.box.min.y)
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

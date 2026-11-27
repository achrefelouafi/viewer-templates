import * as THREE from 'three'
import type { BuildElement } from './elements'
import type { Motion, Track } from './templates'

/**
 * Where a piece is at a moment of its track, as a motion in world space about a world pivot:
 * `M = T(offset) · T(pivot) · R · S · T(-pivot)`. The animator turns it into the object's local
 * transform through its parent's rest frame, so a door inherits whatever its wall is doing.
 */

export type Pose = {
  visible: boolean
  /** True at rest: the object gets its own transform back exactly. */
  rest: boolean
  offset: THREE.Vector3
  pivot: THREE.Vector3
  rotation: THREE.Quaternion
  scale: THREE.Vector3
}

export function createPose(): Pose {
  return {
    visible: true,
    rest: true,
    offset: new THREE.Vector3(),
    pivot: new THREE.Vector3(),
    rotation: new THREE.Quaternion(),
    scale: new THREE.Vector3(1, 1, 1),
  }
}

const MIN = 1e-3
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
const easeInQuad = (t: number) => t * t
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
/** GSAP's back.out: goes `s` past the end and comes back. */
const backOut = (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2
const elasticOut = (t: number) =>
  t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1

/** Share of a drop spent falling; the rest is the landing. */
export const DROP_FALL = 0.62
/** When each motion makes contact (for its dust), as a share of its duration. */
export function arrivalOf(motion: Motion): number {
  switch (motion.kind) {
    case 'drop': return DROP_FALL
    case 'tilt': return 0.78
    case 'fly': return 0.9
    case 'rise': return 0.85
    default: return 0.6
  }
}

const _axis = new THREE.Vector3()

function basePivot(element: BuildElement, out: THREE.Vector3) {
  return out.set(element.center.x, element.box.min.y, element.center.z)
}

/**
 * Fills `pose` for `element` at `time` on its `track`. Before the track starts the piece is
 * hidden (or held at its first pose when the track shows it early); after it ends it is at rest.
 */
export function poseAt(element: BuildElement, track: Track | undefined, time: number, clock: number, pose: Pose): Pose {
  pose.offset.set(0, 0, 0)
  pose.rotation.identity()
  pose.scale.set(1, 1, 1)
  pose.visible = true
  pose.rest = false
  if (!track) {
    pose.rest = true
    return pose
  }
  if (time < track.start && !track.showBefore) {
    pose.visible = false
    return pose
  }
  const u = clamp01((time - track.start) / track.duration)
  if (u >= 1) {
    pose.rest = true
    return pose
  }

  const motion = track.motion
  switch (motion.kind) {
    case 'rise': {
      basePivot(element, pose.pivot)
      const s = motion.overshoot ? backOut(u, motion.overshoot) : easeOutCubic(u)
      pose.scale.set(1, Math.max(MIN, s), 1)
      break
    }
    case 'spread': {
      basePivot(element, pose.pivot)
      const s = Math.max(MIN, easeOutCubic(u))
      pose.scale.set(s, Math.max(MIN, Math.min(1, 0.15 + u * 1.5)), s)
      break
    }
    case 'pop': {
      basePivot(element, pose.pivot)
      pose.scale.setScalar(Math.max(MIN, backOut(u, motion.overshoot ?? 1.7)))
      break
    }
    case 'drop': {
      basePivot(element, pose.pivot)
      if (u < DROP_FALL) {
        const f = u / DROP_FALL
        pose.offset.y = motion.height * (1 - easeInQuad(f))
        // Stretched a little by the speed of the fall.
        const stretch = 1 + 0.06 * f
        pose.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch))
        if (motion.spin) {
          pose.rotation.setFromAxisAngle(_axis.set(0, 1, 0), motion.spin * Math.PI * (1 - f))
        }
      } else {
        // Squash on impact, a small hop, and settle.
        const k = (u - DROP_FALL) / (1 - DROP_FALL)
        const wobble = Math.sin(k * Math.PI * 2.2) * (1 - k) ** 2
        const squash = 0.16 * wobble
        pose.scale.set(1 + squash * 0.5, Math.max(MIN, 1 - squash), 1 + squash * 0.5)
        pose.offset.y = Math.max(0, Math.sin(k * Math.PI) * (1 - k)) * Math.min(0.12, motion.height * 0.015)
      }
      break
    }
    case 'tilt': {
      // The hinge is the bottom edge on the outer face; the panel starts lying flat outward.
      const e = backOut(u, 0.5)
      const angle = (Math.PI / 2) * (1 - e)
      const halfX = element.size.x / 2
      const halfZ = element.size.z / 2
      if (motion.axis === 'x') {
        pose.pivot.set(element.center.x, element.box.min.y, element.center.z + motion.side * halfZ)
        pose.rotation.setFromAxisAngle(_axis.set(1, 0, 0), motion.side * angle)
      } else {
        pose.pivot.set(element.center.x + motion.side * halfX, element.box.min.y, element.center.z)
        pose.rotation.setFromAxisAngle(_axis.set(0, 0, 1), -motion.side * angle)
      }
      break
    }
    case 'extend': {
      const e = easeOutCubic(u)
      if (motion.axis === 'x') {
        pose.pivot.set(motion.side > 0 ? element.box.min.x : element.box.max.x, element.box.min.y, element.center.z)
        pose.scale.set(Math.max(MIN, e), 1, 1)
      } else {
        pose.pivot.set(element.center.x, element.box.min.y, motion.side > 0 ? element.box.min.z : element.box.max.z)
        pose.scale.set(1, 1, Math.max(MIN, e))
      }
      break
    }
    case 'fly': {
      pose.pivot.copy(element.center)
      const e = easeInOutCubic(u)
      const left = 1 - e
      pose.offset.copy(motion.from).multiplyScalar(left)
      // An arc on the way in, and the float it hung in before, dying away.
      pose.offset.y += Math.sin(e * Math.PI) * motion.arc * left
      pose.offset.y += Math.sin(clock * 1.7 + motion.hover) * 0.25 * left
      pose.rotation.setFromAxisAngle(motion.axis, motion.turns * Math.PI * 2 * left + Math.sin(clock + motion.hover) * 0.08 * left)
      // The snap: a quick pulse as it locks in.
      if (u > 0.86) {
        const k = (u - 0.86) / 0.14
        pose.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.05)
      }
      break
    }
    case 'ripple': {
      basePivot(element, pose.pivot)
      pose.scale.setScalar(Math.max(MIN, elasticOut(u)))
      pose.offset.y = Math.sin(clamp01(u * 1.8) * Math.PI) * motion.bump * (1 - u)
      break
    }
  }
  return pose
}

const _step = new THREE.Matrix4()

/** The world-space motion matrix for a pose. */
export function poseMatrix(pose: Pose, out: THREE.Matrix4): THREE.Matrix4 {
  out.makeTranslation(pose.offset.x + pose.pivot.x, pose.offset.y + pose.pivot.y, pose.offset.z + pose.pivot.z)
  out.multiply(_step.makeRotationFromQuaternion(pose.rotation))
  out.multiply(_step.makeScale(pose.scale.x, pose.scale.y, pose.scale.z))
  out.multiply(_step.makeTranslation(-pose.pivot.x, -pose.pivot.y, -pose.pivot.z))
  return out
}

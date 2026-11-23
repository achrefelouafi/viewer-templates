import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { type Intersection, Matrix4, Mesh, type Object3D, Vector2, Vector3 } from 'three'
import { measure, type ScreenPoint, useMeasure } from './measure'

/** How close to a corner a click snaps to it, in CSS pixels. */
const SNAP_PX = 12
/** Further than this between press and release is a drag (a turn or a pan), not a pick. */
const CLICK_SLOP_PX = 4

/**
 * Picks the measure tool's points on the drawing, for both renderers: a click lands on the
 * surface under the pointer, snapped to the nearest corner of the face it hit when one is
 * close on screen. Every frame it projects the points for the overlay to draw.
 */
export function MeasureTool() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const raycaster = useThree((s) => s.raycaster)
  const invalidate = useThree((s) => s.invalidate)
  const { active } = useMeasure()

  useEffect(() => {
    if (!active) return
    const element = gl.domElement
    const ndc = new Vector2()
    const pick = (event: PointerEvent): Vector3 | null => {
      const rect = element.getBoundingClientRect()
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObject(scene, true).find(isSolid)
      if (!hit) return null
      return snap(hit, camera, rect, event.clientX, event.clientY) ?? hit.point.clone()
    }
    let down: { x: number; y: number } | null = null
    let frame = 0
    const move = (event: PointerEvent) => {
      if (event.buttons) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        measure.setPreview(pick(event))
        invalidate()
      })
    }
    const press = (event: PointerEvent) => {
      down = event.button === 0 ? { x: event.clientX, y: event.clientY } : null
    }
    const release = (event: PointerEvent) => {
      if (!down) return
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y)
      down = null
      if (moved > CLICK_SLOP_PX) return
      const point = pick(event)
      if (point) measure.add(point)
      invalidate()
    }
    const leave = () => {
      cancelAnimationFrame(frame)
      measure.setPreview(null)
      invalidate()
    }
    element.style.cursor = 'crosshair'
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerdown', press)
    element.addEventListener('pointerup', release)
    element.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(frame)
      element.style.cursor = ''
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerdown', press)
      element.removeEventListener('pointerup', release)
      element.removeEventListener('pointerleave', leave)
    }
  }, [active, camera, gl, invalidate, raycaster, scene])

  useFrame(() => {
    const { active, points, preview } = measure.state
    if (!active) return
    const rect = gl.domElement.getBoundingClientRect()
    measure.setScreen({
      points: points.map((point) => toScreen(point, camera, rect)),
      preview: preview ? toScreen(preview, camera, rect) : null,
    })
  })

  return null
}

const projected = new Vector3()

function toScreen(point: Vector3, camera: Parameters<Vector3['project']>[0], rect: DOMRect): ScreenPoint {
  projected.copy(point).project(camera)
  if (projected.z > 1 || projected.z < -1) return null
  return { x: rect.left + ((projected.x + 1) / 2) * rect.width, y: rect.top + ((1 - projected.y) / 2) * rect.height }
}

/** A hit on a shown surface, below any cut the room cutaway made. */
function isSolid(hit: Intersection): boolean {
  if (!(hit.object instanceof Mesh)) return false
  for (let current: Object3D | null = hit.object; current; current = current.parent) {
    if (!current.visible) return false
  }
  const above = (hit.object.userData as { cutAbove?: number }).cutAbove
  return above === undefined || hit.point.y <= above
}

const corner = new Vector3()
const instance = new Matrix4()

/** The corner of the hit face nearest the pointer on screen, if it is within `SNAP_PX`. */
function snap(
  hit: Intersection,
  camera: Parameters<Vector3['project']>[0],
  rect: DOMRect,
  x: number,
  y: number,
): Vector3 | null {
  const mesh = hit.object as Mesh
  const position = mesh.geometry.getAttribute('position')
  if (!hit.face || !position) return null
  if (hit.instanceId !== undefined && 'getMatrixAt' in mesh) {
    ;(mesh as unknown as { getMatrixAt: (i: number, m: Matrix4) => void }).getMatrixAt(hit.instanceId, instance)
  } else {
    instance.identity()
  }
  let best: Vector3 | null = null
  let bestDistance = SNAP_PX
  for (const index of [hit.face.a, hit.face.b, hit.face.c]) {
    corner.fromBufferAttribute(position, index).applyMatrix4(instance).applyMatrix4(mesh.matrixWorld)
    const screen = toScreen(corner, camera, rect)
    if (!screen) continue
    const distance = Math.hypot(screen.x - x, screen.y - y)
    if (distance < bestDistance) {
      bestDistance = distance
      best = corner.clone()
    }
  }
  return best
}

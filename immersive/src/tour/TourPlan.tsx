import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTourLook } from './look'

/**
 * The guided tour on the 2D plan, matching `TourNoir` in 3D: the plan goes grey (and, in dark
 * mode, inverted to the Noir near-black), and the current room's own colours spread from its
 * centre in a growing circle, clipped to the room, once the tour reaches it. Moving on draws the
 * colour back before the next room fills. Same timings as the 3D reveal.
 *
 * A veil over the plan does the greying with `backdrop-filter`; its mask cuts the room ∩ circle
 * out of it, so the plan underneath shows through in colour. The room's shapes are read from the
 * plan's own SVG (`g[data-floorplan-node-id]`) and mapped through their screen matrices, so the
 * hole follows the plan's pan, zoom and rotation.
 */

const SPREAD_S = 1.5
const DRAW_BACK_S = 0.5
const SHAPES = 'path, polygon, polyline, rect, circle, ellipse'

const easeOut = (t: number) => 1 - (1 - t) ** 3

export function TourPlan() {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const veilRef = useRef<HTMLDivElement>(null)

  // The plan mounts its SVG on its own schedule: wait for it.
  useEffect(() => {
    let frame = 0
    const find = () => {
      const svg = document.querySelector<SVGSVGElement>('svg[data-floorplan-preview]')
      const parent = svg?.parentElement
      if (parent) setHost(parent)
      else frame = requestAnimationFrame(find)
    }
    find()
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!host) return
    const serializer = new XMLSerializer()
    const state = { room: null as string | null, progress: 0, spreadAt: 0, spreadFrom: 0, last: performance.now() / 1000 }
    let lastMask = ''
    let frame = 0

    const tick = () => {
      frame = requestAnimationFrame(tick)
      const veil = veilRef.current
      const svg = host.querySelector<SVGSVGElement>('svg[data-floorplan-preview]')
      if (!veil || !svg) return

      const now = performance.now() / 1000
      const delta = Math.min(0.1, now - state.last)
      state.last = now
      const look = useTourLook.getState()

      if (look.roomId !== state.room) {
        if (state.progress > 0.001) state.progress = Math.max(0, state.progress - delta / DRAW_BACK_S)
        else {
          state.room = look.roomId
          state.progress = 0
          state.spreadAt = 0
        }
      } else if (state.room && look.arrived) {
        if (!state.spreadAt) {
          state.spreadAt = now
          state.spreadFrom = state.progress
        }
        const t = Math.min(1, (now - state.spreadAt) / SPREAD_S)
        state.progress = state.spreadFrom + (1 - state.spreadFrom) * easeOut(t)
      }

      const rect = svg.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))
      let hole = ''
      const group = state.room && state.progress > 0.001
        ? svg.querySelector(`g[data-floorplan-node-id="${CSS.escape(state.room)}"]`)
        : null
      if (group) {
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        const shapes: string[] = []
        for (const shape of group.querySelectorAll<SVGGraphicsElement>(SHAPES)) {
          const ctm = shape.getScreenCTM()
          if (!ctm) continue
          const box = shape.getBoundingClientRect()
          if (box.width === 0 && box.height === 0) continue
          minX = Math.min(minX, box.left - rect.left)
          minY = Math.min(minY, box.top - rect.top)
          maxX = Math.max(maxX, box.right - rect.left)
          maxY = Math.max(maxY, box.bottom - rect.top)
          const copy = shape.cloneNode(false) as SVGGraphicsElement
          for (const name of ['class', 'style', 'id', 'clip-path', 'mask', 'filter', 'opacity', 'fill-opacity']) copy.removeAttribute(name)
          copy.setAttribute('fill', '#000')
          copy.setAttribute('stroke', 'none')
          copy.setAttribute(
            'transform',
            `matrix(${ctm.a} ${ctm.b} ${ctm.c} ${ctm.d} ${ctm.e - rect.left} ${ctm.f - rect.top})`,
          )
          shapes.push(serializer.serializeToString(copy))
        }
        if (shapes.length) {
          const cx = (minX + maxX) / 2
          const cy = (minY + maxY) / 2
          const reach = Math.hypot(maxX - minX, maxY - minY) / 2 + 2
          const radius = (reach * state.progress).toFixed(1)
          hole = `<clipPath id="c"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius}"/></clipPath>`
            + `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">`
            + `<rect width="${width}" height="${height}" fill="#fff"/><g clip-path="url(#c)">${shapes.join('')}</g></mask>`
        }
      }

      // White everywhere but the room ∩ circle: the veil greys all of the plan except there.
      const mask = hole
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>${hole}</defs>`
          + `<rect width="${width}" height="${height}" fill="#fff" mask="url(#m)"/></svg>`
        : ''
      if (mask !== lastMask) {
        lastMask = mask
        const value = mask ? `url("data:image/svg+xml,${encodeURIComponent(mask)}")` : 'none'
        veil.style.maskImage = value
        veil.style.setProperty('-webkit-mask-image', value)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [host])

  if (!host) return null
  return createPortal(<div aria-hidden="true" className="tour-plan-veil" ref={veilRef} />, host)
}

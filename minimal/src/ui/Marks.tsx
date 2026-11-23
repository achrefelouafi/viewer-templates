import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerHover } from '../viewer/semantics'
import type { Room } from '../spaces'
import { measuredDistance, useMeasure } from '../viewer/measure'
import { type TagScreen, useRoomTagScreen } from '../viewer/roomTags'
import { formatArea, formatLength } from './format'
import { Icon } from './icons'
import { type Area, placeTags } from './tagLayout'
import { navigation } from '../viewer/navigation'

/** The tag beside the pointer: the floor or room under it with its area, or, inside a picked room, the item. */
export function PointerTag({ hover }: { hover: PointerHover }) {
  // Above and to the right of the pointer; to its left near the right edge.
  const flip = hover.x > window.innerWidth - 260
  return (
    <div
      className={`tag pointer-tag${flip ? ' flip' : ''}${hover.kind === 'thing' ? ' is-thing' : ''}`}
      style={{ left: flip ? hover.x - 14 : hover.x + 14, top: hover.y - 14 }}
    >
      <span aria-hidden className="tag-dot" />
      <span>{hover.label}</span>
      {hover.area !== undefined ? <span className="tag-meta mono">{formatArea(hover.area)}</span> : null}
    </div>
  )
}

/** The screen the overlay's panels cover (`navigation.insets`), which tags keep off. */
function panelAreas(): Area[] {
  const { top, right, bottom, left } = navigation.insets
  const width = window.innerWidth
  const height = window.innerHeight
  return [
    { left: 0, top: 0, right: width, bottom: top },
    { left: width - right, top: 0, right: width, bottom: height },
    { left: 0, top: height - bottom, right: width, bottom: height },
    { left: 0, top: 0, right: left, bottom: height },
  ].filter((area) => area.right > area.left && area.bottom > area.top)
}

/** How long the view must stand still before tags are placed again (ms). */
const SETTLE_MS = 150

/**
 * The tag screen as it last stood still for `SETTLE_MS`, or the live one as soon as `key`
 * (what is tagged and how) changes.
 */
function useSettledScreen(live: TagScreen, key: string): TagScreen {
  const [settled, setSettled] = useState({ screen: live, key })
  // A new key places at once, during this render.
  if (settled.key !== key) setSettled({ screen: live, key })
  useEffect(() => {
    const timer = setTimeout(() => setSettled({ screen: live, key }), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [live, key])
  return settled.key === key ? settled.screen : live
}

/** Rooms smaller than this (m²) show as a dot… */
const SMALL_ROOM = 3
/** …until zoomed in so far that the room spans this many CSS pixels across. */
const ZOOMED_IN = 140

/**
 * Tags pinned on the rooms of the floor shown: each above the middle of its floor, with its area.
 * Clicking one opens the room; pointing at one (or at its room) lights it. The open room's is
 * filled in the accent. Tags never overlap: the open room's places first, then the larger rooms;
 * one that finds no clear spot collapses to a dot (none if even that would overlap), which opens
 * out while it or its room is pointed at. Tags carry no mark at rest; pointed at, a filled accent one.
 */
export function RoomTags({ rooms, currentId, hotId, onRoom, onPreview }: {
  rooms: Room[]
  currentId: string | null
  hotId: string | null
  onRoom: (id: string) => void
  onPreview: (id: string | null) => void
}) {
  const live = useRoomTagScreen()
  const screen = live.points
  // Each tag's size when open, measured once it has been drawn open; pins keep the last one.
  const sizes = useRef(new Map<string, { width: number; height: number }>())
  const elements = useRef(new Map<string, HTMLButtonElement>())
  const [measured, setMeasured] = useState(0)
  // Which tags open, nudge or fold is decided on the view as it last stood still: while the
  // camera turns or zooms, tags ride their anchors as they were placed, instead of flipping
  // every frame. What changes the set (rooms, the open room, sizes, what is on screen) places at once.
  const onScreen = rooms.filter((room) => screen[room.id]).map((room) => room.id).join()
  const settled = useSettledScreen(live, `${onScreen}|${currentId}|${measured}`)
  const placement = useMemo(
    () =>
      placeTags(
        rooms.flatMap((room) => {
          const at = settled.points[room.id]
          if (!at) return []
          // Not measured yet: drawn open this once, overlapping nothing, then placed for real.
          const size = sizes.current.get(room.id) ?? { width: 0, height: 0 }
          const current = room.id === currentId
          const small = !current && room.area < SMALL_ROOM && Math.sqrt(room.area) * settled.pixelsPerMetre < ZOOMED_IN
          return [{ id: room.id, ...at, ...size, priority: current ? Number.MAX_VALUE : room.area, small, keep: current }]
        }),
        panelAreas(),
      ),
    // `measured` changes when a size does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rooms, settled, currentId, measured],
  )
  useLayoutEffect(() => {
    let changed = false
    for (const [id, element] of elements.current) {
      // Pins keep their open size; a tag pointed at grows its mark and must not reflow the rest.
      if (element.classList.contains('is-collapsed') || element.classList.contains('is-hot')) continue
      const size = { width: element.offsetWidth, height: element.offsetHeight }
      const before = sizes.current.get(id)
      if (before && Math.abs(before.width - size.width) < 1 && Math.abs(before.height - size.height) < 1) continue
      sizes.current.set(id, size)
      changed = true
    }
    if (changed) setMeasured((count) => count + 1)
  })
  return (
    <div className="room-tags">
      {rooms.map((room) => {
        const at = screen[room.id]
        if (!at) return null
        const current = room.id === currentId
        const hot = !current && hotId === room.id
        const place = placement.get(room.id) ?? 0
        const collapsed = typeof place === 'string' && !hot
        // With a room open, the others' tags step back.
        const dim = currentId !== null && !current && !hot ? ' is-dim' : ''
        const state = current
          ? ' is-current'
          : hot
            ? ' is-hot'
            : collapsed
              ? ` is-collapsed${place === 'hidden' ? ' is-hidden' : ''}${dim}`
              : dim
        return (
          <button
            aria-current={current ? 'true' : undefined}
            className={`tag room-tag${state}`}
            key={room.id}
            onBlur={() => onPreview(null)}
            onClick={() => {
              onPreview(null)
              if (!current) onRoom(room.id)
            }}
            onFocus={() => !current && onPreview(room.id)}
            onPointerEnter={() => !current && onPreview(room.id)}
            onPointerLeave={() => onPreview(null)}
            ref={(element) => {
              if (element) elements.current.set(room.id, element)
              else elements.current.delete(room.id)
            }}
            // A pin pointed at opens out on its anchor, over the others.
            // The nudge is a transition (styles.css), so a tag moving to a new spot slides there.
            style={{ left: at.x, top: at.y, '--nudge': `${typeof place === 'number' ? place : 0}px` } as CSSProperties}
            title={collapsed ? `${room.name}, ${formatArea(room.area)}` : undefined}
            type="button"
          >
            <span aria-hidden className="tag-dot" />
            <span>{room.name}</span>
            <span className="tag-meta mono">{formatArea(room.area)}</span>
          </button>
        )
      })}
    </div>
  )
}

/** The measure tool's marks over the drawing: a ring on each point, the line, the distance. */
export function MeasureMarks() {
  const { active, points, screen } = useMeasure()
  if (!active) return null
  const [a, b] = screen.points
  const distance = measuredDistance(points)
  return (
    <div aria-hidden className="measure-marks">
      {a && b ? (
        <svg className="measure-line">
          <line x1={a.x} x2={b.x} y1={a.y} y2={b.y} />
        </svg>
      ) : null}
      {screen.points.map((point, i) =>
        point ? <span className="snap-ring is-set" key={i} style={{ left: point.x, top: point.y }} /> : null,
      )}
      {screen.preview && points.length < 2 ? (
        <span className="snap-ring" style={{ left: screen.preview.x, top: screen.preview.y }} />
      ) : null}
      {a && b && distance !== null ? (
        <span className="readout mono" style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 }}>
          {formatLength(distance)}
        </span>
      ) : null}
    </div>
  )
}

/** A short message at the top, for what the browser refused. */
export function Toast({ message }: { message: string | null }) {
  return (
    <div aria-live="polite" className={message ? 'toast is-open' : 'toast'} role="status">
      {message}
    </div>
  )
}

const SHORTCUTS: [string, [string, ...string[]][]][] = [
  [
    'Navigate',
    [
      ['Turn the building a quarter', '←', '→'],
      ['Axonometric or plan', 'P'],
      ['Frame the building', 'F'],
      ['Open or close spaces', 'S'],
      ['Search spaces', '/'],
      ['All floors, then each floor', '1', '…'],
      ['Step back one level', 'Esc'],
    ],
  ],
  [
    'Tools',
    [
      ['Measure', 'M'],
      ['Section', 'X'],
      ['This sheet', '?'],
    ],
  ],
]

/** The shortcut sheet, a modal dialog. */
export function Help({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])
  return (
    <dialog
      aria-labelledby="help-title"
      className="help"
      onClick={(event) => event.target === event.currentTarget && onClose()}
      onClose={onClose}
      ref={dialog}
    >
      <div className="help-head">
        <h2 id="help-title">Shortcuts</h2>
        <button aria-label="Close shortcuts" className="icon-btn" onClick={onClose} type="button">
          <Icon name="close" />
        </button>
      </div>
      <div className="help-body scroll">
        {SHORTCUTS.map(([title, rows]) => (
          <section key={title}>
            <h3>{title}</h3>
            <dl className="keys">
              {rows.map(([label, ...keys]) => (
                <div className="keys-row" key={label}>
                  <dt>
                    {keys.map((key) => (
                      <kbd key={key}>{key}</kbd>
                    ))}
                  </dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p>
          Drag to turn, scroll or pinch to zoom, right-drag to pan, double-click to zoom in. With every floor
          shown, click a floor to show it alone. Then hover a room to see into it and click it to open it; inside,
          click an item for its details, or a door or window to open it.
        </p>
      </div>
    </dialog>
  )
}

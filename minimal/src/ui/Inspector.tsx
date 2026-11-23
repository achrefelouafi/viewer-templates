import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import type { Floor, Room, Thing } from '../spaces'
import { formatArea, formatLength } from './format'
import { Icon } from './icons'

type InspectorProps = {
  room: Room | null
  floor: Floor | null
  /** Shown when there is more than one floor to go back to. */
  allFloors: boolean
  contents: Thing[]
  thing: Thing | null
  closeRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onLevel: (id: string | null) => void
  onThing: (id: string | null) => void
  /** The items a contents row stands for, while the pointer or focus is on it; empty after. */
  onPoint: (ids: readonly string[]) => void
}

/** The details of the picked room, or of the item picked in it. */
export function Inspector(props: InspectorProps) {
  const { room, thing, closeRef, onClose } = props
  const body = useRef<HTMLDivElement>(null)
  const open = !!room
  useEffect(() => {
    body.current?.scrollTo(0, 0)
  }, [room?.id, thing?.id])
  return (
    <aside aria-label="Details" className={open ? 'panel insp chrome-surface is-open' : 'panel insp chrome-surface'} inert={!open}>
      <div className="insp-head">
        <div className="insp-heading">
          <p className="insp-kind">
            {/* The floor is in the crumbs below. */}
            {thing ? `Item · ${room?.name ?? ''}` : room ? 'Room' : ''}
          </p>
          <h2 className="insp-title">{thing?.name ?? room?.name ?? ''}</h2>
        </div>
        <button aria-label={thing ? 'Back to the room' : 'Close details'} className="icon-btn" onClick={onClose} ref={closeRef} title="Close (Esc)" type="button">
          <Icon name="close" />
        </button>
      </div>
      <div className="insp-body scroll" ref={body}>
        {room ? thing ? <ThingDetails {...props} room={room} thing={thing} /> : <RoomDetails key={room.id} {...props} room={room} /> : null}
      </div>
    </aside>
  )
}

function Crumbs({ parts }: { parts: { label: string; onClick: () => void }[] }) {
  return (
    <nav aria-label="Location" className="crumbs">
      {parts.map((part, i) => (
        <span className="crumb-part" key={part.label + i}>
          {i ? <span aria-hidden className="crumb-sep">/</span> : null}
          <button className="crumb" onClick={part.onClick} type="button">
            {part.label}
          </button>
        </span>
      ))}
    </nav>
  )
}

function Stats({ items }: { items: [string, string | null][] }) {
  const shown = items.filter((item): item is [string, string] => item[1] !== null)
  if (!shown.length) return null
  return (
    <div className="stats">
      {shown.map(([caption, value]) => (
        <div className="stat" key={caption}>
          <span className="stat-val mono">{value}</span>
          <span className="stat-cap">{caption}</span>
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sect">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Pairs({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="kv">
      {rows.map(([key, value]) => (
        <div className="kv-row" key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function crumbsTo(props: InspectorProps, room?: Room) {
  const parts: { label: string; onClick: () => void }[] = []
  if (props.allFloors) parts.push({ label: 'All floors', onClick: () => props.onLevel(null) })
  if (props.floor) parts.push({ label: props.floor.name, onClick: () => props.onLevel(props.floor!.id) })
  if (room) parts.push({ label: room.name, onClick: () => props.onThing(null) })
  return parts
}

/** Contents rows shown before "Show all". */
const CONTENTS_SHOWN = 8

function RoomDetails(props: InspectorProps & { room: Room }) {
  const { room, contents, onThing, onPoint } = props
  const [width, depth] = room.size
  // An L or U shaped room fills less than its bounding box: those are its extents, not its size.
  const rectangular = Math.abs(width * depth - room.area) <= room.area * 0.03
  // Identical items (six ceiling lights) share a row with their count.
  const rows = new Map<string, Thing[]>()
  for (const thing of contents) rows.set(thing.name, [...(rows.get(thing.name) ?? []), thing])
  const [all, setAll] = useState(false)
  const listed = all || rows.size <= CONTENTS_SHOWN + 1 ? [...rows] : [...rows].slice(0, CONTENTS_SHOWN)
  return (
    <>
      <Crumbs parts={crumbsTo(props)} />
      <Stats
        items={[
          ['Area', formatArea(room.area)],
          [rectangular ? 'Size' : 'Extents', `${width.toFixed(1)} × ${depth.toFixed(1)} m`],
          ['Ceiling', room.ceiling ? formatLength(room.ceiling) : null],
        ]}
      />
      {room.details.length ? (
        <Section title="Details">
          <Pairs rows={room.details} />
        </Section>
      ) : null}
      <Section title="Contents">
        {contents.length ? (
          <ul className="contents">
            {listed.map(([name, things]) => {
              const ids = things.map((thing) => thing.id)
              return (
                <li key={ids[0]}>
                  <button
                    className="item-btn"
                    onBlur={() => onPoint([])}
                    onClick={() => {
                      onPoint([])
                      onThing(ids[0]!)
                    }}
                    onFocus={() => onPoint(ids)}
                    onPointerEnter={() => onPoint(ids)}
                    onPointerLeave={() => onPoint([])}
                    type="button"
                  >
                    <span className="name">{name}</span>
                    {ids.length > 1 ? <span className="count mono">×{ids.length}</span> : null}
                    <Icon name="arrow" />
                  </button>
                </li>
              )
            })}
            {listed.length < rows.size ? (
              <li>
                <button className="text-btn show-all" onClick={() => setAll(true)} type="button">
                  Show all {rows.size}
                </button>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="plain">Nothing is placed in this room.</p>
        )}
      </Section>
      <p className="note">Click an item in the room, or in this list, for its details.</p>
    </>
  )
}

function ThingDetails(props: InspectorProps & { room: Room; thing: Thing }) {
  const { room, thing } = props
  const specification: [string, string][] = []
  if (thing.category) specification.push(['Category', thing.category])
  if (thing.model) specification.push(['Model', thing.model])
  return (
    <>
      <Crumbs parts={crumbsTo(props, room)} />
      <Stats
        items={[
          ['Width', thing.size ? formatLength(thing.size[0]) : null],
          ['Depth', thing.size ? formatLength(thing.size[1]) : null],
          ['Height', thing.size ? formatLength(thing.size[2]) : null],
        ]}
      />
      {specification.length ? (
        <Section title="Specification">
          <Pairs rows={specification} />
        </Section>
      ) : null}
      <p className="note">Sizes are the catalogue item's, as placed.</p>
    </>
  )
}

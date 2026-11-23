import { type RefObject, useMemo, useState } from 'react'
import type { Room, Spaces } from '../spaces'
import { formatArea, plural } from './format'
import { Icon } from './icons'

type MastheadProps = {
  title: string
  subtitle: string
  spaces: Spaces
  open: boolean
  /** The spaces button shows once the drawing is ready. */
  ready: boolean
  onToggle: () => void
}

/** The project's name, and the button that opens its floors and rooms. */
export function Masthead({ title, subtitle, spaces, open, ready, onToggle }: MastheadProps) {
  const rooms = spaces.rooms.size
  return (
    <header className="masthead">
      <div className="title">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {ready ? (
        <button
          aria-controls="spaces"
          aria-expanded={open}
          className="spaces-toggle chrome-surface"
          onClick={onToggle}
          title="Spaces (S)"
          type="button"
        >
          <Icon name="layers" />
          <span>Spaces</span>
          <span className="meta mono">
            {rooms ? `${plural(rooms, 'room')} · ${formatArea(spaces.area)}` : plural(spaces.floors.length, 'floor')}
          </span>
          <Icon className="icon chevron" name="chevron" />
        </button>
      ) : null}
    </header>
  )
}

type SpacesPanelProps = {
  spaces: Spaces
  open: boolean
  levelId: string | null
  roomId: string | null
  /** The room or floor pointed at, on the drawing, a tag or here: its row takes the hover tint. */
  hotId: string | null
  searchRef: RefObject<HTMLInputElement | null>
  onLevel: (id: string | null) => void
  onRoom: (id: string) => void
  onPreview: (id: string | null) => void
}

/** Every floor with its rooms, top floor first, and a search over room names. */
export function SpacesPanel({ spaces, open, levelId, roomId, hotId, searchRef, onLevel, onRoom, onPreview }: SpacesPanelProps) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const hits = useMemo(
    () => (needle ? [...spaces.rooms.values()].filter((room) => room.name.toLowerCase().includes(needle)) : []),
    [needle, spaces],
  )
  const several = spaces.floors.length > 1

  const roomRow = (room: Room, nested: boolean) => (
    <li key={room.id}>
      <button
        aria-current={roomId === room.id || undefined}
        className={`nav-row${nested ? ' is-room' : ''}${hotId === room.id && roomId !== room.id ? ' is-hot' : ''}`}
        onBlur={() => onPreview(null)}
        onClick={() => onRoom(room.id)}
        onFocus={() => onPreview(room.id)}
        onPointerEnter={() => onPreview(room.id)}
        onPointerLeave={() => onPreview(null)}
        type="button"
      >
        <span aria-hidden className="mark" />
        <span className="name truncate">{room.name}</span>
        <span className="area mono">{formatArea(room.area)}</span>
      </button>
    </li>
  )

  return (
    <nav aria-label="Spaces" className={open ? 'panel nav chrome-surface is-open' : 'panel nav chrome-surface'} id="spaces" inert={!open}>
      <div className="nav-search">
        <label htmlFor="spaces-search">Search spaces</label>
        <div className="search-box">
          <Icon name="search" />
          <input
            autoComplete="off"
            id="spaces-search"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.stopPropagation()
              if (query) setQuery('')
              else event.currentTarget.blur()
            }}
            placeholder="Room name"
            ref={searchRef}
            spellCheck={false}
            type="search"
            value={query}
          />
        </div>
      </div>
      <div className="nav-list scroll">
        {needle ? (
          hits.length ? (
            <ul>{hits.map((room) => roomRow(room, false))}</ul>
          ) : (
            <div className="nav-empty">
              <p>
                No space matches <strong>“{query.trim()}”</strong>. Search looks at room names only.
              </p>
              <button className="text-btn" onClick={() => setQuery('')} type="button">
                Clear search
              </button>
            </div>
          )
        ) : (
          <>
            {several ? (
              <ul>
                <li>
                  <button aria-current={(!roomId && levelId === null) || undefined} className="nav-row is-floor" onClick={() => onLevel(null)} type="button">
                    <span aria-hidden className="mark" />
                    <span className="name">All floors</span>
                    <span className="area mono">{spaces.area ? formatArea(spaces.area) : ''}</span>
                  </button>
                </li>
              </ul>
            ) : null}
            {spaces.floors.map((floor) => (
              <ul className={several ? 'nav-group' : undefined} key={floor.id}>
                <li>
                  <button
                    aria-current={(!roomId && levelId === floor.id) || undefined}
                    className={`nav-row is-floor${hotId === floor.id ? ' is-hot' : ''}`}
                    onClick={() => onLevel(floor.id)}
                    type="button"
                  >
                    <span aria-hidden className="mark" />
                    <span className="name truncate">{floor.name}</span>
                    <span className="area mono">{floor.rooms.length ? formatArea(floor.area) : ''}</span>
                  </button>
                </li>
                {floor.rooms.map((room) => roomRow(room, true))}
              </ul>
            ))}
          </>
        )}
      </div>
    </nav>
  )
}

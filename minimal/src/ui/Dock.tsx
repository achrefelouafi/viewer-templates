import { useRef } from 'react'
import type { Floor } from '../spaces'
import { measure, measuredDistance, useMeasure } from '../viewer/measure'
import { navigation, useProjection } from '../viewer/navigation'
import { formatLength, plural } from './format'
import { Icon } from './icons'

export type Tool = 'measure' | 'section'

type DockProps = {
  tool: Tool | null
  floors: Floor[]
  levelId: string | null
  onTool: (tool: Tool) => void
  onLevel: (id: string | null) => void
  onFullScreen: () => void
  onHelp: () => void
}

/**
 * The bottom of the screen: the view's controls in one bar, and above it the strip of the tool
 * that is on (measure, or section).
 */
export function Dock({ tool, floors, levelId, onTool, onLevel, onFullScreen, onHelp }: DockProps) {
  const projection = useProjection()
  return (
    <div className="dock">
      {tool === 'measure' ? <MeasureStrip onDone={() => onTool('measure')} /> : null}
      {tool === 'section' ? <SectionStrip floors={floors} levelId={levelId} onDone={() => onTool('section')} onLevel={onLevel} /> : null}
      <div aria-label="Viewer controls" className="bar chrome-surface" role="toolbar">
        <div aria-label="Projection" className="seg" role="group">
          <button aria-pressed={projection === 'axonometric'} className="seg-btn" onClick={() => navigation.setProjection('axonometric')} title="Axonometric (P)" type="button">
            Axo
          </button>
          <button aria-pressed={projection === 'plan'} className="seg-btn" onClick={() => navigation.setProjection('plan')} title="Plan (P)" type="button">
            Plan
          </button>
        </div>
        <span aria-hidden className="bar-sep bar-turn" />
        <button aria-label="Turn left" className="icon-btn bar-turn" data-tip="Turn left · ←" onClick={() => navigation.rotate(-1)} type="button">
          <Icon name="turnLeft" />
        </button>
        <button aria-label="Turn right" className="icon-btn bar-turn" data-tip="Turn right · →" onClick={() => navigation.rotate(1)} type="button">
          <Icon name="turnRight" />
        </button>
        <span aria-hidden className="bar-sep" />
        <ToolButton icon="measure" label="Measure" onClick={() => onTool('measure')} pressed={tool === 'measure'} shortcut="M" />
        <ToolButton icon="section" label="Section" onClick={() => onTool('section')} pressed={tool === 'section'} shortcut="X" />
        <span aria-hidden className="bar-sep" />
        <button aria-label="Frame the building" className="icon-btn" data-tip="Frame · F" onClick={() => navigation.fit()} type="button">
          <Icon name="frame" />
        </button>
        <button aria-label="Full screen" className="icon-btn bar-full" data-tip="Full screen" onClick={onFullScreen} type="button">
          <Icon name="fullScreen" />
        </button>
        <button aria-label="Shortcuts and help" className="icon-btn" data-tip="Shortcuts · ?" onClick={onHelp} type="button">
          <Icon name="help" />
        </button>
      </div>
    </div>
  )
}

function ToolButton({ icon, label, shortcut, pressed, onClick }: {
  icon: 'measure' | 'section'
  label: string
  shortcut: string
  pressed: boolean
  onClick: () => void
}) {
  return (
    <button aria-label={label} aria-pressed={pressed} className="icon-btn tool-btn" data-tip={`${label} · ${shortcut}`} onClick={onClick} type="button">
      <Icon name={icon} />
      <span className="tool-label">{label}</span>
    </button>
  )
}

function MeasureStrip({ onDone }: { onDone: () => void }) {
  const { points } = useMeasure()
  const distance = measuredDistance(points)
  const status =
    distance !== null ? `Distance ${formatLength(distance)}` : points.length === 1 ? 'Pick a second point' : 'Pick a first point'
  return (
    <div aria-label="Measure" className="strip chrome-surface" role="group">
      <div className="strip-text">
        <p aria-live="polite" className="strip-status">
          {status}
        </p>
        <p className="strip-sub">Click two points on the drawing; corners snap</p>
      </div>
      <div className="strip-actions">
        <button className="text-btn" disabled={!points.length} onClick={() => measure.clear()} type="button">
          Clear
        </button>
        <button className="text-btn" onClick={onDone} type="button">
          Done
        </button>
      </div>
    </div>
  )
}

/** Cuts the building above a floor: the floor shown alone, without its ceilings and roof. */
function SectionStrip({ floors, levelId, onLevel, onDone }: {
  floors: Floor[]
  levelId: string | null
  onLevel: (id: string | null) => void
  onDone: () => void
}) {
  const group = useRef<HTMLDivElement>(null)
  const options = [
    { id: null, name: 'No cut', sub: 'Whole building' },
    ...floors.map((floor) => ({
      id: floor.id,
      name: floor.name,
      sub: floor.rooms.length ? plural(floor.rooms.length, 'room') : 'No rooms',
    })),
  ]
  const current = Math.max(0, options.findIndex((option) => option.id === levelId))
  return (
    <div aria-label="Section" className="strip chrome-surface" role="group">
      <div
        aria-label="Cut above"
        className="cut"
        onKeyDown={(event) => {
          const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
          if (!step) return
          event.preventDefault()
          event.stopPropagation()
          const next = (current + step + options.length) % options.length
          onLevel(options[next]!.id)
          group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
        }}
        ref={group}
        role="radiogroup"
      >
        {options.map((option, i) => (
          <button
            aria-checked={i === current}
            className="cut-btn"
            key={option.id ?? 'all'}
            onClick={() => onLevel(option.id)}
            role="radio"
            tabIndex={i === current ? 0 : -1}
            type="button"
          >
            <span className="cut-name">{option.name}</span>
            <span className="cut-h">{option.sub}</span>
          </button>
        ))}
      </div>
      <div className="strip-actions">
        <button className="text-btn" onClick={onDone} type="button">
          Done
        </button>
      </div>
    </div>
  )
}

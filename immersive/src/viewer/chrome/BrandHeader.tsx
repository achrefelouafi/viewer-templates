import { useLocale, usePascalI18n } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { viewerSidebarSections, type ViewerSource } from '@pascal-app/viewer/ui'
import { ArrowUpRight, Handshake } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import type { LevelEntry } from './ExplorePanel'
import { splitFormattedArea } from './planGeometry'

/**
 * Production's top-left lockup: the Pascal wordmark over "Building Intelligence", then the
 * project's name and a few facts (floors, rooms, living area) and who made it. Drawn straight
 * on the scene like the editor's /next page, and faded with the rest of the chrome when idle.
 */
export function BrandHeader({
  projectName,
  ownerName,
  levels,
  source,
}: {
  projectName: string | null
  ownerName: string | null
  levels: readonly LevelEntry[]
  source: ViewerSource
}) {
  const i18n = usePascalI18n()
  const locale = useLocale()
  const unit = useViewer((s) => s.unit)

  const facts = useMemo(() => {
    let rooms = 0
    let area = 0
    for (const level of levels) {
      for (const section of viewerSidebarSections(level.id, source.nodes, i18n)) {
        if (section.kind === 'units') continue
        rooms += section.rows.length
        for (const row of section.rows) area += row.areaM2 || 0
      }
    }
    return { floors: levels.length, rooms, area }
  }, [levels, source.nodes, i18n])

  const area = facts.area > 0 ? splitFormattedArea(Math.round(facts.area), unit, locale) : null

  return (
    <div
      className="ui-enter-left ui-immersive-transition pointer-events-none absolute top-5 left-5 z-20 select-none"
      data-brand-header=""
      data-chrome-edge="left"
      data-chrome-surface=""
    >
      <a
        aria-label="Pascal (opens in a new tab)"
        className="brand-lockup pointer-events-auto"
        href="https://editor.pascal.app/"
        rel="noopener noreferrer"
        target="_blank"
      >
        <span aria-hidden="true" className="brand-logo" />
        <span className="brand-tagline">Building Intelligence</span>
      </a>

      <section aria-label="About the project" className="brand-facts">
        <h1>{projectName || 'Untitled'}</h1>
        <dl>
          {facts.floors > 0 ? (
            <div>
              <dt>{facts.floors === 1 ? 'Floor' : 'Floors'}</dt>
              <dd>{facts.floors}</dd>
            </div>
          ) : null}
          {facts.rooms > 0 ? (
            <div>
              <dt>{facts.rooms === 1 ? 'Room' : 'Rooms'}</dt>
              <dd>{facts.rooms}</dd>
            </div>
          ) : null}
          {area ? (
            <div>
              <dt>
                {area.unitText}
                {area.hasSquare ? '²' : ''} of living
              </dt>
              <dd>{area.value.replace(/[.,]0+$/, '')}</dd>
            </div>
          ) : null}
        </dl>
        {ownerName ? (
          <p>
            <span>By {ownerName}</span>
            <span>Made with Pascal</span>
          </p>
        ) : null}
      </section>
    </div>
  )
}

/** One link in the explore panel's strip: an icon whose label slides out on hover or focus. */
function RevealLink({ href, label, icon, primary = false }: { href: string; label: string; icon: ReactNode; primary?: boolean }) {
  return (
    <a
      aria-label={`${label} (opens in a new tab)`}
      className="reveal-link ui-dock-item"
      data-primary={primary || undefined}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      <span aria-hidden="true" className="reveal-link-icon">
        {icon}
      </span>
      <span aria-hidden="true" className="reveal-link-label">
        {label}
      </span>
    </a>
  )
}

function XMark() {
  return (
    <svg aria-hidden="true" fill="currentColor" focusable="false" viewBox="0 0 24 24">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.47l8.6-9.835L0 1.154h7.594l5.243 6.932 6.064-6.933ZM17.61 20.646h2.039L6.487 3.24H4.3L17.61 20.646Z" />
    </svg>
  )
}

/** Get started, Partner with us and Pascal on X, as icons in the explore panel's container. */
export function OutreachLinks() {
  return (
    <span className="flex items-center gap-0.5">
      <RevealLink href="https://editor.pascal.app/" icon={<ArrowUpRight />} label="Get started with Pascal" primary />
      <RevealLink href="https://editor.pascal.app/next" icon={<Handshake />} label="Partner with us" />
      <RevealLink href="https://x.com/pascal" icon={<XMark />} label="Follow @pascal on X" />
    </span>
  )
}

import { useLocale, usePascalI18n } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  applyViewerClick,
  frameViewerNode,
  localizedLevelName,
  roomOfObject,
  selectViewerBuilding,
  selectViewerLevel,
  selectViewerRoom,
  selectViewerUnit,
  viewerBreadcrumb,
  type ViewerCrumb,
  viewerSidebarSections,
  type ViewerSource,
} from '@pascal-app/viewer/ui'
import { ChevronRight, Route, X } from 'lucide-react'
import { useMemo } from 'react'
import type { GuidedTour } from '../../tour/useGuidedTour'
import { buildRoomThumbnail, splitFormattedArea } from './planGeometry'

type LevelLike = { id: string; type?: string; level?: number; name?: string }
type NamedNodeLike = { name?: string; asset?: { name?: string }; type?: string }

/** Turns raw plugin/node kind identifiers like "trees:tree" or "utility-pole" into sentence case. */
function humaniseKind(raw: string): string {
  const base = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw
  const words = base.replace(/[-_]+/g, ' ').trim()
  if (!words) return 'Object'
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Ensures breadcrumbs and card titles never expose raw "plugin:kind" or kebab-case node types. */
function friendlyCrumbLabel(crumb: ViewerCrumb, nodes: ViewerSource['nodes']): string {
  if (crumb.kind !== 'node') return crumb.label
  const node = nodes[crumb.id] as unknown as NamedNodeLike | undefined
  const explicit = node?.name?.trim()
  if (explicit) return explicit
  const assetName = node?.asset?.name?.trim()
  if (assetName) return assetName
  const label = crumb.label.trim()
  if (label && !label.includes(':') && !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(label)) return label
  return humaniseKind(label || node?.type || 'object')
}

/**
 * Editorial contextual selection card: top accent line in the room's colour, Barlow Light display
 * title, eyebrow with floor, large mono area with superscript unit, miniature SVG silhouette of
 * the room's actual shape, clickable `[data-testid="viewer-breadcrumb"]`, and "Tour from here".
 */
export function SelectionCard({ source, tour, compact, hidden = false, belowBrand = false }: {
  source: ViewerSource
  tour: GuidedTour
  compact: boolean
  hidden?: boolean
  /** The brand lockup holds the top-left corner: the card starts under it. */
  belowBrand?: boolean
}) {
  const i18n = usePascalI18n()
  const locale = useLocale()
  const selection = useViewer((s) => s.selection)
  const focusedUnitId = useViewer((s) => s.focusedUnitId)
  const unit = useViewer((s) => s.unit)

  const hasSelection = Boolean(selection.zoneId || focusedUnitId || selection.selectedIds.length > 0)

  const crumbs = useMemo(
    () =>
      hasSelection
        ? viewerBreadcrumb(selection, focusedUnitId, source.nodes, i18n, (nodeId, levelId) =>
            roomOfObject(nodeId, levelId, source),
          ).map((crumb) => ({ ...crumb, label: friendlyCrumbLabel(crumb, source.nodes) }))
        : [],
    [hasSelection, selection, focusedUnitId, source, i18n],
  )

  const selectedNodeId = selection.selectedIds[0] ?? null
  const roomZoneId =
    selection.zoneId ??
    (selectedNodeId && selection.levelId ? roomOfObject(selectedNodeId, selection.levelId, source) : null)

  const stopIndex = roomZoneId ? tour.stops.findIndex((stop) => stop.zoneId === roomZoneId) : -1
  const stop = stopIndex >= 0 ? tour.stops[stopIndex] : null

  const fallbackRow = useMemo(() => {
    if (stop || !selection.levelId) return null
    const targetId = focusedUnitId ?? selection.zoneId
    if (!targetId) return null
    for (const section of viewerSidebarSections(selection.levelId, source.nodes, i18n)) {
      const row = section.rows.find((entry) => entry.id === targetId)
      if (row) return row
    }
    return null
  }, [stop, selection.levelId, selection.zoneId, focusedUnitId, source.nodes, i18n])

  const roomThumb = useMemo(
    () => (roomZoneId ? buildRoomThumbnail(roomZoneId, selection.levelId, source.nodes, 48, 5) : null),
    [roomZoneId, selection.levelId, source.nodes],
  )

  const handleCrumb = (crumb: ViewerCrumb) => {
    switch (crumb.kind) {
      case 'building':
        selectViewerBuilding(source)
        return
      case 'level':
        selectViewerLevel(crumb.id, source)
        return
      case 'unit':
        selectViewerUnit(crumb.id, source)
        return
      case 'room':
        selectViewerRoom(crumb.id, source)
        return
      case 'node':
        applyViewerClick({ nodeId: crumb.id, point: null }, source.nodes)
        frameViewerNode(crumb.id, source)
    }
  }

  const clearSelection = () => {
    const viewer = useViewer.getState()
    viewer.setFocusedUnit(null)
    viewer.setSelection({ zoneId: null, selectedIds: [] })
  }

  if (hidden || !hasSelection || crumbs.length === 0) {
    return <div aria-live="polite" className="sr-only" />
  }

  const lastCrumb = crumbs[crumbs.length - 1]!
  const levelNode = selection.levelId ? (source.nodes[selection.levelId] as unknown as LevelLike | undefined) : undefined
  const floorLabel = stop?.floorName ?? (levelNode ? localizedLevelName(levelNode, i18n, locale) : null)
  const areaM2 = stop?.areaM2 ?? fallbackRow?.areaM2 ?? null
  const accentColor = stop?.color ?? fallbackRow?.color ?? null
  const area = areaM2 !== null ? splitFormattedArea(areaM2, unit, locale) : null

  return (
    <aside
      aria-label="Selection details"
      aria-live="polite"
      className={`ui-card-pop ui-immersive-transition ui-glass corner-smooth pointer-events-auto absolute z-30 overflow-hidden rounded-[20px] text-foreground ${
        compact
          ? 'inset-x-3 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.5rem)]'
          : `${belowBrand ? 'top-[11.25rem]' : 'top-4'} left-4 w-[19rem]`
      }`}
      data-chrome-edge={compact ? 'bottom' : 'left'}
      data-chrome-surface=""
      data-selection-card=""
      key={`${lastCrumb.kind}:${lastCrumb.id}`}
    >
      {/* Thin top accent bar tinted with the room's colour */}
      {accentColor ? (
        <div
          aria-hidden="true"
          className="h-[2.5px] w-full"
          style={{ background: `linear-gradient(90deg, ${accentColor}, color-mix(in srgb, ${accentColor} 35%, transparent))` }}
        />
      ) : null}

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="ui-eyebrow ui-eyebrow-rule max-w-full truncate">
              {floorLabel ?? lastCrumb.kind}
            </span>
            <h2 className="mt-1 truncate font-light text-[26px] text-foreground leading-[1.08] tracking-[-0.03em]">
              {lastCrumb.label}
            </h2>
            {area ? (
              <p className="mt-1.5 font-mono text-base text-foreground/85 leading-none tabular-nums">
                {area.value}
                {area.unitText ? <span className="ml-1 text-[11px] text-muted-foreground">{area.unitText}</span> : null}
                {area.hasSquare ? <sup className="text-[9px] text-muted-foreground">2</sup> : null}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-start gap-2">
            {roomThumb ? (
              <div
                aria-hidden="true"
                className="ui-drafting-plate grid h-12 w-12 place-items-center rounded-xl border border-foreground/10"
              >
                <svg className="h-11 w-11" viewBox="0 0 48 48">
                  <path
                    d={roomThumb}
                    fill={accentColor ?? 'currentColor'}
                    fillOpacity={0.28}
                    fillRule="evenodd"
                    stroke={accentColor ?? 'currentColor'}
                    strokeLinejoin="round"
                    strokeOpacity={0.9}
                    strokeWidth="1.25"
                  />
                </svg>
              </div>
            ) : null}

            <button
              aria-label="Clear selection"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
              onClick={clearSelection}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav
          aria-label="Selection"
          className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1 border-foreground/10 border-t pt-2.5 text-[11px]"
          data-testid="viewer-breadcrumb"
        >
          {crumbs.map((crumb, idx) => {
            const isLast = idx === crumbs.length - 1
            return (
              <span className="flex min-w-0 items-center gap-1" key={`${crumb.kind}:${crumb.id}`}>
                {idx > 0 ? <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 text-muted-foreground/50" /> : null}
                <button
                  className={`truncate rounded-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 ${
                    isLast ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                  data-crumb={crumb.kind}
                  onClick={() => handleCrumb(crumb)}
                  type="button"
                >
                  {crumb.label}
                </button>
              </span>
            )
          })}
        </nav>

        {stopIndex >= 0 ? (
          <button
            className="ui-sheen relative mt-3.5 flex h-10 w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-foreground px-4 font-medium text-background text-xs transition-opacity hover:opacity-95 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            onClick={() => tour.startAt(stopIndex)}
            type="button"
          >
            <Route className="h-3.5 w-3.5" />
            <span>Tour from here</span>
          </button>
        ) : null}
      </div>
    </aside>
  )
}

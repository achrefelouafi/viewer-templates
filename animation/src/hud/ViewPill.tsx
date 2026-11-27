import { useLocale, usePascalI18n } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  applyViewerClick,
  frameViewerNode,
  roomOfObject,
  selectViewerBuilding,
  selectViewerLevel,
  selectViewerRoom,
  selectViewerUnit,
  viewerBreadcrumb,
  type ViewerCrumb,
  type ViewerSource,
} from '@pascal-app/viewer/ui'
import { ChevronRight } from 'lucide-react'
import { useMemo } from 'react'

export function ViewPill({ source, padLeftClass, padRightClass }: {
  source: ViewerSource
  padLeftClass: string
  padRightClass: string
}) {
  const i18n = usePascalI18n()
  const catalogVersion = i18n.getVersion()
  const locale = useLocale()

  const walkthroughMode = useViewer((s) => s.walkthroughMode)
  const selection = useViewer((s) => s.selection)
  const focusedUnitId = useViewer((s) => s.focusedUnitId)

  const crumbs = useMemo(
    () => viewerBreadcrumb(selection, focusedUnitId, source.nodes, i18n, (nodeId, levelId) => roomOfObject(nodeId, levelId, source)),
    [selection, focusedUnitId, source, i18n, locale, catalogVersion],
  )

  if (walkthroughMode) return null
  if (crumbs.length === 0) return null

  const handleCrumb = (crumb: ViewerCrumb) => {
    switch (crumb.kind) {
      case 'building':
        return selectViewerBuilding(source)
      case 'level':
        return selectViewerLevel(crumb.id, source)
      case 'unit':
        return selectViewerUnit(crumb.id, source)
      case 'room':
        return selectViewerRoom(crumb.id, source)
      case 'node':
        applyViewerClick({ nodeId: crumb.id, point: null }, source.nodes)
        return frameViewerNode(crumb.id, source)
    }
  }

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center px-16 transition-[padding] duration-200 ease-out ${padLeftClass} ${padRightClass}`}
    >
      <div className="studio-hud-light pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full p-1">
        {crumbs.length > 0 && (
          <nav
            aria-label={i18n._({ id: 'viewer.header.selection', message: 'Selection' })}
            className="hud-scroll flex min-w-0 items-center gap-0.5 overflow-x-auto pr-2 pl-1 text-xs"
            data-testid="viewer-breadcrumb"
          >
            {crumbs.map((crumb, index) => {
              const isLast = index === crumbs.length - 1
              return (
                <span className="flex shrink-0 items-center gap-0.5" key={`${crumb.kind}:${crumb.id}`}>
                  {index > 0 && <ChevronRight aria-hidden className="size-3 shrink-0 text-[var(--glass-muted)]/60" />}
                  <button
                    className={`studio-interactive max-w-[9.5rem] truncate rounded-full px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] ${
                      isLast
                        ? 'font-semibold text-[var(--glass-ink)]'
                        : 'font-medium text-[var(--glass-muted)] hover:bg-[var(--glass-bg-hover)] hover:text-[var(--glass-ink)]'
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
        )}
      </div>
    </div>
  )
}

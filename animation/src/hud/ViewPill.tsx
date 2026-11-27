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
  useIsMobile,
  viewerBreadcrumb,
  type ViewerCrumb,
  type ViewerSource,
  type ViewerStageMode,
} from '@pascal-app/viewer/ui'
import { Box, ChevronRight, Columns2, Map as MapIcon } from 'lucide-react'
import { type KeyboardEvent, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

type StageOption = {
  id: ViewerStageMode
  label: string
  icon: typeof Box
}

export function ViewPill({ stageMode, onStageModeChange, hasFloorplan, source, padLeftClass, padRightClass }: {
  stageMode: ViewerStageMode
  onStageModeChange: (mode: ViewerStageMode) => void
  hasFloorplan: boolean
  source: ViewerSource
  padLeftClass: string
  padRightClass: string
}) {
  const i18n = usePascalI18n()
  const catalogVersion = i18n.getVersion()
  const locale = useLocale()
  const isMobile = useIsMobile()

  const walkthroughMode = useViewer((s) => s.walkthroughMode)
  const selection = useViewer((s) => s.selection)
  const focusedUnitId = useViewer((s) => s.focusedUnitId)

  const options = useMemo<StageOption[]>(() => {
    if (!hasFloorplan) return []
    const base: StageOption[] = [
      { id: '3d', label: '3D', icon: Box },
      { id: '2d', label: '2D', icon: MapIcon },
    ]
    if (!isMobile) {
      base.push({ id: 'split', label: i18n._({ id: 'viewer.stage.split', message: 'Split' }), icon: Columns2 })
    }
    return base
  }, [hasFloorplan, isMobile, i18n, locale, catalogVersion])

  const crumbs = useMemo(
    () => viewerBreadcrumb(selection, focusedUnitId, source.nodes, i18n, (nodeId, levelId) => roomOfObject(nodeId, levelId, source)),
    [selection, focusedUnitId, source, i18n, locale, catalogVersion],
  )

  // Measure the active segment to glide the sliding thumb cleanly.
  const groupRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Partial<Record<ViewerStageMode, HTMLButtonElement | null>>>({})
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)

  const measureThumb = useCallback(() => {
    const activeEl = itemRefs.current[stageMode]
    if (!activeEl) {
      setThumb(null)
      return
    }
    setThumb({ left: activeEl.offsetLeft, width: activeEl.offsetWidth })
  }, [stageMode])

  useLayoutEffect(() => {
    measureThumb()
    const group = groupRef.current
    if (!group || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measureThumb)
    observer.observe(group)
    return () => observer.disconnect()
  }, [measureThumb, options])

  if (walkthroughMode) return null
  if (options.length === 0 && crumbs.length === 0) return null

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

  const handleRadioKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (options.length <= 1) return
    let nextIndex = -1
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % options.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + options.length) % options.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = options.length - 1
    if (nextIndex < 0) return
    event.preventDefault()
    const nextOption = options[nextIndex]
    if (!nextOption) return
    onStageModeChange(nextOption.id)
    itemRefs.current[nextOption.id]?.focus()
  }

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center px-16 transition-[padding] duration-200 ease-out ${padLeftClass} ${padRightClass}`}
    >
      <div className="studio-hud-light pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full p-1">
        {options.length > 0 && (
          <div
            aria-label={i18n._({ id: 'viewer.stage.layout', message: 'Viewer layout' })}
            className="relative flex shrink-0 items-center rounded-full bg-[var(--glass-bg-subtle)] p-0.5"
            ref={groupRef}
            role="radiogroup"
          >
            {thumb && (
              <span
                aria-hidden
                className="studio-interactive pointer-events-none absolute top-0.5 bottom-0.5 left-0 rounded-full bg-[var(--glass-accent)] shadow-xs transition-[transform,width] duration-200 ease-out"
                style={{ transform: `translateX(${thumb.left}px)`, width: `${thumb.width}px` }}
              />
            )}
            {options.map((option, index) => {
              const Icon = option.icon
              const checked = stageMode === option.id
              return (
                <button
                  aria-checked={checked}
                  className={`studio-interactive relative z-10 flex h-8 items-center gap-1.5 rounded-full px-3 font-medium text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] focus-visible:ring-offset-1 ${
                    checked ? 'text-white' : 'text-[var(--glass-muted)] hover:text-[var(--glass-ink)]'
                  }`}
                  key={option.id}
                  onClick={() => onStageModeChange(option.id)}
                  onKeyDown={(event) => handleRadioKeyDown(event, index)}
                  ref={(el) => { itemRefs.current[option.id] = el }}
                  role="radio"
                  tabIndex={checked ? 0 : -1}
                  type="button"
                >
                  <Icon aria-hidden className="size-3.5 shrink-0" />
                  <span>{option.label}</span>
                </button>
              )
            })}
          </div>
        )}

        {options.length > 0 && crumbs.length > 0 && (
          <span aria-hidden className="h-4 w-px shrink-0 bg-[var(--glass-border)]" />
        )}

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

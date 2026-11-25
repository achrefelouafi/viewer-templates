import { useViewer } from '@pascal-app/viewer'
import { selectViewerBuilding, selectViewerLevel, type ViewerSource, type ViewerStageMode } from '@pascal-app/viewer/ui'
import { useEffect } from 'react'

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * Viewer-wide keyboard shortcuts outside walkthrough and guided tour:
 * T tour, W walk, D drone (desktop), M measure, 1/2/3 view modes, R reset view, [ ] levels, E explore, ? help, Esc dismiss.
 */
export function useViewerShortcuts({
  disabled,
  compact,
  hasFloorplan,
  levelIds,
  source,
  onStartTour,
  onWalkthroughToggle,
  onDroneToggle,
  onMeasureToggle,
  onStageModeChange,
  onToggleExplore,
  onToggleShortcuts,
  onEscape,
}: {
  disabled: boolean
  compact: boolean
  hasFloorplan: boolean
  levelIds: readonly string[]
  source: ViewerSource
  onStartTour: () => void
  onWalkthroughToggle: () => void
  onDroneToggle: () => void
  onMeasureToggle: () => void
  onStageModeChange: (mode: ViewerStageMode) => void
  onToggleExplore: () => void
  onToggleShortcuts: () => void
  /** Returns true when an open dialog/sheet/popover consumed Escape. */
  onEscape: () => boolean
}) {
  useEffect(() => {
    if (disabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      // Escape runs in capture phase before editable-input checks and before canvas/Radix handlers,
      // so pressing Escape inside a popover (even on a range slider) closes only that popover and
      // never clears room selection underneath it.
      if (event.key === 'Escape') {
        if (onEscape()) {
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          return
        }
        const viewer = useViewer.getState()
        if (viewer.selection.zoneId || viewer.selection.selectedIds.length > 0 || viewer.focusedUnitId) {
          event.preventDefault()
          viewer.setFocusedUnit(null)
          viewer.setSelection({ zoneId: null, selectedIds: [] })
        }
        return
      }

      if (isEditable(event.target)) return

      if (event.key === '?') {
        event.preventDefault()
        onToggleShortcuts()
        return
      }

      const key = event.key.toLowerCase()
      if (key === 't') {
        event.preventDefault()
        onStartTour()
      } else if (key === 'w') {
        event.preventDefault()
        onWalkthroughToggle()
      } else if (key === 'd' && !compact) {
        event.preventDefault()
        onDroneToggle()
      } else if (key === 'm') {
        event.preventDefault()
        onMeasureToggle()
      } else if (key === 'r') {
        event.preventDefault()
        selectViewerBuilding(source)
      } else if (key === 'e') {
        event.preventDefault()
        onToggleExplore()
      } else if (event.key === '1' && hasFloorplan) {
        event.preventDefault()
        onStageModeChange('3d')
      } else if (event.key === '2' && hasFloorplan) {
        event.preventDefault()
        onStageModeChange('2d')
      } else if (event.key === '3' && hasFloorplan && !compact) {
        event.preventDefault()
        onStageModeChange('split')
      } else if ((event.key === '[' || event.key === ']') && levelIds.length > 0) {
        event.preventDefault()
        const currentId = useViewer.getState().selection.levelId
        const currentIndex = currentId ? levelIds.indexOf(currentId) : -1
        const delta = event.key === ']' ? 1 : -1
        const nextIndex =
          currentIndex < 0
            ? delta > 0
              ? 0
              : levelIds.length - 1
            : Math.max(0, Math.min(levelIds.length - 1, currentIndex + delta))
        const targetId = levelIds[nextIndex]
        if (targetId) selectViewerLevel(targetId, source)
      }
    }
    // Capture phase lets Escape intercept popovers/sheets before document-level or canvas handlers.
    addEventListener('keydown', onKeyDown, true)
    return () => removeEventListener('keydown', onKeyDown, true)
  }, [
    disabled,
    compact,
    hasFloorplan,
    levelIds,
    source,
    onStartTour,
    onWalkthroughToggle,
    onDroneToggle,
    onMeasureToggle,
    onStageModeChange,
    onToggleExplore,
    onToggleShortcuts,
    onEscape,
  ])
}

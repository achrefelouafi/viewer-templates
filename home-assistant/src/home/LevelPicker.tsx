import { useLocale, usePascalI18n } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { localizedLevelName, selectViewerBuilding, selectViewerLevel, type ViewerSource } from '@pascal-app/viewer/ui'
import { useMemo } from 'react'

/**
 * The project viewer's floor list (Pascal's "Levels" card in its scene header), on its own: the
 * whole building, then each floor from the top down; a floor shows alone. Built from Pascal's own
 * selection calls so it behaves as the default viewer's does. Hidden for a single floor.
 */
export function LevelPicker({ source, className = '' }: { source: ViewerSource; className?: string }) {
  const i18n = usePascalI18n()
  const locale = useLocale()
  const levelId = useViewer((s) => s.selection.levelId)
  const levels = useMemo(() => Object.values(source.nodes)
    .filter((n): n is Extract<typeof n, { type: 'level' }> => n?.type === 'level')
    .sort((a, b) => b.level - a.level), [source.nodes])
  if (levels.length < 2) return null

  const row = (selected: boolean) =>
    `rounded-full px-3 py-1.5 text-left text-sm transition-colors ${selected ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-foreground/8 hover:text-foreground'}`
  return (
    <nav aria-label="Levels" className={`pointer-events-auto flex flex-col gap-0.5 rounded-2xl border border-border/60 bg-background/90 p-1 shadow-lg backdrop-blur ${className}`}>
      <button aria-pressed={!levelId} className={row(!levelId)} onClick={() => selectViewerBuilding(source)} type="button">Building</button>
      {levels.map((level) => (
        <button aria-pressed={level.id === levelId} className={row(level.id === levelId)} key={level.id} onClick={() => selectViewerLevel(level.id, source)} type="button">
          {localizedLevelName(level, i18n, locale)}
        </button>
      ))}
    </nav>
  )
}

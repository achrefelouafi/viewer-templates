import type { PascalI18n } from '@pascal-app/core'
import { localizedLevelName, type ViewerNodes, viewerSidebarSections } from '@pascal-app/viewer/ui'

/** One room the tour stops in. */
export type TourStop = {
  zoneId: string
  levelId: string
  floorName: string
  label: string
  areaM2: number
  /** The room's colour in the viewer, for its dot in the route. */
  color: string
}

export type TourFloor = {
  levelId: string
  name: string
  stops: TourStop[]
}

type LevelLike = { id: string; type: string; level?: number; name?: string }

/**
 * The tour's route: floor by floor from the lowest, and on each floor its rooms in the order and
 * with the names and colours of the viewer's own room list. Floors without rooms are left out.
 */
export function tourFloors(nodes: ViewerNodes, i18n: PascalI18n, locale: string): TourFloor[] {
  const levels = (Object.values(nodes) as unknown as LevelLike[])
    .filter((node) => node.type === 'level')
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
  const floors: TourFloor[] = []
  for (const level of levels) {
    const rooms = viewerSidebarSections(level.id, nodes, i18n).find((section) => section.kind === 'rooms')?.rows ?? []
    if (!rooms.length) continue
    const name = localizedLevelName(level, i18n, locale)
    floors.push({
      levelId: level.id,
      name,
      stops: rooms.map((row) => ({
        zoneId: row.id,
        levelId: level.id,
        floorName: name,
        label: row.label,
        areaM2: row.areaM2,
        color: row.color,
      })),
    })
  }
  return floors
}

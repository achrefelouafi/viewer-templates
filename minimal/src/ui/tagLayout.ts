/** A tag to place: centred on its anchor (CSS pixels), its size, and how much it matters. */
export type TagRequest = {
  id: string
  x: number
  y: number
  width: number
  height: number
  priority: number
  /** Too small to label at this zoom: straight to a dot. */
  small?: boolean
  /** Always shown on its anchor, whatever it covers (the open room's). */
  keep?: boolean
}

/** A screen area no tag may cover, such as a panel (CSS pixels). */
export type Area = { left: number; top: number; right: number; bottom: number }

/**
 * Where each tag goes: how far it moves from its anchor vertically; `'pin'` to collapse it to a
 * pin on its anchor; `'hidden'` when even the pin would land on a tag or another pin.
 */
export type TagPlacement = Map<string, number | 'pin' | 'hidden'>

/** Space kept clear between two tags (CSS pixels). */
const GAP = 4

/** A pin's size, as drawn in styles.css (CSS pixels). */
const PIN = 12

/** Nudges tried in turn, in tag heights (plus the gap): on its anchor, then one tag up, then one down. */
const NUDGES = [0, -1, 1]

type Box = Area

const boxAt = (x: number, y: number, width: number, height: number): Box => ({
  left: x - width / 2 - GAP / 2,
  right: x + width / 2 + GAP / 2,
  top: y - height / 2 - GAP / 2,
  bottom: y + height / 2 + GAP / 2,
})

const clearOf = (box: Box, placed: readonly Box[]) =>
  placed.every((other) => box.right <= other.left || box.left >= other.right || box.bottom <= other.top || box.top >= other.bottom)

/**
 * Places tags without overlap, most important first: each takes the first nudge that clears every
 * tag placed before it, or collapses to a pin on its anchor. Pins then go down in the same order,
 * each where it clears every tag and pin, or not at all. Greedy and stable: the same tags and
 * anchors always give the same layout, so tags do not shuffle while the pointer moves.
 */
export function placeTags(requests: readonly TagRequest[], covered: readonly Area[] = []): TagPlacement {
  const placement: TagPlacement = new Map()
  // What the panels cover counts as taken from the start: a tag there moves off it or folds away.
  const placed: Box[] = [...covered]
  const ordered = [...requests].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
  for (const tag of ordered) {
    if (tag.keep) {
      placement.set(tag.id, 0)
      placed.push(boxAt(tag.x, tag.y, tag.width, tag.height))
      continue
    }
    placement.set(tag.id, 'pin')
    if (tag.small) continue
    for (const nudge of NUDGES) {
      const dy = nudge * (tag.height + GAP)
      const box = boxAt(tag.x, tag.y + dy, tag.width, tag.height)
      if (!clearOf(box, placed)) continue
      placement.set(tag.id, dy)
      placed.push(box)
      break
    }
  }
  for (const tag of ordered) {
    if (placement.get(tag.id) !== 'pin') continue
    const box = boxAt(tag.x, tag.y, PIN, PIN)
    if (clearOf(box, placed)) placed.push(box)
    else placement.set(tag.id, 'hidden')
  }
  return placement
}

/** The overlay's line icons, drawn on a 20-unit grid in the ink's stroke. */
const PATHS = {
  layers: ['M10 3 3 6.75 10 10.5l7-3.75L10 3Z', 'm3 10.25 7 3.75 7-3.75', 'm3 13.5 7 3.75 7-3.75'],
  chevron: ['m8 5 5 5-5 5'],
  search: ['M14.25 9a5.25 5.25 0 1 1-10.5 0 5.25 5.25 0 0 1 10.5 0Z', 'm13 13 3.75 3.75'],
  close: ['m5 5 10 10M15 5 5 15'],
  // An orbit round the vertical: the ellipse's front runs the way the building turns.
  turnLeft: ['M10 4v3.5M10 13.5V16', 'M13.6 7.9A7 3 0 1 1 6.4 7.9', 'M3.7 6.6 6.4 7.9 4.65 10.35'],
  turnRight: ['M10 4v3.5M10 13.5V16', 'M6.4 7.9A7 3 0 1 0 13.6 7.9', 'M16.3 6.6 13.6 7.9 15.35 10.35'],
  measure: ['m2.75 13.25 10.5-10.5 4 4-10.5 10.5-4-4Z', 'm6 10 1.75 1.75M8.5 7.5l1.75 1.75M11 5l1.75 1.75'],
  section: ['M3.5 6.5 10 3l6.5 3.5v7L10 17l-6.5-3.5v-7Z', 'M1.5 10h3M7 10h2M11 10h2M15.5 10h3'],
  frame: ['M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4', 'M7.5 10h5M10 7.5v5'],
  fullScreen: ['M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4'],
  help: [
    'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
    'M7.9 8a2.2 2.2 0 1 1 3.3 1.9c-.7.45-1.2.9-1.2 1.85',
    'M10 14.25v.01',
  ],
  arrow: ['M4 10h12M11.5 5.5 16 10l-4.5 4.5'],
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, className = 'icon' }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 20 20">
      {PATHS[name].map((d) => (
        <path d={d} key={d} />
      ))}
    </svg>
  )
}

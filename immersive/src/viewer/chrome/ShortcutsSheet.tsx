import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'

const GROUPS = [
  {
    title: 'Explore & view',
    items: [
      { keys: ['1', '2', '3'], action: 'Switch 3D, 2D and split views' },
      { keys: ['R'], action: 'Reset camera to whole building' },
      { keys: ['[', ']'], action: 'Step down or up a floor' },
      { keys: ['E'], action: 'Toggle explore panel' },
      { keys: ['M'], action: 'Toggle measure tool' },
      { keys: ['Shift'], action: 'Lock measure line to X, Y or Z axis' },
    ],
  },
  {
    title: 'Move',
    items: [
      { keys: ['T'], action: 'Start guided tour' },
      { keys: ['W'], action: 'Walk through the scene' },
      { keys: ['D'], action: 'Fly drone camera' },
    ],
  },
  {
    title: 'Guided tour',
    items: [
      { keys: ['Space'], action: 'Play or pause' },
      { keys: ['←', '→'], action: 'Previous or next room' },
      { keys: ['Esc'], action: 'Exit tour or close dialogs' },
    ],
  },
] as const

/** Accessible keyboard-shortcuts dialog opened by `?` or the command bar help trigger. */
export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus({ preventScroll: true })
    return () => {
      previousFocus.current?.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null

  return (
    <div
      aria-label="Keyboard shortcuts"
      aria-modal="true"
      // The overlay it renders in is `pointer-events-none`; without `auto` here every click
      // (the close button, the backdrop) falls through to the 3D canvas.
      className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="ui-card-pop ui-glass corner-smooth relative z-10 w-full max-w-md rounded-[20px] p-5 text-foreground">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="ui-eyebrow">Reference</p>
            <h2 className="mt-1 font-light text-2xl tracking-[-0.02em]">Keyboard shortcuts</h2>
          </div>
          <button
            aria-label="Close shortcuts"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {GROUPS.map((group, groupIndex) => (
            <section className={groupIndex > 0 ? 'border-foreground/10 border-t pt-3.5' : undefined} key={group.title}>
              <h3 className="ui-eyebrow mb-2">{group.title}</h3>
              <ul className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <li className="flex items-center justify-between gap-3 text-xs" key={item.action}>
                    <span className="text-muted-foreground">{item.action}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {item.keys.map((key) => (
                        <kbd
                          className="rounded-full border border-foreground/15 bg-foreground/[0.06] px-2 py-0.5 font-mono text-[10px] text-foreground"
                          key={key}
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

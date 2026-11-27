import { emitter, usePascalI18n } from '@pascal-app/core'
import { getViewerConfig } from '@pascal-app/viewer'
import { playSound } from '@pascal-app/viewer/sfx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@pascal-app/viewer/ui'
import { useEffect } from 'react'

/** A cube with an orbit ring and arrow swinging around it: "move the camera around the house". */
function CameraOrbitGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} fill="none" viewBox="0 0 24 24">
      {/* the cube */}
      <path d="M12 7.2 16 9.4v4.6L12 16.2 8 14V9.4z" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M8 9.4 12 11.6l4-2.2M12 11.6v4.6" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      {/* the orbit ring, open at the front, with its arrow */}
      <path d="M5.2 15.6C3.2 14.6 2.2 13.3 2.2 12c0-3.1 4.4-5.6 9.8-5.6s9.8 2.5 9.8 5.6c0 2.6-3 4.8-7.2 5.4" stroke="var(--glass-accent)" strokeLinecap="round" strokeWidth="1.6" />
      <path d="m13.2 15.6 1.6 1.8-1.9 1.5" stroke="var(--glass-accent)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  )
}

/**
 * Orbit left, orbit right and top view, folded into one dock button that opens them as a
 * vertical menu. The menu stays open between presses, so a visitor can orbit step by step.
 */
export function CameraMenu() {
  const i18n = usePascalI18n()
  const iconUrl = (name: string) => `${getViewerConfig().iconsBaseUrl}/${name}.webp`

  // Fetch the menu's icons with the page, so the menu opens with them already drawn.
  useEffect(() => {
    for (const name of ['rotate', 'topview']) new Image().src = iconUrl(name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const actions = [
    { id: 'orbit-ccw', label: i18n._({ id: 'viewer.camera.orbitLeft', message: 'Orbit left' }), icon: 'rotate', mirror: true },
    { id: 'orbit-cw', label: i18n._({ id: 'viewer.camera.orbitRight', message: 'Orbit right' }), icon: 'rotate', mirror: false },
    { id: 'top-view', label: i18n._({ id: 'viewer.camera.topView', message: 'Top view' }), icon: 'topview', mirror: false },
  ] as const

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Camera"
          className="studio-hud-light studio-interactive pointer-events-auto inline-flex size-12 items-center justify-center rounded-full text-[var(--glass-ink)] transition-colors hover:bg-[var(--glass-bg-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] data-[state=open]:bg-[var(--glass-bg-strong)]"
          title="Camera"
          type="button"
        >
          <CameraOrbitGlyph className="size-6" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44" side="top" sideOffset={8}>
        {actions.map((action) => (
          <DropdownMenuItem
            className="gap-2.5"
            key={action.id}
            onSelect={(event) => {
              // Stay open, so orbiting again is one more click.
              event.preventDefault()
              playSound('menuClick')
              emitter.emit(`camera-controls:${action.id}`)
            }}
          >
            <img
              alt=""
              className={`size-5 object-contain ${action.mirror ? '-scale-x-100' : ''}`}
              height={20}
              src={iconUrl(action.icon)}
              width={20}
            />
            <span>{action.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

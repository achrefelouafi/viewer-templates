import { emitter, usePascalI18n } from '@pascal-app/core'
import { getViewerConfig, useViewer, type WalkthroughMovement } from '@pascal-app/viewer'
import { playSound } from '@pascal-app/viewer/sfx'
import { Tooltip, TooltipContent, TooltipTrigger, useIsMobile } from '@pascal-app/viewer/ui'
import { Drone, Footprints, Orbit, Sparkles } from 'lucide-react'
import { useAnimationStore } from '../animation/store'

function toggleWalkthrough(movement: WalkthroughMovement) {
  const viewer = useViewer.getState()
  if (viewer.walkthroughMode && viewer.walkthroughMovement === movement) {
    viewer.setWalkthroughMode(false)
    return
  }
  viewer.setWalkthroughMovement(movement)
  viewer.setWalkthroughMode(true)
}

/** Tiny circular progress ring shown around the Animate icon while a build plays. */
function ProgressRing({ progress }: { progress: number }) {
  const r = 9
  const c = 2 * Math.PI * r
  const offset = c * (1 - Math.max(0, Math.min(1, progress)))
  return (
    <svg aria-hidden className="pointer-events-none absolute -inset-1 size-[24px] -rotate-90" viewBox="0 0 24 24">
      <circle cx="12" cy="12" fill="none" r={r} stroke="rgb(38 73 196 / 0.18)" strokeWidth="2" />
      <circle
        cx="12"
        cy="12"
        fill="none"
        r={r}
        stroke="currentColor"
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  )
}

export function ModeDock({ animateOpen, onOpenAnimate }: {
  animateOpen: boolean
  onOpenAnimate: () => void
}) {
  const i18n = usePascalI18n()
  const isMobile = useIsMobile()
  const walkthroughMode = useViewer((s) => s.walkthroughMode)
  const walkthroughMovement = useViewer((s) => s.walkthroughMovement)

  const animStatus = useAnimationStore((s) => s.status)
  const animTime = useAnimationStore((s) => s.time)
  const animDuration = useAnimationStore((s) => s.duration)

  if (walkthroughMode) return null

  const walkActive = walkthroughMode && walkthroughMovement === 'walk'
  const droneActive = walkthroughMode && walkthroughMovement === 'drone'
  const animRunning = animStatus === 'playing' || animStatus === 'paused'
  const animProgress = animDuration > 0 ? Math.min(1, animTime / animDuration) : 0
  const animateHighlighted = animateOpen || animRunning
  const orbitActive = !walkthroughMode && !animateHighlighted

  const iconsBaseUrl = getViewerConfig().iconsBaseUrl
  const iconUrl = (name: string) => `${iconsBaseUrl}/${name}.webp`

  const walkLabel = i18n._({
    id: 'viewer.walkthrough.label',
    message: 'Walkthrough: {state}',
    values: {
      state: walkActive
        ? i18n._({ id: 'viewer.common.on', message: 'On' })
        : i18n._({ id: 'viewer.common.off', message: 'Off' }),
    },
  })
  const droneLabel = i18n._({
    id: 'viewer.drone.label',
    message: 'Drone: {state}',
    values: {
      state: droneActive
        ? i18n._({ id: 'viewer.common.on', message: 'On' })
        : i18n._({ id: 'viewer.common.off', message: 'Off' }),
    },
  })
  const orbitLeftLabel = i18n._({ id: 'viewer.camera.orbitLeft', message: 'Orbit left' })
  const orbitRightLabel = i18n._({ id: 'viewer.camera.orbitRight', message: 'Orbit right' })
  const topViewLabel = i18n._({ id: 'viewer.camera.topView', message: 'Top view' })

  const segmentClass = (active: boolean) =>
    `studio-interactive inline-flex h-10 items-center gap-1.5 sm:gap-2 rounded-full px-2.5 sm:px-3.5 text-[13px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] active:scale-[0.98] ${
      active
        ? 'bg-[var(--glass-accent)] text-white shadow-xs'
        : 'text-[var(--glass-ink)]/85 hover:bg-[var(--glass-bg-hover)] hover:text-[var(--glass-ink)]'
    }`

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-14 sm:px-4">
      <div className="flex max-w-full items-center gap-2">
        {/* Primary experience switch: Orbit, Walk, Drone, Animate */}
        <div className="studio-hud-light pointer-events-auto flex items-center gap-0.5 rounded-full p-1" role="toolbar" aria-label="Viewer modes">
          <button
            aria-label="Orbit"
            aria-pressed={orbitActive}
            className={segmentClass(orbitActive)}
            onClick={() => {
              playSound('menuClick')
              useViewer.getState().setWalkthroughMode(false)
            }}
            type="button"
          >
            <Orbit aria-hidden className="size-4 shrink-0" />
            <span className="hidden sm:inline">Orbit</span>
          </button>

          <button
            aria-label={walkLabel}
            aria-pressed={walkActive}
            className={segmentClass(walkActive)}
            onClick={() => {
              playSound('menuClick')
              toggleWalkthrough('walk')
            }}
            title={walkLabel}
            type="button"
          >
            <Footprints aria-hidden className="size-4 shrink-0" />
            <span className="hidden sm:inline">Walk</span>
          </button>

          {!isMobile && (
            <button
              aria-label={droneLabel}
              aria-pressed={droneActive}
              className={segmentClass(droneActive)}
              onClick={() => {
                playSound('menuClick')
                toggleWalkthrough('drone')
              }}
              title={droneLabel}
              type="button"
            >
              <Drone aria-hidden className="size-4 shrink-0" />
              <span>Drone</span>
            </button>
          )}

          <button
            aria-label={animRunning ? 'Animate: Playing' : 'Animate'}
            aria-pressed={animateHighlighted}
            className={segmentClass(animateHighlighted)}
            onClick={() => {
              playSound('menuClick')
              onOpenAnimate()
            }}
            type="button"
          >
            <span className="relative flex size-4 shrink-0 items-center justify-center">
              {animRunning && <ProgressRing progress={animProgress} />}
              <Sparkles aria-hidden className="size-4" />
            </span>
            <span>Animate</span>
          </button>
        </div>

        {/* Camera cluster: uses self-hosted /icons/*.webp so template origin icons stay wired */}
        <div className="studio-hud-light pointer-events-auto flex items-center gap-0.5 rounded-full p-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={orbitLeftLabel}
                className="studio-interactive group hidden size-10 items-center justify-center rounded-full transition-colors hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] active:scale-95 sm:inline-flex"
                onClick={() => {
                  playSound('menuClick')
                  emitter.emit('camera-controls:orbit-ccw')
                }}
                type="button"
              >
                <img
                  alt=""
                  className="size-6 -scale-x-100 object-contain opacity-85 drop-shadow-[0_1px_1.5px_rgba(15,23,42,0.16)] transition-opacity group-hover:opacity-100"
                  height={24}
                  src={iconUrl('rotate')}
                  width={24}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{orbitLeftLabel}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={orbitRightLabel}
                className="studio-interactive group hidden size-10 items-center justify-center rounded-full transition-colors hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] active:scale-95 sm:inline-flex"
                onClick={() => {
                  playSound('menuClick')
                  emitter.emit('camera-controls:orbit-cw')
                }}
                type="button"
              >
                <img
                  alt=""
                  className="size-6 object-contain opacity-85 drop-shadow-[0_1px_1.5px_rgba(15,23,42,0.16)] transition-opacity group-hover:opacity-100"
                  height={24}
                  src={iconUrl('rotate')}
                  width={24}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{orbitRightLabel}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={topViewLabel}
                className="studio-interactive group inline-flex size-10 items-center justify-center rounded-full transition-colors hover:bg-[var(--glass-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--glass-accent)] active:scale-95"
                onClick={() => {
                  playSound('menuClick')
                  emitter.emit('camera-controls:top-view')
                }}
                type="button"
              >
                <img
                  alt=""
                  className="size-6 object-contain opacity-85 drop-shadow-[0_1px_1.5px_rgba(15,23,42,0.16)] transition-opacity group-hover:opacity-100"
                  height={24}
                  src={iconUrl('topview')}
                  width={24}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{topViewLabel}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

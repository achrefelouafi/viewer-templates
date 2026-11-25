import { emitter } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  selectViewerBuilding,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useFollowPascal,
  type ViewerSource,
  type ViewerStageMode,
} from '@pascal-app/viewer/ui'
import {
  ArrowDownToLine,
  Box,
  Columns2,
  Compass,
  Drone,
  Footprints,
  Glasses,
  HelpCircle,
  Layers,
  Map as MapIcon,
  Moon,
  RotateCcw,
  RotateCw,
  Route,
  Ruler,
  ScanBox,
  SlidersHorizontal,
  Sun,
  Video,
} from 'lucide-react'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { chooseTheme, isDark } from '../../theme'
import type { GuidedTour } from '../../tour/useGuidedTour'
import { ArPopover } from './ArPopover'
import { BottomSheet } from './BottomSheet'
import { LightPopover } from './LightPopover'
import { playOrbClose, playOrbHover, playOrbOpen, playOrbSwitch, playOrbTap, preloadOrbSounds } from './orbSounds'
import { ShowPopover } from './ShowPopover'
import { formatClockMinutes, useSkyInfo } from './skyState'
import { MiniSunGlyph } from './SunArc'
import type { VrSupport } from '../vr/store'

/** `lens` holds the layout (3D, 2D, split) and, in 3D, the camera. */
export type CommandPopover = 'lens' | 'show' | 'light' | 'ar' | null

const STAGE_OPTIONS = [
  { id: '3d', label: '3D', keyHint: '1', icon: Box },
  { id: '2d', label: '2D', keyHint: '2', icon: MapIcon },
  { id: 'split', label: 'Split', keyHint: '3', icon: Columns2 },
] as const

/**
 * Pascal's mark: three bars rising left to right. Each press of the orb makes the bars hop and land
 * back in place, one after another (see `.orb-mark` in styles.css). `hop` counts presses: a new
 * value remounts the glyph so the hop replays, and 0 (no press yet) keeps it still.
 */
function PascalMark({ className, hop = 0 }: { className?: string; hop?: number }) {
  return (
    <svg
      aria-hidden="true"
      className={`orb-mark ${className ?? ''}`}
      data-hop={hop > 0 ? '' : undefined}
      fill="currentColor"
      viewBox="0 0 100 100"
    >
      <rect height="40" style={{ '--b': 0 } as CSSProperties} width="20" x="0" y="60" />
      <rect height="40" style={{ '--b': 1 } as CSSProperties} width="20" x="40" y="30" />
      <rect height="40" style={{ '--b': 2 } as CSSProperties} width="20" x="80" y="0" />
    </svg>
  )
}

/** A tool on the orb's horseshoe: a round glass button. */
/** The stroked shapes of an orb tool's icon, redrawn line by line on hover. */
const ORB_ICON_STROKES = 'button svg :is(path, line, polyline, polygon, circle, ellipse, rect):not([stroke-dasharray])'
const ORB_ITEM =
  'relative grid h-11 w-11 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2'
/** Glass for a resting tool; a filled one (the tour, an open popover) drops the glass so its fill shows. */
const ORB_GLASS = 'ui-glass text-foreground/85 hover:text-foreground'
const ORB_FILLED = 'bg-foreground text-background shadow-md ring-1 ring-black/15 hover:opacity-90'

/** A phone tab: icon over a short label, at least 48px tall for thumbs. Add MOBILE_TAB_IDLE or a fill. */
const MOBILE_TAB_IDLE = 'text-foreground/80 hover:bg-foreground/[0.08]'
const MOBILE_TAB =
  'flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] font-medium text-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2'

function useDarkState() {
  const [dark, setDark] = useState(isDark)
  useEffect(() => {
    const sync = () => setDark(isDark())
    addEventListener('pascal-theme', sync)
    const system = matchMedia('(prefers-color-scheme: dark)')
    system.addEventListener('change', sync)
    return () => {
      removeEventListener('pascal-theme', sync)
      system.removeEventListener('change', sync)
    }
  }, [])
  return { dark, toggle: () => chooseTheme(!dark) }
}

function TipLabel({ text, shortcut }: { text: string; shortcut?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{text}</span>
      {shortcut ? <kbd className="ui-kbd-tip">{shortcut}</kbd> : null}
    </span>
  )
}

function ViewPopoverBody({ source, onDone }: { source: ViewerSource; onDone?: () => void }) {
  const cameraMode = useViewer((s) => s.cameraMode)
  const followOn = useFollowPascal((s) => s.on)

  return (
    <div className="flex flex-col gap-3 text-foreground">
      <div>
        <span className="ui-eyebrow ui-eyebrow-rule mb-2">Camera</span>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            aria-label="Top view"
            className="flex min-h-9 items-center gap-2 rounded-full border border-foreground/10 px-3 text-xs transition-colors hover:bg-foreground/[0.07] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            onClick={() => {
              emitter.emit('camera-controls:top-view')
              onDone?.()
            }}
            type="button"
          >
            <ArrowDownToLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>Top view</span>
          </button>
          <button
            aria-label="Reset view"
            className="flex min-h-9 items-center justify-between gap-2 rounded-full border border-foreground/10 px-3 text-xs transition-colors hover:bg-foreground/[0.07] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            onClick={() => {
              selectViewerBuilding(source)
              onDone?.()
            }}
            type="button"
          >
            <span className="inline-flex items-center gap-2">
              <Compass className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>Reset view</span>
            </span>
            <kbd className="font-mono text-[10px] text-muted-foreground">R</kbd>
          </button>
          <button
            aria-label="Orbit left"
            className="flex min-h-9 items-center gap-2 rounded-full border border-foreground/10 px-3 text-xs transition-colors hover:bg-foreground/[0.07] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            onClick={() => emitter.emit('camera-controls:orbit-ccw')}
            type="button"
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>Orbit left</span>
          </button>
          <button
            aria-label="Orbit right"
            className="flex min-h-9 items-center gap-2 rounded-full border border-foreground/10 px-3 text-xs transition-colors hover:bg-foreground/[0.07] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            onClick={() => emitter.emit('camera-controls:orbit-cw')}
            type="button"
          >
            <RotateCw className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>Orbit right</span>
          </button>
        </div>
      </div>

      <div className="border-foreground/10 border-t pt-3">
        <span className="ui-eyebrow ui-eyebrow-rule mb-1.5">Projection</span>
        <div className="grid grid-cols-2 gap-1 rounded-full bg-foreground/[0.06] p-1" role="group">
          {(['perspective', 'orthographic'] as const).map((mode) => {
            const active = cameraMode === mode
            return (
              <button
                aria-pressed={active}
                className={`min-h-8 rounded-full px-2.5 font-medium text-xs capitalize transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 ${
                  active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                }`}
                key={mode}
                onClick={() => useViewer.getState().setCameraMode(mode)}
                type="button"
              >
                {mode}
              </button>
            )
          })}
        </div>
      </div>

      <div className="border-foreground/10 border-t pt-3">
        <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-2">
            <Video className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Follow Pascal</span>
          </span>
          <Switch
            aria-label={followOn ? 'Follow Pascal: On' : 'Follow Pascal: Off'}
            checked={followOn}
            onCheckedChange={(next) => useFollowPascal.getState().setOn(next)}
          />
        </label>
      </div>
    </div>
  )
}

/**
 * The viewer's controls as one glass orb at the bottom centre. Pressing it fans the tools out
 * in a horseshoe around it (Tour, Walk, AR, Drone, Measure, Lens, Show, Light, Theme, Shortcuts) and folds
 * them away again, so the scene stays clear. Keyboard shortcuts work with the orb closed.
 * On phones it condenses to a labelled tab bar plus a "More" sheet.
 */
export function CommandBar({
  tour,
  source,
  stageMode,
  hasFloorplan,
  onStageModeChange,
  glbActive,
  glbHasScans,
  glbHasGuides,
  walkthroughActive,
  measureActive,
  onWalkthroughToggle,
  onDroneToggle,
  onMeasureToggle,
  onEnterVr,
  onEnterAr,
  vrSupport,
  vrBusy,
  compact,
  activePopover,
  setActivePopover,
  onOpenExploreMobile,
  mobileMoreOpen,
  setMobileMoreOpen,
  onOpenShortcuts,
}: {
  tour: GuidedTour
  source: ViewerSource
  stageMode: ViewerStageMode
  hasFloorplan: boolean
  onStageModeChange: (mode: ViewerStageMode) => void
  glbActive: boolean
  glbHasScans: boolean
  glbHasGuides: boolean
  walkthroughActive: boolean
  droneActive: boolean
  measureActive: boolean
  onWalkthroughToggle: () => void
  onDroneToggle: () => void
  onMeasureToggle: () => void
  onEnterVr: () => void
  /** Opens the AR mode sheet on compact viewports. */
  onEnterAr: () => void
  vrSupport: VrSupport
  vrBusy: boolean
  compact: boolean
  activePopover: CommandPopover
  setActivePopover: (next: CommandPopover) => void
  onOpenExploreMobile: () => void
  mobileMoreOpen: boolean
  setMobileMoreOpen: (open: boolean) => void
  onOpenShortcuts: () => void
}) {
  const { dark, toggle: toggleTheme } = useDarkState()
  const textures = useViewer((s) => s.textures)
  const levelMode = useViewer((s) => s.levelMode)
  const sky = useSkyInfo(source.nodes)
  const [moreTab, setMoreTab] = useState<'view' | 'show' | 'light'>('view')
  const [dockOpen, setDockOpen] = useState(false)
  // Counts orb presses so the mark replays its hop on each one.
  const [markHop, setMarkHop] = useState(0)

  // Orb sounds: the dock opening and closing (by the orb, a press outside or Escape) and a
  // command popover opening, switching or closing. The first render plays nothing.
  const toolCount = useRef(0)
  const lastDockOpen = useRef(dockOpen)
  const lastPopover = useRef(activePopover)
  useEffect(() => preloadOrbSounds(), [])
  useEffect(() => {
    if (lastDockOpen.current === dockOpen) return
    lastDockOpen.current = dockOpen
    if (dockOpen) playOrbOpen(toolCount.current)
    else playOrbClose()
  }, [dockOpen])
  useEffect(() => {
    const previous = lastPopover.current
    lastPopover.current = activePopover
    if (previous === activePopover) return
    playOrbTap(activePopover ? 'open' : 'close')
  }, [activePopover])

  // Programmatically opening a popover (e.g. `?ar=1` on a tablet) unfolds the orb so it anchors cleanly.
  useEffect(() => {
    if (activePopover !== null) setDockOpen(true)
  }, [activePopover])

  // The orb folds its tools away on a press outside it (and outside its popovers) or on Escape.
  useEffect(() => {
    if (!dockOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target) return
      if (target.closest('[data-dock]') || target.closest('[data-slot="popover-content"]')) return
      setDockOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activePopover === null) setDockOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [dockOpen, activePopover])

  const is2D = stageMode === '2d'
  const showDot = levelMode !== 'stacked' || !textures || measureActive

  // Close any open command popover on capture-phase pointerdown outside the popover and triggers,
  // because WebGPU/R3F canvas handlers can stop bubble-phase events before Radix sees them.
  useEffect(() => {
    if (activePopover === null) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target) return
      if (target.closest('[data-slot="popover-content"]')) return
      if (target.closest('[data-command-popover-trigger]')) return
      setActivePopover(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [activePopover, setActivePopover])

  if (compact) {
    return (
      <>
        <button
          aria-checked={dark}
          aria-label="Dark mode"
          className="ui-enter-left ui-glass pointer-events-auto absolute top-3 left-3 z-20 grid h-11 w-11 place-items-center rounded-full text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          data-chrome-surface=""
          data-theme-switch=""
          onClick={toggleTheme}
          role="switch"
          type="button"
        >
          {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>

        {/* A labelled tab bar. Clears the bottom-left compass (`left-3 w-8`, right edge 44px) with an 8px gutter. */}
        <div
          className="ui-enter-up pointer-events-none absolute right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[3.25rem] z-30 flex justify-center"
          data-chrome-surface=""
          data-viewer-controls=""
        >
          <div className="ui-glass relative pointer-events-auto flex w-full items-stretch gap-1 rounded-[26px] p-1 text-foreground">
            <button
              aria-label="Explore floors and rooms"
              className={`${MOBILE_TAB} ${MOBILE_TAB_IDLE}`}
              onClick={onOpenExploreMobile}
              type="button"
            >
              <Layers className="h-[18px] w-[18px]" />
              <span aria-hidden="true">Explore</span>
            </button>

            {is2D && hasFloorplan ? (
              <button className={`${MOBILE_TAB} bg-foreground text-background`} onClick={() => onStageModeChange('3d')} type="button">
                <Box className="h-[18px] w-[18px]" />
                <span>Back to 3D</span>
              </button>
            ) : (
              <button
                aria-label="Guided tour"
                className={`${MOBILE_TAB} bg-foreground text-background disabled:opacity-40`}
                data-guided-tour-start=""
                disabled={tour.stops.length === 0}
                onClick={tour.start}
                type="button"
              >
                <Route className="h-[18px] w-[18px]" />
                <span aria-hidden="true">Tour</span>
              </button>
            )}

            {is2D && hasFloorplan ? (
              <button
                aria-label="Guided tour"
                className={`${MOBILE_TAB} ${MOBILE_TAB_IDLE} disabled:opacity-40`}
                data-guided-tour-start=""
                disabled={tour.stops.length === 0}
                onClick={tour.start}
                type="button"
              >
                <Route className="h-[18px] w-[18px]" />
                <span aria-hidden="true">Tour</span>
              </button>
            ) : null}

            {!is2D ? (
              <button
                aria-label={walkthroughActive ? 'Walkthrough: On' : 'Walkthrough: Off'}
                aria-pressed={walkthroughActive}
                className={`relative ${MOBILE_TAB} ${walkthroughActive ? 'bg-foreground text-background' : MOBILE_TAB_IDLE}`}
                onClick={onWalkthroughToggle}
                type="button"
              >
                <Footprints className="h-[18px] w-[18px]" />
                <span aria-hidden="true">Walk</span>
                {vrSupport === 'unsupported' ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1 right-1.5 rounded-full bg-foreground/85 px-1 font-mono font-semibold text-[7px] text-background leading-tight"
                  >
                    VR
                  </span>
                ) : null}
              </button>
            ) : null}

            {!is2D && vrSupport === 'supported' ? (
              <button
                aria-label="View in VR"
                className={`${MOBILE_TAB} ${MOBILE_TAB_IDLE} disabled:opacity-40`}
                disabled={vrBusy}
                onClick={onEnterVr}
                type="button"
              >
                <Glasses className="h-[18px] w-[18px]" />
                <span aria-hidden="true">VR</span>
              </button>
            ) : null}

            <button
              aria-label="AR mode"
              className={`${MOBILE_TAB} ${MOBILE_TAB_IDLE}`}
              data-ar-mode=""
              onClick={onEnterAr}
              type="button"
            >
              <ScanBox className="h-[18px] w-[18px]" />
              <span aria-hidden="true">AR</span>
            </button>

            <button
              aria-expanded={mobileMoreOpen}
              aria-label="More controls"
              className={`${MOBILE_TAB} ${MOBILE_TAB_IDLE} relative`}
              onClick={() => setMobileMoreOpen(true)}
              type="button"
            >
              <SlidersHorizontal className="h-[18px] w-[18px]" />
              <span aria-hidden="true">More</span>
              {showDot ? <span aria-hidden="true" className="absolute top-2 right-[calc(50%-14px)] h-1.5 w-1.5 rounded-full bg-foreground" /> : null}
            </button>
          </div>
        </div>

        <BottomSheet
          eyebrow="Controls"
          onClose={() => setMobileMoreOpen(false)}
          open={mobileMoreOpen}
          title="View & display"
        >
          <div className="flex flex-col gap-4 pb-2">
            {hasFloorplan ? (
              <div>
                <span className="ui-eyebrow ui-eyebrow-rule mb-1.5">Mode</span>
                <div className="grid grid-cols-2 gap-1 rounded-full bg-foreground/[0.06] p-1" role="group">
                  {(['3d', '2d'] as const).map((mode) => {
                    const active = stageMode === mode
                    return (
                      <button
                        aria-pressed={active}
                        className={`flex min-h-11 items-center justify-center gap-1.5 rounded-full font-mono text-xs uppercase transition-colors ${
                          active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                        }`}
                        key={mode}
                        onClick={() => {
                          onStageModeChange(mode)
                          setMobileMoreOpen(false)
                        }}
                        type="button"
                      >
                        {mode === '3d' ? <Box className="h-3.5 w-3.5" /> : <MapIcon className="h-3.5 w-3.5" />}
                        <span>{mode}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {!is2D ? (
              <>
                <div className="grid grid-cols-3 gap-1 rounded-full bg-foreground/[0.06] p-1" role="tablist">
                  {(
                    [
                      { id: 'view', label: 'Camera' },
                      { id: 'show', label: 'Show' },
                      ...(textures ? [{ id: 'light', label: 'Light' }] : []),
                    ] as const
                  ).map((tab) => (
                    <button
                      aria-selected={moreTab === tab.id}
                      className={`min-h-10 rounded-full font-medium text-xs transition-colors ${
                        moreTab === tab.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                      }`}
                      key={tab.id}
                      onClick={() => setMoreTab(tab.id as 'view' | 'show' | 'light')}
                      role="tab"
                      type="button"
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {moreTab === 'view' ? (
                  <ViewPopoverBody onDone={() => setMobileMoreOpen(false)} source={source} />
                ) : moreTab === 'show' ? (
                  <ShowPopover glbActive={glbActive} glbHasGuides={glbHasGuides} glbHasScans={glbHasScans} />
                ) : (
                  <LightPopover nodes={source.nodes} />
                )}
              </>
            ) : null}

            <div className="border-foreground/10 border-t pt-3">
              <button
                aria-pressed={measureActive}
                className={`flex min-h-11 w-full items-center justify-between rounded-full border px-4 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 ${
                  measureActive
                    ? 'border-transparent bg-foreground font-medium text-background'
                    : 'border-foreground/10 hover:bg-foreground/[0.06]'
                }`}
                onClick={() => {
                  setMobileMoreOpen(false)
                  onMeasureToggle()
                }}
                type="button"
              >
                <span className="inline-flex items-center gap-2">
                  <Ruler className={`h-4 w-4 ${measureActive ? 'text-background' : 'text-muted-foreground'}`} />
                  <span>{measureActive ? 'Exit measure' : 'Measure'}</span>
                </span>
                <kbd className={`font-mono text-[10px] ${measureActive ? 'text-background/75' : 'text-muted-foreground'}`}>M</kbd>
              </button>
            </div>

            <div className="border-foreground/10 border-t pt-3">
              <button
                className="flex min-h-11 w-full items-center justify-between rounded-full border border-foreground/10 px-4 text-xs transition-colors hover:bg-foreground/[0.06]"
                onClick={() => {
                  setMobileMoreOpen(false)
                  onOpenShortcuts()
                }}
                type="button"
              >
                <span className="inline-flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  <span>Keyboard shortcuts</span>
                </span>
                <kbd className="font-mono text-[10px] text-muted-foreground">?</kbd>
              </button>
            </div>
          </div>
        </BottomSheet>
      </>
    )
  }

  const closeDock = () => setDockOpen(false)
  const popoverItem = (
    id: Exclude<CommandPopover, null>,
    label: string,
    ariaLabel: string,
    icon: ReactNode,
    body: ReactNode,
    width: string,
    badge = false,
  ) => (
    <Popover
      onOpenChange={(open) => setActivePopover(open ? id : activePopover === id ? null : activePopover)}
      open={activePopover === id}
    >
      {/* No tooltip over the tool's own open popover. */}
      <Tooltip delayDuration={120} open={activePopover === id ? false : undefined}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              aria-label={ariaLabel}
              className={`${ORB_ITEM} ${activePopover === id ? ORB_FILLED : ORB_GLASS}`}
              data-command-popover-trigger={id}
              type="button"
            >
              {icon}
              {badge && activePopover !== id ? (
                <span aria-hidden="true" className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-foreground" />
              ) : null}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="center"
        className={`ui-scroll max-h-[70dvh] ${width} overflow-y-auto overscroll-contain rounded-[20px] p-4`}
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setActivePopover(null)
        }}
        side="top"
        sideOffset={14}
      >
        {body}
      </PopoverContent>
    </Popover>
  )
  const actionItem = (
    id: string,
    tip: string,
    shortcut: string | undefined,
    icon: ReactNode,
    onClick: () => void,
    extra: {
      primary?: boolean
      pressed?: boolean
      ariaLabel?: string
      disabled?: boolean
      tourStart?: boolean
      themeSwitch?: boolean
      badgeText?: string
    } = {},
  ) => (
    <Tooltip delayDuration={120} key={id}>
      <TooltipTrigger asChild>
        <button
          aria-checked={extra.themeSwitch ? dark : undefined}
          aria-label={extra.ariaLabel ?? tip}
          aria-pressed={extra.pressed}
          className={`${ORB_ITEM} disabled:opacity-40 ${extra.primary ? ORB_FILLED : ORB_GLASS}`}
          data-guided-tour-start={extra.tourStart ? '' : undefined}
          data-theme-switch={extra.themeSwitch ? '' : undefined}
          disabled={extra.disabled}
          onClick={onClick}
          role={extra.themeSwitch ? 'switch' : undefined}
          type="button"
        >
          {icon}
          {extra.badgeText ? (
            <span
              aria-hidden="true"
              data-orb-badge=""
              className="pointer-events-none absolute -top-1 -right-1 rounded-full bg-foreground px-1.5 py-px font-mono font-semibold text-[8px] text-background leading-tight shadow-sm"
            >
              {extra.badgeText}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        <TipLabel shortcut={shortcut} text={tip} />
      </TooltipContent>
    </Tooltip>
  )

  const stage = STAGE_OPTIONS.find((o) => o.id === stageMode) ?? STAGE_OPTIONS[0]
  const StageIcon = stage.icon
  // Lens: how you look at the building. The layout (3D, 2D, split) on top and, in 3D, the camera
  // below it, in one popover so the orb carries one tool for both.
  const layoutSection = hasFloorplan ? (
    <div className="flex flex-col gap-2.5">
      <p className="ui-eyebrow ui-eyebrow-rule">Layout</p>
      <div aria-label="Viewer layout" className="grid grid-cols-3 gap-1.5" role="group">
        {STAGE_OPTIONS.map(({ id, label, keyHint, icon: Icon }) => {
          const active = stageMode === id
          return (
            <button
              aria-pressed={active}
              className={`flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 ${
                active
                  ? 'border-transparent bg-foreground text-background'
                  : 'border-foreground/10 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
              }`}
              key={id}
              onClick={() => {
                onStageModeChange(id)
                setActivePopover(null)
              }}
              type="button"
            >
              <Icon className="h-5 w-5" />
              <span className="font-medium text-xs">{label}</span>
              <kbd className={`font-mono text-[10px] ${active ? 'text-background/70' : 'text-muted-foreground'}`}>{keyHint}</kbd>
            </button>
          )
        })}
      </div>
    </div>
  ) : null
  const cameraSection = is2D ? null : <ViewPopoverBody onDone={() => setActivePopover(null)} source={source} />
  const lensBody = (
    <div className="flex flex-col gap-3">
      {layoutSection}
      {layoutSection && cameraSection ? <div className="border-foreground/10 border-t pt-3">{cameraSection}</div> : cameraSection}
    </div>
  )
  const lensItem =
    layoutSection || cameraSection ? (
      <span key="lens">
        {popoverItem(
          'lens',
          hasFloorplan ? `Lens · ${stage.label}` : 'Lens · camera',
          'Lens: layout and camera',
          <StageIcon className="h-[18px] w-[18px]" />,
          lensBody,
          is2D ? 'w-64' : 'w-72',
        )}
      </span>
    ) : null

  const arItem = (
    <span key="ar">
      {popoverItem(
        'ar',
        'AR mode',
        'AR mode',
        <ScanBox className="h-[18px] w-[18px]" />,
        <ArPopover onClose={() => setActivePopover(null)} />,
        'w-80',
      )}
    </span>
  )

  const measureItem = actionItem(
    'measure',
    measureActive ? 'Exit measure' : 'Measure',
    'M',
    <Ruler className="h-[18px] w-[18px]" />,
    () => {
      if (!measureActive) closeDock()
      onMeasureToggle()
    },
    {
      ariaLabel: measureActive ? 'Measure: On' : 'Measure: Off',
      primary: measureActive,
      pressed: measureActive,
    },
  )

  const items: ReactNode[] = (is2D
    ? [
        actionItem('back3d', 'Back to 3D', '1', <Box className="h-[18px] w-[18px]" />, () => onStageModeChange('3d'), {
          primary: true,
        }),
        actionItem('tour', 'Guided tour', 'T', <Route className="h-[18px] w-[18px]" />, tour.start, {
          disabled: tour.stops.length === 0,
          tourStart: true,
        }),
        arItem,
        measureItem,
        lensItem,
        actionItem('theme', dark ? 'Switch to paper theme' : 'Switch to noir theme', undefined, dark ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />, toggleTheme, { ariaLabel: 'Dark mode', themeSwitch: true }),
        actionItem('help', 'Shortcuts', '?', <HelpCircle className="h-[18px] w-[18px]" />, onOpenShortcuts, { ariaLabel: 'Keyboard shortcuts' }),
      ]
    : [
        actionItem('tour', 'Guided tour', 'T', <Route className="h-[18px] w-[18px]" />, tour.start, {
          disabled: tour.stops.length === 0,
          tourStart: true,
        }),
        actionItem('walk', 'Walk through', 'W', <Footprints className="h-[18px] w-[18px]" />, onWalkthroughToggle, {
          ariaLabel: 'Walkthrough',
          badgeText: vrSupport === 'unsupported' ? 'VR' : undefined,
        }),
        ...(vrSupport === 'supported'
          ? [
              actionItem('vr', 'View in VR', undefined, <Glasses className="h-[18px] w-[18px]" />, onEnterVr, {
                ariaLabel: 'View in VR',
                disabled: vrBusy,
              }),
            ]
          : []),
        arItem,
        actionItem('drone', 'Fly a drone', 'D', <Drone className="h-[18px] w-[18px]" />, onDroneToggle, { ariaLabel: 'Drone' }),
        measureItem,
        lensItem,
        <span key="show">
          {popoverItem(
            'show',
            'Display, walls and levels',
            'Show and display',
            <SlidersHorizontal className="h-[18px] w-[18px]" />,
            <ShowPopover glbActive={glbActive} glbHasGuides={glbHasGuides} glbHasScans={glbHasScans} />,
            'w-80',
            showDot,
          )}
        </span>,
        ...(textures
          ? [
              <span key="light">
                {popoverItem(
                  'light',
                  `Light and weather · ${formatClockMinutes(sky.clock)}`,
                  'Time and weather',
                  <MiniSunGlyph minutes={sky.minutes} sunrise={sky.events.sunrise} sunset={sky.events.sunset} />,
                  <LightPopover nodes={source.nodes} />,
                  'w-80',
                )}
              </span>,
            ]
          : []),
        actionItem('theme', dark ? 'Switch to paper theme' : 'Switch to noir theme', undefined, dark ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />, toggleTheme, { ariaLabel: 'Dark mode', themeSwitch: true }),
        actionItem('help', 'Shortcuts', '?', <HelpCircle className="h-[18px] w-[18px]" />, onOpenShortcuts, { ariaLabel: 'Keyboard shortcuts' }),
      ]
  ).filter(Boolean)

  // A horseshoe above the orb: the first item sits at its left, the last at its right.
  // Wider as tools are added, so neighbouring 44px buttons never touch.
  const radius = items.length > 10 ? 148 : items.length > 9 ? 136 : items.length > 8 ? 128 : items.length > 4 ? 116 : 84
  toolCount.current = items.length
  const placed = items.map((item, index) => {
    const angle = items.length === 1 ? Math.PI / 2 : Math.PI - (index * Math.PI) / (items.length - 1)
    return { item, x: Math.round(Math.cos(angle) * radius), y: Math.round(-Math.sin(angle) * radius) }
  })

  return (
    <TooltipProvider delayDuration={120}>
      <div
        // Centred with auto margins, not `translate`: the entrance and immersive fade animate
        // `translate`, which would drop a -50% centring mid-animation and snap the orb sideways.
        className="ui-enter-up ui-immersive-transition pointer-events-none absolute inset-x-0 bottom-6 z-30 mx-auto w-fit"
        data-chrome-edge="bottom"
        data-chrome-surface=""
        data-viewer-controls=""
      >
        <div className="orb-dock relative h-14 w-14" data-dock="" data-open={dockOpen ? 'true' : 'false'}>
          <span aria-hidden="true" className="orb-track pointer-events-none absolute" style={{ '--r': `${radius}px` } as CSSProperties} />
          <div aria-label="Viewer controls" role="toolbar">
            {placed.map(({ item, x, y }, index) => (
              <div
                className="orb-item absolute top-1/2 left-1/2"
                // biome-ignore lint/suspicious/noArrayIndexKey: items are a fixed, ordered set
                key={index}
                // A tool's own sound: popover triggers sound through the popover effect above,
                // the theme switch clicks on or off, and anything else pops.
                onClickCapture={(event) => {
                  const button = (event.target as Element).closest('button')
                  if (!button || button.disabled || button.hasAttribute('data-command-popover-trigger')) return
                  if (button.hasAttribute('data-theme-switch')) playOrbSwitch(!dark)
                  else playOrbTap()
                }}
                onPointerEnter={(event) => {
                  // Normalise each stroke's length to 1 so the hover line-draw in styles.css
                  // traces every line of the icon in the same time, whatever its real length.
                  for (const shape of event.currentTarget.querySelectorAll(ORB_ICON_STROKES)) {
                    if (!shape.hasAttribute('pathLength')) shape.setAttribute('pathLength', '1')
                  }
                  if (dockOpen && event.pointerType === 'mouse') playOrbHover(index)
                }}
                style={{ '--x': `${x}px`, '--y': `${y}px`, '--i': index } as CSSProperties}
              >
                {item}
              </div>
            ))}
          </div>
          <button
            aria-expanded={dockOpen}
            aria-label={dockOpen ? 'Close controls' : 'Open controls'}
            className="orb-core ui-glass pointer-events-auto absolute inset-0 grid place-items-center rounded-full text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            data-dock-orb=""
            onClick={() => {
              setMarkHop((n) => n + 1)
              if (dockOpen) {
                setActivePopover(null)
                closeDock()
              } else setDockOpen(true)
            }}
            type="button"
          >
            <span aria-hidden="true" className="orb-ticks pointer-events-none absolute inset-1 rounded-full" />
            <span className="orb-glyph relative grid place-items-center">
              <PascalMark className="h-5 w-5" hop={markHop} key={markHop} />
            </span>
          </button>
        </div>
      </div>
    </TooltipProvider>
  )
}

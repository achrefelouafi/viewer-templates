import { usePascalI18n } from '@pascal-app/core'
import {
  CLAY_PALETTE,
  type RenderQualityChoice,
  SCENE_THEMES,
  useViewer,
  type WallMode,
} from '@pascal-app/viewer'
import { sceneThemeName, Switch } from '@pascal-app/viewer/ui'
import { Check } from 'lucide-react'
import { useAmbientOcclusion } from './useAmbientOcclusion'

const LEVEL_MODES = [
  { id: 'stacked', label: 'Stacked' },
  { id: 'exploded', label: 'Exploded' },
  { id: 'solo', label: 'Solo' },
] as const

const WALL_MODES: readonly { id: WallMode; label: string }[] = [
  { id: 'cutaway', label: 'Cutaway' },
  { id: 'up', label: 'Full height' },
  { id: 'down', label: 'Low' },
]

const QUALITIES: readonly { id: RenderQualityChoice; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
]

function Segment<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { id: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div aria-label={label} className="grid gap-1 rounded-full bg-foreground/[0.06] p-1" role="group" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => {
        const active = option.id === value
        return (
          <button
            aria-pressed={active}
            className={`min-h-8 rounded-full px-2.5 font-medium text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 ${
              active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
            }`}
            key={option.id}
            onClick={() => onChange(option.id)}
            type="button"
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Display and visibility controls backed directly by `useViewer`: levels display, wall cutaway,
 * scans/guides, shadows, colored vs monochrome (with scene themes and ink edges), quality, units.
 */
export function ShowPopover({ glbActive, glbHasScans, glbHasGuides }: {
  glbActive: boolean
  glbHasScans: boolean
  glbHasGuides: boolean
}) {
  const i18n = usePascalI18n()
  const levelMode = useViewer((s) => s.levelMode)
  const wallMode = useViewer((s) => s.wallMode)
  const showScans = useViewer((s) => s.showScans)
  const showGuides = useViewer((s) => s.showGuides)
  const shadows = useViewer((s) => s.shadows)
  const textures = useViewer((s) => s.textures)
  const sceneTheme = useViewer((s) => s.sceneTheme)
  const edges = useViewer((s) => s.edges)
  const quality = useViewer((s) => s.renderQuality)
  const qualityChoice = useViewer((s) => s.renderQualityChoice)
  const unit = useViewer((s) => s.unit)
  const [ambientOcclusion, setAmbientOcclusion] = useAmbientOcclusion()
  const aoUnavailable = quality === 'low'

  const canShowScans = !glbActive || glbHasScans
  const canShowGuides = !glbActive || glbHasGuides
  const safeWallMode: WallMode = wallMode === 'up' || wallMode === 'down' || wallMode === 'cutaway' ? wallMode : 'cutaway'
  const safeLevelMode = levelMode === 'manual' ? 'stacked' : levelMode

  return (
    <div className="flex flex-col gap-4 text-foreground">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="ui-eyebrow">Levels</span>
          <span className="font-mono text-[10px] text-muted-foreground capitalize">{levelMode}</span>
        </div>
        <Segment
          label={`Levels: ${levelMode}`}
          onChange={(next) => useViewer.getState().setLevelMode(next)}
          options={LEVEL_MODES}
          value={safeLevelMode}
        />
      </div>

      {!glbActive ? (
        <div>
          <span className="ui-eyebrow mb-1.5 block">Walls</span>
          <Segment
            label="Walls"
            onChange={(next) => useViewer.getState().setWallMode(next)}
            options={WALL_MODES}
            value={safeWallMode}
          />
        </div>
      ) : null}

      {canShowScans || canShowGuides ? (
        <div className="border-foreground/10 border-t pt-3">
          <span className="ui-eyebrow mb-2 block">Overlays</span>
          <div className="flex flex-col gap-2">
            {canShowScans ? (
              <label className="flex cursor-pointer items-center justify-between text-xs">
                <span>Scans</span>
                <Switch checked={showScans} onCheckedChange={(v) => useViewer.getState().setShowScans(v)} />
              </label>
            ) : null}
            {canShowGuides ? (
              <label className="flex cursor-pointer items-center justify-between text-xs">
                <span>Guides</span>
                <Switch checked={showGuides} onCheckedChange={(v) => useViewer.getState().setShowGuides(v)} />
              </label>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="border-foreground/10 border-t pt-3">
        <span className="ui-eyebrow mb-2 block">Appearance</span>
        <Segment
          label="Colors"
          onChange={(next) => useViewer.getState().setTextures(next === 'colored')}
          options={[
            { id: 'colored', label: 'Colored' },
            { id: 'mono', label: 'Monochrome' },
          ]}
          value={textures ? 'colored' : 'mono'}
        />

        {!textures ? (
          <div className="mt-3">
            <span className="ui-eyebrow mb-1.5 block">Scene theme</span>
            <div className="grid grid-cols-2 gap-1.5">
              {SCENE_THEMES.map((theme) => {
                const active = sceneTheme === theme.id
                const swatches = (['wall', 'roof', 'floor', 'glazing'] as const).map(
                  (role) => theme.clayTints?.[role] ?? CLAY_PALETTE[role],
                )
                return (
                  <button
                    aria-pressed={active}
                    className={`flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 ${
                      active
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-foreground/10 text-foreground hover:bg-accent/70'
                    }`}
                    key={theme.id}
                    onClick={() => useViewer.getState().setSceneTheme(theme.id)}
                    type="button"
                  >
                    <span
                      className="grid h-4 w-4 shrink-0 grid-cols-2 overflow-hidden rounded-full border border-black/15"
                      style={{ backgroundColor: theme.background }}
                    >
                      {swatches.map((color, idx) => (
                        <span key={`${theme.id}-${idx}`} style={{ backgroundColor: color }} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{sceneThemeName(theme.id, theme.name, i18n)}</span>
                    {active ? <Check className="h-3 w-3 shrink-0" /> : null}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-3 flex flex-col gap-2.5">
          <label className="flex cursor-pointer items-center justify-between text-xs">
            <span>Shadows</span>
            <Switch checked={shadows} onCheckedChange={(v) => useViewer.getState().setShadows(v)} />
          </label>
          <label
            className={`flex items-center justify-between gap-3 text-xs ${
              aoUnavailable ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            }`}
          >
            <span className="min-w-0">
              <span className="block text-foreground">Ambient occlusion</span>
              <span className="block text-[11px] text-muted-foreground leading-snug">
                {aoUnavailable ? 'Not available at Low quality' : 'Soft contact shadows in corners'}
              </span>
            </span>
            <Switch
              checked={ambientOcclusion}
              disabled={aoUnavailable}
              onCheckedChange={setAmbientOcclusion}
            />
          </label>
          {!textures ? (
            <label className="flex cursor-pointer items-center justify-between text-xs">
              <span>Ink edges</span>
              <Switch
                checked={edges !== 'off'}
                onCheckedChange={(v) => useViewer.getState().setEdges(v ? 'soft' : 'off')}
              />
            </label>
          ) : null}
        </div>
      </div>

      <div className="border-foreground/10 border-t pt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="ui-eyebrow">Quality</span>
          <span className="font-mono text-[10px] text-muted-foreground capitalize">
            {qualityChoice === 'auto' ? `Auto (${quality})` : quality}
          </span>
        </div>
        <Segment
          label="Quality"
          onChange={(next) => useViewer.getState().setRenderQuality(next)}
          options={QUALITIES}
          value={qualityChoice}
        />
      </div>

      <div className="border-foreground/10 border-t pt-3">
        <span className="ui-eyebrow mb-1.5 block">Units</span>
        <Segment
          label="Units"
          onChange={(next) => useViewer.getState().setUnit(next)}
          options={[
            { id: 'metric', label: 'Metric' },
            { id: 'imperial', label: 'Imperial' },
          ]}
          value={unit}
        />
      </div>
    </div>
  )
}

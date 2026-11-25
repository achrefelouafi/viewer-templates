import { Check, Copy, ExternalLink, Loader2, RotateCcw, ScanBox } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useViewer } from '@pascal-app/viewer'
import { renderSVG } from 'uqr'
import type { ArScaleMode } from '../ar/buildArModel'
import { openInQuickLook } from '../ar/quickLook'
import { useArStore } from '../ar/store'

const SCALE_OPTIONS: readonly { id: ArScaleMode; label: string; detail: string }[] = [
  { id: 'tabletop', label: 'Tabletop', detail: '~60 cm' },
  { id: 'lifesize', label: 'Life size', detail: '1:1' },
]

function buildArShareUrl(): string {
  const url = new URL(window.location.href)
  // The project may have come from Pascal or the build's default rather than the address,
  // so the phone gets it spelled out.
  const projectId = useViewer.getState().projectId
  if (projectId) url.searchParams.set('project', projectId)
  url.searchParams.set('ar', '1')
  url.hash = ''
  return url.toString()
}

function QrBlock({ url, caption }: { url: string; caption: string }) {
  const [copied, setCopied] = useState(false)

  const qrDataUri = useMemo(() => {
    const svg = renderSVG(url, {
      border: 2,
      ecc: 'M',
      whiteColor: '#ffffff',
      blackColor: '#171717',
    })
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  }, [url])

  const copyLink = () => {
    if (!navigator.clipboard?.writeText) return
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1800)
      })
      .catch(() => {})
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-44 overflow-hidden rounded-2xl border border-foreground/10 bg-white p-2 shadow-xs">
        <img
          alt="QR code to open this project in AR"
          className="block aspect-square w-full"
          src={qrDataUri}
        />
      </div>

      <p className="text-center text-foreground text-xs leading-relaxed">
        {caption}
      </p>

      <button
        className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-full border border-foreground/10 px-4 font-medium text-foreground text-xs transition-colors hover:bg-foreground/[0.06] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        onClick={copyLink}
        type="button"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
        <span>{copied ? 'Link copied' : 'Copy link'}</span>
      </button>

      <p className="text-center text-[11px] text-muted-foreground leading-snug">
        Private projects open only on a phone that can access them.
      </p>
    </div>
  )
}

/**
 * AR mode card shared by the desktop orb popover and the mobile BottomSheet.
 * - iPhone/iPad Safari: two-step prepare → "Open in AR" (Apple Quick Look USDZ).
 * - Android Chrome + ARCore: prepare → "Start AR" (WebXR immersive-ar).
 * - Desktop & unsupported/in-app browsers: friendly message + QR code handoff (`?ar=1`).
 */
export function ArPopover({ onClose, showHeader = true }: { onClose?: () => void; showHeader?: boolean }) {
  const platform = useArStore((s) => s.platform)
  const unsupportedReason = useArStore((s) => s.unsupportedReason)
  const status = useArStore((s) => s.status)
  const progress = useArStore((s) => s.progress)
  const error = useArStore((s) => s.error)
  const scaleMode = useArStore((s) => s.scaleMode)
  const sceneReady = useArStore((s) => s.sceneReady)
  const sceneIdentity = useArStore((s) => s.sceneIdentity)
  const builtKey = useArStore((s) => s.builtKey)
  const model = useArStore((s) => s.model)
  const usdzUrl = useArStore((s) => s.usdzUrls[s.scaleMode])

  const shareUrl = useMemo(() => buildArShareUrl(), [])

  const isMobileAr = platform === 'quicklook' || platform === 'webxr'
  const isPrepared =
    Boolean(model) &&
    builtKey === sceneIdentity &&
    (platform === 'webxr' || Boolean(usdzUrl))

  // Kick off preparation automatically when the AR card is open on a supported phone.
  useEffect(() => {
    if (!isMobileAr || !sceneReady || status === 'preparing' || status === 'active' || status === 'error') {
      return
    }
    if (!isPrepared) {
      void useArStore.getState().prepare()
    }
  }, [isMobileAr, sceneReady, status, isPrepared, scaleMode])

  const footprintLabel = model
    ? `${model.size.x.toFixed(1)} × ${model.size.z.toFixed(1)} m`
    : null

  return (
    <div className="flex flex-col gap-3.5 text-foreground">
      {showHeader ? (
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="ui-eyebrow ui-eyebrow-rule">AR mode</span>
            {footprintLabel ? (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground tabular-nums">
                {footprintLabel}
              </p>
            ) : null}
          </div>
          <ScanBox className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      ) : footprintLabel ? (
        <p className="font-mono text-[10px] text-muted-foreground tabular-nums">{footprintLabel}</p>
      ) : null}

      {isMobileAr ? (
        <>
          <div>
            <span className="ui-eyebrow mb-1.5 block">Scale</span>
            <div
              aria-label="AR scale"
              className="grid grid-cols-2 gap-1 rounded-full bg-foreground/[0.06] p-1"
              role="group"
            >
              {SCALE_OPTIONS.map((option) => {
                const active = scaleMode === option.id
                return (
                  <button
                    aria-pressed={active}
                    className={`flex min-h-9 items-center justify-center gap-1.5 rounded-full px-3 font-medium text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 ${
                      active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                    }`}
                    disabled={status === 'preparing'}
                    key={option.id}
                    onClick={() => useArStore.getState().setScaleMode(option.id)}
                    type="button"
                  >
                    <span>{option.label}</span>
                    <span className={`font-mono text-[10px] ${active ? 'text-background/75' : 'text-muted-foreground'}`}>
                      {option.detail}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {!sceneReady ? (
            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 font-medium text-background text-xs opacity-50"
              disabled
              type="button"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Loading 3D scene…</span>
            </button>
          ) : status === 'preparing' ? (
            <div className="flex flex-col gap-2">
              <div className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-foreground/10 bg-foreground/[0.05] px-4 font-medium text-foreground text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="tabular-nums">Preparing model… {Math.round(progress * 100)}%</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="h-full rounded-full bg-foreground transition-[width] duration-150 ease-out"
                  style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }}
                />
              </div>
            </div>
          ) : status === 'error' ? (
            <div className="flex flex-col gap-2.5">
              <p className="rounded-2xl border border-foreground/10 bg-foreground/[0.04] px-3 py-2 text-muted-foreground text-xs leading-relaxed" role="alert">
                {error || 'Could not prepare this project for AR.'}
              </p>
              <button
                className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-full bg-foreground px-4 font-medium text-background text-xs transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                onClick={() => void useArStore.getState().prepare()}
                type="button"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Try again</span>
              </button>
            </div>
          ) : platform === 'quicklook' ? (
            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 font-medium text-background text-xs transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
              disabled={!usdzUrl}
              onClick={() => {
                if (!usdzUrl) return
                // Synchronous inside the tap so iOS Safari honours user activation for Quick Look.
                openInQuickLook(usdzUrl)
              }}
              type="button"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Open in AR</span>
            </button>
          ) : (
            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 font-medium text-background text-xs transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
              disabled={!isPrepared}
              onClick={() => {
                // Synchronous inside the tap so Chrome Android honours user activation for WebXR.
                onClose?.()
                useArStore.getState().startWebXr()
              }}
              type="button"
            >
              <ScanBox className="h-3.5 w-3.5" />
              <span>Start AR</span>
            </button>
          )}
        </>
      ) : platform === 'unsupported' ? (
        <div className="flex flex-col gap-3">
          <p className="rounded-2xl border border-foreground/10 bg-foreground/[0.04] px-3 py-2.5 text-muted-foreground text-xs leading-relaxed">
            {unsupportedReason === 'in-app-browser'
              ? 'Open this page in Chrome or Safari to use AR.'
              : 'AR needs Chrome on an ARCore Android phone, or Safari on iPhone or iPad.'}
          </p>
          <QrBlock caption="Or scan this with a phone that supports AR." url={shareUrl} />
        </div>
      ) : (
        <QrBlock caption="Scan with your phone to see this project in your space." url={shareUrl} />
      )}
    </div>
  )
}

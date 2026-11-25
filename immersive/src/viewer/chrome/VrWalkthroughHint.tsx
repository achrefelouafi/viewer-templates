import { Check, Copy, Glasses, X } from 'lucide-react'
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'pascal-viewer-vr-hint-dismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function saveDismissed() {
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // Storage may be unavailable in private iframes; dismissal still holds for this visit.
  }
}

/**
 * Walking on a page that can open a VR session (a headset's browser), an Enter VR pill takes
 * the walkthrough into the headset. Elsewhere, a dismissable hint says the walkthrough is also
 * available in VR, with the link to open in the headset's browser.
 */
export function VrWalkthroughHint({ visible, supported, busy = false, onEnterVr }: {
  visible: boolean
  supported: boolean
  busy?: boolean
  onEnterVr: () => void
}) {
  const [dismissed, setDismissed] = useState(readDismissed)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (!visible) return null
  if (supported) {
    return (
      <div
        className="ui-enter-up pointer-events-none absolute inset-x-4 bottom-[4.5rem] z-30 flex justify-center"
        data-vr-enter-hint=""
      >
        <div className="ui-glass pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full py-1.5 pr-1.5 pl-3.5 text-foreground text-xs">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Glasses aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-foreground/75" />
            <span>Your headset can walk this in VR</span>
          </span>
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground px-4 font-medium text-background text-xs transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            disabled={busy}
            onClick={onEnterVr}
            type="button"
          >
            <Glasses aria-hidden="true" className="h-3.5 w-3.5" />
            <span>{busy ? 'Starting VR…' : 'Enter VR'}</span>
          </button>
        </div>
      </div>
    )
  }
  if (dismissed) return null

  const handleCopy = () => {
    const url = window.location.href
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(
        () => setCopied(true),
        () => {},
      )
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    saveDismissed()
  }

  return (
    <div
      className="ui-enter-up pointer-events-none absolute inset-x-4 bottom-[4.5rem] z-30 flex justify-center"
      data-vr-unavailable-hint=""
    >
      <div className="ui-glass relative pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full py-1.5 pr-1.5 pl-3.5 text-foreground text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Glasses aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-foreground/75" />
          <span>Also available in VR — open this page in your headset&apos;s browser</span>
        </span>
        <button
          className="inline-flex h-7 items-center gap-1.5 rounded-full bg-foreground px-3 font-medium text-[11px] text-background transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          onClick={handleCopy}
          type="button"
        >
          {copied ? <Check aria-hidden="true" className="h-3 w-3" /> : <Copy aria-hidden="true" className="h-3 w-3" />}
          <span>{copied ? 'Copied' : 'Copy link'}</span>
        </button>
        <button
          aria-label="Dismiss VR hint"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          onClick={handleDismiss}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

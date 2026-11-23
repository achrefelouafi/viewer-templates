import { ArrowUpRight } from 'lucide-react'

/**
 * The hosted viewer's top-right prompt for visitors; "Get started" opens Pascal.
 * Collapses to a compact glass pill on phones so it stays clear of the project header card.
 */
export function GuestPrompt() {
  return (
    <div className="ui-chrome-enter pointer-events-none absolute top-4 right-3 z-20 text-foreground sm:right-6" data-guest-prompt="">
      <div className="ui-glass pointer-events-auto flex items-center gap-3 rounded-full p-1 sm:pl-4">
        <p className="hidden whitespace-nowrap text-muted-foreground text-xs sm:block lg:text-sm">
          Want to create your own 3D project?
        </p>
        <a
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-foreground px-3 py-1.5 font-medium text-background text-xs transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 sm:px-3.5"
          href="https://editor.pascal.app"
        >
          <span>Get started</span>
          <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 sm:hidden" />
        </a>
      </div>
    </div>
  )
}

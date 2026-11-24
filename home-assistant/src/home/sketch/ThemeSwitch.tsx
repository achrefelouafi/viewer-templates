import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { chooseTheme, isDark } from '../../theme'

/** Light or dark interface and plan, as one switch, as on the Pascal template's tour. */
export function ThemeSwitch({ className = 'absolute top-4 right-4 z-30 sm:right-6' }: { className?: string }) {
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
  return (
    <button
      aria-checked={dark}
      aria-label="Dark mode"
      className={`corner-smooth pointer-events-auto flex h-10 items-center gap-2 rounded-full border border-border/60 bg-background/95 p-1 pr-3 text-foreground shadow-elevation-4 backdrop-blur-xl ${className}`}
      data-theme-switch=""
      onClick={() => chooseTheme(!dark)}
      role="switch"
      type="button"
    >
      <span className="relative flex h-8 w-14 items-center justify-between rounded-full bg-accent px-2">
        <span className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-foreground shadow transition-transform duration-300 ${dark ? 'translate-x-6' : ''}`} />
        <Sun className={`relative h-3.5 w-3.5 ${dark ? 'text-muted-foreground' : 'text-background'}`} />
        <Moon className={`relative h-3.5 w-3.5 ${dark ? 'text-background' : 'text-muted-foreground'}`} />
      </span>
      <span className="w-9 font-medium text-xs">{dark ? 'Dark' : 'Light'}</span>
    </button>
  )
}

/**
 * Light or dark interface. The system setting decides until the visitor flips the switch; their
 * choice is then remembered in this browser. The viewer's own header and controls bar stay dark
 * (the package draws them so); the page and the guided tour's Noir/Paper 3D look follow this.
 */
const KEY = 'pascal-viewer-theme'
const system = () => matchMedia('(prefers-color-scheme: dark)').matches

export function chosenTheme(): 'light' | 'dark' | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export function isDark() {
  const chosen = chosenTheme()
  return chosen ? chosen === 'dark' : system()
}

export function applyTheme() {
  document.documentElement.classList.toggle('dark', isDark())
}

export function chooseTheme(dark: boolean) {
  try {
    localStorage.setItem(KEY, dark ? 'dark' : 'light')
  } catch {
    // Not remembered; the switch still works for this visit.
  }
  applyTheme()
  dispatchEvent(new Event('pascal-theme'))
}

import { useViewer } from '@pascal-app/viewer'
import { useEffect, useSyncExternalStore } from 'react'
import { useTourLook } from '../../tour/look'

const STORAGE_KEY = 'pascal-viewer-ao'
const listeners = new Set<() => void>()

function readStored(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

let enabled = readStored()
let applying = false

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): boolean {
  return enabled
}

/**
 * Applies the preference to `useViewer`'s live `sceneAppearance` via shallow copies, writing only
 * when the effective flag differs so store subscriptions never loop. Skips writes while
 * `TourNoir` owns `sceneAppearance` (which enforces strict object-identity equality and restores
 * via `showSceneTheme` on exit, triggering our subscriber once the tour ends). `sceneAppearance`
 * is not in `useViewer`'s persisted `partialize` slice, so this never pollutes saved viewer prefs.
 */
function applyAmbientOcclusion(want: boolean) {
  if (applying || useTourLook.getState().active) return
  const current = useViewer.getState().sceneAppearance
  const effective = current.postprocessing?.ambientOcclusion !== false
  if (effective === want) return
  applying = true
  try {
    useViewer.setState({
      sceneAppearance: {
        ...current,
        postprocessing: {
          ...current.postprocessing,
          ambientOcclusion: want,
        },
      },
    })
  } finally {
    applying = false
  }
}

export function setAmbientOcclusion(next: boolean) {
  const changed = next !== enabled
  enabled = next
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    // Storage unavailable (private mode or sandboxed embed); keep the preference in memory.
  }
  applyAmbientOcclusion(enabled)
  if (changed) {
    for (const listener of listeners) listener()
  }
}

/** Persisted Ambient occlusion preference (`pascal-viewer-ao`, on by default). */
export function useAmbientOcclusion() {
  const value = useSyncExternalStore(subscribe, getSnapshot, () => true)
  return [value, setAmbientOcclusion] as const
}

/**
 * Keeps `useViewer.sceneAppearance.postprocessing.ambientOcclusion` aligned with the persisted
 * preference across theme changes, `showSceneTheme`, and the guided tour's `tourAppearance`.
 */
export function useSyncAmbientOcclusion() {
  useEffect(() => {
    applyAmbientOcclusion(enabled)
    const unsubscribeViewer = useViewer.subscribe((state, prev) => {
      if (state.sceneAppearance !== prev.sceneAppearance) {
        applyAmbientOcclusion(enabled)
      }
    })
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return
      const next = readStored()
      if (next !== enabled) {
        enabled = next
        applyAmbientOcclusion(enabled)
        for (const listener of listeners) listener()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      unsubscribeViewer()
      window.removeEventListener('storage', onStorage)
    }
  }, [])
}

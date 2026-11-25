import { create } from 'zustand'

export type VrContrast = 'soft' | 'natural' | 'punchy'

export const VR_BRIGHTNESS_MIN = 0.4
export const VR_BRIGHTNESS_MAX = 2
export const VR_BRIGHTNESS_STEP = 0.1

const STORAGE_KEY = 'pascal-viewer-vr-look'

interface VrLookState {
  /** Multiplies the headset's exposure; 1 keeps the metered value. */
  brightness: number
  /** Tone mapping curve: AgX (soft), Khronos neutral (natural) or ACES filmic (punchy, the desktop look). */
  contrast: VrContrast
  nudgeBrightness: (direction: 1 | -1) => void
  setContrast: (contrast: VrContrast) => void
}

function readSaved(): Pick<VrLookState, 'brightness' | 'contrast'> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<VrLookState> | null
    const brightness = typeof saved?.brightness === 'number'
      ? Math.min(VR_BRIGHTNESS_MAX, Math.max(VR_BRIGHTNESS_MIN, saved.brightness))
      : 1
    const contrast = saved?.contrast === 'soft' || saved?.contrast === 'natural' || saved?.contrast === 'punchy'
      ? saved.contrast
      : 'punchy'
    return { brightness, contrast }
  } catch {
    return { brightness: 1, contrast: 'punchy' }
  }
}

function save(state: Pick<VrLookState, 'brightness' | 'contrast'>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ brightness: state.brightness, contrast: state.contrast }))
  } catch {
    // Storage can be unavailable; the setting still holds for this visit.
  }
}

/** The headset's look settings, changed from the in-VR menu and kept between visits. */
export const useVrLook = create<VrLookState>((set, get) => ({
  ...readSaved(),
  nudgeBrightness(direction) {
    const next = Math.round((get().brightness + direction * VR_BRIGHTNESS_STEP) * 10) / 10
    const brightness = Math.min(VR_BRIGHTNESS_MAX, Math.max(VR_BRIGHTNESS_MIN, next))
    set({ brightness })
    save({ ...get(), brightness })
  },
  setContrast(contrast) {
    set({ contrast })
    save({ ...get(), contrast })
  },
}))

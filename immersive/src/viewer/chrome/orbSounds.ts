import { playSound, preloadSounds, type SoundDefinition } from '@pascal-app/viewer/sfx'

// The orb menu's cues, files made by scripts/make-orb-sounds.mjs. They play through the package's
// player, so the viewer's mute and volume settings apply. Pitch is set with a fixed playback rate.

/** A pentatonic step above the root, as a playback rate: index 0 is the root. */
const step = (index: number) => {
  const semitones = [0, 2, 4, 7, 9]
  const octave = Math.floor(index / semitones.length)
  return 2 ** ((semitones[index % semitones.length]! + 12 * octave) / 12)
}

// The player caches by definition object and rebuilds its whole cache when it meets a new one,
// so each distinct cue is made once and reused.
const cues = new Map<string, SoundDefinition>()
const cue = (src: string, rate: number, volume: number, minIntervalMs = 0): SoundDefinition => {
  const key = `${src}|${rate.toFixed(4)}|${volume.toFixed(3)}|${minIntervalMs}`
  let definition = cues.get(key)
  if (!definition) {
    definition = { src, rateRange: [rate * 0.995, rate * 1.005], volumeRange: [volume * 0.9, volume], minIntervalMs }
    cues.set(key, definition)
  }
  return definition
}

const OPEN = cue('orb_open.mp3', 1, 0.42)
const CLOSE = cue('orb_close.mp3', 1, 0.36)
const TAP = cue('orb_tap.mp3', 1, 0.45, 40)

/** The most tools the orb holds; ticks are prepared for each place on the arc. */
const MAX_TOOLS = 12
const cascadeTick = (i: number) => cue('orb_tick.mp3', step(i) * 0.9, 0.16 + i * 0.008)
const hoverTick = (i: number) => cue('orb_tick.mp3', step(i) * 0.9, 0.13, 60)
const popoverTap = (open: boolean) => cue('orb_tap.mp3', open ? 1.18 : 0.84, 0.4, 40)

/** Register and load every cue up front, so the player builds its cache once, not mid-cascade. */
export function preloadOrbSounds() {
  const all = [OPEN, CLOSE, TAP, popoverTap(true), popoverTap(false)]
  for (let i = 0; i < MAX_TOOLS; i++) all.push(cascadeTick(i), hoverTick(i))
  preloadSounds(all)
}

/** Same stagger as `.orb-item`'s transition delay in styles.css (`--i` × 24ms). */
const STAGGER_MS = 24
let cascade: ReturnType<typeof setTimeout>[] = []
const cancelCascade = () => {
  for (const timer of cascade) clearTimeout(timer)
  cascade = []
}

/** The orb opens: a rising bloop, then one tick per tool climbing the scale as it lands. */
export function playOrbOpen(count: number) {
  cancelCascade()
  playSound(OPEN)
  for (let i = 0; i < Math.min(count, MAX_TOOLS); i++) {
    cascade.push(setTimeout(() => playSound(cascadeTick(i)), 70 + i * STAGGER_MS))
  }
}

/** The orb folds its tools away. */
export function playOrbClose() {
  cancelCascade()
  playSound(CLOSE)
}

/** Pointer over a tool: a quiet tick pitched by the tool's place on the arc. */
export function playOrbHover(index: number) {
  playSound(hoverTick(Math.min(index, MAX_TOOLS - 1)))
}

/** A tool is pressed, or a popover opens (higher) or closes (lower). */
export function playOrbTap(kind: 'press' | 'open' | 'close' = 'press') {
  playSound(kind === 'press' ? TAP : popoverTap(kind === 'open'))
}

/** The theme switch flips: the package's switch clicks. */
export function playOrbSwitch(on: boolean) {
  playSound(on ? 'switchOn' : 'switchOff')
}

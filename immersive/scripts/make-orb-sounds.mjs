// Synthesises the orb menu's cues into public/audios/sfx with ffmpeg (must be on PATH).
// Run: node scripts/make-orb-sounds.mjs. Each cue is a few sine partials under a short envelope;
// glides integrate the frequency so the pitch bends without clicks.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const out = fileURLToPath(new URL('../public/audios/sfx/', import.meta.url))

// A sine whose pitch glides linearly from f0 to f1 over g seconds, then holds f1.
const glide = (f0, f1, g) => {
  const k = (f1 - f0) / g
  return `sin(2*PI*(${f0}*min(t,${g})+0.5*${k}*pow(min(t,${g}),2)+${f1}*max(t-${g},0)))`
}

const cues = {
  // Rising two-partial bloop as the tools fan out.
  orb_open: {
    d: 0.26,
    expr: `(1-exp(-t*500))*exp(-t*16)*(0.8*${glide(420, 860, 0.09)}+0.18*${glide(840, 1720, 0.09)})`,
  },
  // The same bloop falling as the tools fold back in.
  orb_close: {
    d: 0.2,
    expr: `(1-exp(-t*500))*exp(-t*24)*(0.8*${glide(780, 380, 0.08)}+0.15*${glide(1560, 760, 0.08)})`,
  },
  // Glassy tick; played at rising rates to make the fan-out cascade, and on hover.
  orb_tick: {
    d: 0.1,
    expr: `(1-exp(-t*1500))*(0.6*sin(2*PI*1760*t)*exp(-t*60)+0.25*sin(2*PI*2640*t)*exp(-t*85)+0.15*sin(2*PI*3520*t)*exp(-t*110))`,
  },
  // Soft pop for pressing a tool: a quick downward bend with a tiny transient.
  orb_tap: {
    d: 0.14,
    expr: `(1-exp(-t*900))*exp(-t*34)*(0.85*${glide(640, 300, 0.045)}+0.12*sin(2*PI*1900*t)*exp(-t*120))`,
  },
}

for (const [name, { d, expr }] of Object.entries(cues)) {
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `aevalsrc='${expr}':s=44100:d=${d}`,
      '-af', 'afade=t=out:st=' + (d - 0.02).toFixed(3) + ':d=0.02,loudnorm=I=-20:TP=-3:LRA=7,aresample=44100',
      '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k',
      `${out}${name}.mp3`,
    ],
    { stdio: 'inherit' },
  )
  console.log(`wrote ${name}.mp3`)
}

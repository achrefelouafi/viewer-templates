import { type TimeOfDay, useViewer } from '@pascal-app/viewer'
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three'
import { create } from 'zustand'
import { useVrLook, type VrContrast } from './look'
import { useVrStore } from './store'

/** Canvas size of the in-VR menu; the panel keeps this aspect. */
export const MENU_CANVAS_W = 1024
export const MENU_CANVAS_H = 760
/** Panel width in metres. */
export const MENU_PANEL_W = 0.64
export const MENU_PANEL_H = (MENU_PANEL_W * MENU_CANVAS_H) / MENU_CANVAS_W

type MenuButton = {
  id: string
  x: number
  y: number
  w: number
  h: number
  label: string
  active?: boolean
  primary?: boolean
  run: () => void
}

const CONTRASTS: { id: VrContrast; label: string }[] = [
  { id: 'soft', label: 'Soft' },
  { id: 'natural', label: 'Natural' },
  { id: 'punchy', label: 'Punchy' },
]

const TIMES: { id: TimeOfDay; label: string }[] = [
  { id: 'midday', label: 'Midday' },
  { id: 'golden', label: 'Golden hour' },
  { id: 'blue', label: 'Blue hour' },
  { id: 'night', label: 'Night' },
]

const FONT = '"Barlow", system-ui, -apple-system, sans-serif'
const PAD = 56
const ROW_LABEL_W = 210

function setTime(time: TimeOfDay) {
  const viewer = useViewer.getState()
  viewer.setSkyLive(false)
  viewer.setTimeOfDayMinutes(null)
  viewer.setTimeOfDay(time)
}

/** The buttons for the current settings, laid out in canvas pixels. */
function layout(): MenuButton[] {
  const look = useVrLook.getState()
  const timeOfDay = useViewer.getState().timeOfDay
  const buttons: MenuButton[] = []
  const rowH = 76
  const gap = 14
  const left = PAD + ROW_LABEL_W
  const width = MENU_CANVAS_W - left - PAD

  buttons.push({
    id: 'close', x: MENU_CANVAS_W - PAD - 64, y: 40, w: 64, h: 64, label: '✕',
    run: () => useVrMenu.getState().setOpen(false),
  })

  let y = 150
  // Brightness: minus, readout, plus.
  buttons.push({ id: 'brightness-down', x: left, y, w: 96, h: rowH, label: '−', run: () => look.nudgeBrightness(-1) })
  buttons.push({ id: 'brightness-up', x: left + width - 96, y, w: 96, h: rowH, label: '+', run: () => look.nudgeBrightness(1) })

  y += rowH + 40
  const contrastW = (width - gap * (CONTRASTS.length - 1)) / CONTRASTS.length
  CONTRASTS.forEach((option, index) => {
    buttons.push({
      id: `contrast-${option.id}`, x: left + index * (contrastW + gap), y, w: contrastW, h: rowH,
      label: option.label, active: look.contrast === option.id, run: () => look.setContrast(option.id),
    })
  })

  y += rowH + 40
  const timeW = (width - gap) / 2
  TIMES.forEach((option, index) => {
    const col = index % 2
    const row = Math.floor(index / 2)
    buttons.push({
      id: `time-${option.id}`, x: left + col * (timeW + gap), y: y + row * (rowH + gap), w: timeW, h: rowH,
      label: option.label, active: timeOfDay === option.id, run: () => setTime(option.id),
    })
  })

  y += 2 * rowH + gap + 48
  buttons.push({
    id: 'exit', x: PAD, y, w: 240, h: rowH, label: 'Exit VR', primary: true,
    run: () => useVrStore.getState().exitVr(),
  })
  return buttons
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

export type MenuCanvas = {
  canvas: HTMLCanvasElement
  texture: CanvasTexture
  buttons: MenuButton[]
  drawnKey: string
}

export function createMenuCanvas(): MenuCanvas {
  const canvas = document.createElement('canvas')
  canvas.width = MENU_CANVAS_W
  canvas.height = MENU_CANVAS_H
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  return { canvas, texture, buttons: [], drawnKey: '' }
}

/** Redraws the panel when the settings or the hovered button changed. */
export function drawMenu(menu: MenuCanvas, hoveredId: string | null) {
  const look = useVrLook.getState()
  const timeOfDay = useViewer.getState().timeOfDay
  const key = `${look.brightness}|${look.contrast}|${timeOfDay}|${hoveredId ?? ''}`
  if (key === menu.drawnKey) return
  menu.drawnKey = key
  menu.buttons = layout()

  const ctx = menu.canvas.getContext('2d')
  if (!ctx) return
  const W = MENU_CANVAS_W
  const H = MENU_CANVAS_H
  ctx.clearRect(0, 0, W, H)
  roundRect(ctx, 4, 4, W - 8, H - 8, 56)
  ctx.fillStyle = 'rgba(16, 19, 26, 0.94)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#f5f5f5'
  ctx.font = `500 44px ${FONT}`
  ctx.fillText('View settings', PAD, 72)

  const rowLabels: [string, number][] = [['Brightness', 188], ['Contrast', 304], ['Light', 420]]
  ctx.font = `500 32px ${FONT}`
  ctx.fillStyle = 'rgba(245, 245, 245, 0.6)'
  for (const [label, y] of rowLabels) ctx.fillText(label, PAD, y)

  // Brightness readout between the minus and plus buttons.
  ctx.textAlign = 'center'
  ctx.fillStyle = '#f5f5f5'
  ctx.font = `500 36px ${FONT}`
  ctx.fillText(`${Math.round(look.brightness * 100)}%`, (PAD + ROW_LABEL_W + W - PAD) / 2, 188)

  for (const button of menu.buttons) {
    const hovered = button.id === hoveredId
    roundRect(ctx, button.x, button.y, button.w, button.h, button.h / 2)
    ctx.fillStyle = button.active || button.primary
      ? hovered ? '#ffffff' : 'rgba(245, 245, 245, 0.92)'
      : hovered ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.08)'
    ctx.fill()
    ctx.fillStyle = button.active || button.primary ? '#111318' : '#f5f5f5'
    ctx.font = `500 ${button.label.length <= 1 ? 44 : 32}px ${FONT}`
    ctx.fillText(button.label, button.x + button.w / 2, button.y + button.h / 2 + 2)
  }

  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(245, 245, 245, 0.5)'
  ctx.font = `400 26px ${FONT}`
  ctx.fillText('Trigger: use or click', PAD + 280, H - 120)
  ctx.fillText('B / Y: this menu · Sticks: walk and turn', PAD + 280, H - 82)
  menu.texture.needsUpdate = true
}

/** The button under a point on the panel, from the hit's UV. */
export function menuButtonAt(menu: MenuCanvas, u: number, v: number): MenuButton | null {
  const x = u * MENU_CANVAS_W
  const y = (1 - v) * MENU_CANVAS_H
  return menu.buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) ?? null
}

export const useVrMenu = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

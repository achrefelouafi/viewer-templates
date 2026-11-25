import type { WebGPURenderer } from 'three/webgpu'
import { type ArScaleMode, type BuiltArModel, scaleFactorForMode } from './buildArModel'
import { createArTextureUtils, MAX_AR_TEXTURE_SIZE } from './textures'

/** 1×1 transparent GIF required inside `<a rel="ar">` so iOS Safari launches Quick Look. */
const QUICK_LOOK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/**
 * Exports a prepared AR model to a Quick Look–compatible USDZ Blob URL at the chosen scale.
 * `USDZExporter` (and `fflate`) are dynamically imported to stay out of the main entry chunk.
 */
export async function exportModelToUsdzUrl(
  model: BuiltArModel,
  scaleMode: ArScaleMode,
  renderer: WebGPURenderer,
): Promise<string> {
  const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js')
  const exporter = new USDZExporter()
  exporter.setTextureUtils(
    createArTextureUtils(renderer, MAX_AR_TEXTURE_SIZE) as unknown as Parameters<typeof exporter.setTextureUtils>[0],
  )

  const scale = scaleFactorForMode(model, scaleMode)
  const prevScale = model.group.scale.clone()
  try {
    model.group.scale.setScalar(scale)
    model.group.updateMatrix()
    model.group.updateMatrixWorld(true)

    const bytes = await exporter.parseAsync(model.group, {
      quickLookCompatible: true,
      maxTextureSize: MAX_AR_TEXTURE_SIZE,
      onlyVisible: true,
      includeAnchoringProperties: true,
      ar: {
        anchoring: { type: 'plane' },
        planeAnchoring: { alignment: 'horizontal' },
      },
    })

    const compact = await compactUsdz(bytes)
    const blob = new Blob([compact], { type: 'model/vnd.usdz+zip' })
    return URL.createObjectURL(blob)
  } finally {
    model.group.scale.copy(prevScale)
    model.group.updateMatrix()
    model.group.updateMatrixWorld(true)
  }
}

/** Vertex arrays whose numbers are rewritten shorter. Nothing else in the USDA is touched. */
const VERTEX_ARRAY_LINE = /^\s*(?:point3f\[\] points|normal3f\[\] normals|texCoord2f\[\] primvars:st\d*) = \[/
const NEWLINE = String.fromCharCode(10)
const DECIMAL = /-?\d+\.\d+(?:e[-+]?\d+)?/g

function shortNumber(text: string): string {
  const value = Number(text)
  // 4 decimals is a tenth of a millimetre at life size, finer still on the tabletop model.
  const rounded = Math.round(value * 10000) / 10000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/**
 * The exporter writes every vertex number with 7 significant digits, and a USDZ is an
 * uncompressed zip, so a house's geometry runs to tens of megabytes. This rewrites the vertex
 * arrays with at most 4 decimals and re-packs the archive with each file's data on a 64-byte
 * boundary, as USDZ requires.
 */
async function compactUsdz(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const { unzipSync, zipSync } = await import('three/examples/jsm/libs/fflate.module.js')
  const entries = unzipSync(bytes)
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const files: Record<string, [Uint8Array, { extra: Record<number, Uint8Array> }]> = {}
  let offset = 0

  for (const [name, original] of Object.entries(entries)) {
    let data = original
    if (name.endsWith('.usda')) {
      const lines = decoder.decode(original).split(NEWLINE)
      for (let i = 0; i < lines.length; i++) {
        if (VERTEX_ARRAY_LINE.test(lines[i]!)) lines[i] = lines[i]!.replace(DECIMAL, shortNumber)
      }
      data = encoder.encode(lines.join(NEWLINE))
    }
    // Local header (30 bytes) + name + extra field (4-byte header + padding), then the data.
    const nameLength = encoder.encode(name).length
    const unpadded = offset + 30 + nameLength + 4
    const padding = (64 - (unpadded % 64)) % 64
    files[name] = [data, { extra: { 12345: new Uint8Array(padding) } }]
    offset = unpadded + padding + data.length
  }

  return zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>
}

/**
 * Opens a cached USDZ Blob URL in Apple Quick Look.
 * Must be called synchronously inside a user tap handler on iOS / iPadOS Safari.
 */
export function openInQuickLook(blobUrl: string): void {
  const anchor = document.createElement('a')
  anchor.rel = 'ar'
  anchor.href = blobUrl
  anchor.style.position = 'fixed'
  anchor.style.left = '-9999px'
  anchor.style.opacity = '0'
  anchor.style.pointerEvents = 'none'

  const img = document.createElement('img')
  img.src = QUICK_LOOK_PIXEL
  img.alt = ''
  anchor.appendChild(img)

  document.body.appendChild(anchor)
  anchor.click()
  window.setTimeout(() => anchor.remove(), 0)
}

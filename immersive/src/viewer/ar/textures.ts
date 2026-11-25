import {
  CanvasTexture,
  NoToneMapping,
  RGBAFormat,
  RenderTarget,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
} from 'three'
import { texture as tslTexture, uv, workingToColorSpace } from 'three/tsl'
import { NodeMaterial, QuadMesh, type WebGPURenderer } from 'three/webgpu'

export const MAX_AR_TEXTURE_SIZE = 1024

const warnedTextureSources = new WeakSet<object>()

function warnTextureOnce(source: Texture, reason: unknown) {
  const key = source.source ?? source
  if (warnedTextureSources.has(key)) return
  warnedTextureSources.add(key)
  console.warn('[ar] skipping texture that could not be converted', source.name || source.uuid, reason)
}

function fitDimensions(width: number, height: number, maxSize: number): { width: number; height: number } {
  const safeW = Math.max(1, Math.round(width))
  const safeH = Math.max(1, Math.round(height))
  const maxDim = Math.max(safeW, safeH)
  if (maxDim <= maxSize) return { width: safeW, height: safeH }
  const scale = maxSize / maxDim
  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
  }
}

function copyTextureMetadata(source: Texture, target: CanvasTexture, needsAlpha: boolean): CanvasTexture {
  target.wrapS = source.wrapS
  target.wrapT = source.wrapT
  target.repeat.copy(source.repeat)
  target.offset.copy(source.offset)
  target.center.copy(source.center)
  target.rotation = source.rotation
  target.channel = source.channel
  target.colorSpace = source.colorSpace
  target.minFilter = source.minFilter
  target.magFilter = source.magFilter
  target.name = source.name
  // Opaque architectural maps encode much smaller in USDZ as JPEG; keep PNG when alpha is used.
  target.userData.mimeType = needsAlpha ? 'image/png' : 'image/jpeg'
  target.needsUpdate = true
  return target
}

function isDrawableImage(image: unknown): image is HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas {
  if (!image || typeof image !== 'object') return false
  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
    return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
  }
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    return image.width > 0 && image.height > 0
  }
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    return image.width > 0 && image.height > 0
  }
  if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) {
    return image.width > 0 && image.height > 0
  }
  return false
}

function isDataTextureImage(image: unknown): image is { data: ArrayBufferView; width: number; height: number } {
  if (!image || typeof image !== 'object') return false
  const candidate = image as { data?: unknown; width?: unknown; height?: unknown }
  return (
    ArrayBuffer.isView(candidate.data) &&
    typeof candidate.width === 'number' &&
    candidate.width > 0 &&
    typeof candidate.height === 'number' &&
    candidate.height > 0
  )
}

function pixelsToCanvas(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  flipRows: boolean,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create 2D canvas context')

  const clamped = new Uint8ClampedArray(width * height * 4)
  const rowBytes = width * 4
  if (flipRows) {
    for (let y = 0; y < height; y++) {
      const srcOffset = (height - 1 - y) * rowBytes
      const dstOffset = y * rowBytes
      clamped.set(pixels.subarray(srcOffset, srcOffset + rowBytes), dstOffset)
    }
  } else {
    clamped.set(pixels.subarray(0, clamped.length))
  }

  ctx.putImageData(new ImageData(clamped, width, height), 0, 0)
  return canvas
}

function scaleCanvas(source: HTMLCanvasElement, maxSize: number): HTMLCanvasElement {
  const { width, height } = fitDimensions(source.width, source.height, maxSize)
  if (width === source.width && height === source.height) return source
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return source
  ctx.drawImage(source, 0, 0, width, height)
  return canvas
}

function drawImageToCanvas(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas,
  flipY: boolean,
  maxSize: number,
): HTMLCanvasElement {
  const srcW = 'naturalWidth' in image ? image.naturalWidth : image.width
  const srcH = 'naturalHeight' in image ? image.naturalHeight : image.height
  const { width, height } = fitDimensions(srcW, srcH, maxSize)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create 2D canvas context')

  // CanvasTexture always uses flipY = true, where canvas row 0 maps to UV v = 1.
  // If the source texture had flipY = false (glTF convention), invert once so v = 0/1 match.
  if (!flipY) {
    ctx.translate(0, height)
    ctx.scale(1, -1)
  }
  ctx.drawImage(image, 0, 0, width, height)
  return canvas
}

function drawDataTextureToCanvas(
  image: { data: ArrayBufferView; width: number; height: number },
  flipY: boolean,
  maxSize: number,
): HTMLCanvasElement {
  const { width, height } = image
  let rgba: Uint8ClampedArray
  if (image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) {
    if (image.data.length === width * height * 4) {
      rgba = new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.byteLength)
    } else {
      throw new Error(`Unsupported DataTexture channel layout (${image.data.length} bytes for ${width}x${height})`)
    }
  } else if (image.data instanceof Float32Array && image.data.length === width * height * 4) {
    rgba = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < rgba.length; i++) {
      rgba[i] = Math.max(0, Math.min(255, Math.round((image.data[i] ?? 0) * 255)))
    }
  } else {
    throw new Error('Unsupported DataTexture buffer type')
  }

  // DataTexture with flipY = false has row 0 at v = 0 (bottom of canvas); flip so canvas row 0 is v = 1.
  const rawCanvas = pixelsToCanvas(rgba, width, height, !flipY)
  return scaleCanvas(rawCanvas, maxSize)
}

/**
 * Decompresses a GPU-compressed texture (e.g. KTX2) into a 2D CanvasTexture via a dedicated
 * offscreen RenderTarget on the viewer's WebGPURenderer — never resizing or drawing into the
 * live viewer canvas.
 */
async function decompressViaRenderTarget(
  source: Texture,
  renderer: WebGPURenderer,
  maxSize: number,
  needsAlpha: boolean,
): Promise<CanvasTexture> {
  const img = source.image as { width?: number; height?: number } | undefined
  const mip = (source as { mipmaps?: Array<{ width?: number; height?: number }> }).mipmaps?.[0]
  const rawW = img?.width || mip?.width || 0
  const rawH = img?.height || mip?.height || 0
  if (rawW <= 0 || rawH <= 0) {
    throw new Error('Compressed texture has no valid dimensions')
  }

  const { width, height } = fitDimensions(rawW, rawH, maxSize)
  const target = new RenderTarget(width, height, {
    type: UnsignedByteType,
    format: RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    samples: 0,
    generateMipmaps: false,
  })
  target.texture.colorSpace = source.colorSpace

  const material = new NodeMaterial()
  // QuadGeometry places uv.y = 0 at clip top and uv.y = 1 at clip bottom; uv().flipY() maps
  // UV v = 1 to clip top and v = 0 to clip bottom, matching CanvasTexture's flipY = true layout.
  const sampled = tslTexture(source, uv().flipY())
  // Custom RenderTargets render in linear working color space; encode sRGB explicitly for color maps.
  material.fragmentNode =
    source.colorSpace === SRGBColorSpace ? workingToColorSpace(sampled, SRGBColorSpace) : sampled
  material.toneMapped = false

  const quad = new QuadMesh(material)
  const prevTarget = renderer.getRenderTarget()
  const prevToneMapping = renderer.toneMapping
  const prevAutoClear = renderer.autoClear

  try {
    renderer.toneMapping = NoToneMapping
    renderer.autoClear = true
    renderer.setRenderTarget(target)
    quad.render(renderer)

    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)
    const bytes =
      pixels instanceof Uint8Array
        ? pixels
        : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)

    // WebGL gl.readPixels returns bottom-up rows (clip y = -1 first); WebGPU returns top-down rows.
    const isWebGLBackend = (renderer.backend as { isWebGLBackend?: boolean } | undefined)?.isWebGLBackend === true
    const canvas = pixelsToCanvas(bytes, width, height, isWebGLBackend)
    const result = new CanvasTexture(canvas)
    result.flipY = true
    return copyTextureMetadata(source, result, needsAlpha)
  } finally {
    renderer.setRenderTarget(prevTarget)
    renderer.toneMapping = prevToneMapping
    renderer.autoClear = prevAutoClear
    material.dispose()
    target.dispose()
  }
}

/**
 * Converts any Three.js texture (KTX2 CompressedTexture, DataTexture, or DOM image) into a
 * renderer-independent CanvasTexture capped at `maxSize` px, suitable for both USDZ export and
 * a separate WebXR WebGLRenderer context. Returns null (falling back to a flat material color)
 * if the texture cannot be read or decompressed.
 */
export async function convertTextureForAr(
  source: Texture | null | undefined,
  renderer: WebGPURenderer,
  cache: Map<string, CanvasTexture | null>,
  maxSize = MAX_AR_TEXTURE_SIZE,
  needsAlpha = false,
): Promise<CanvasTexture | null> {
  if (!source) return null

  const cacheKey = `${source.source.id}:${source.flipY ? 1 : 0}:${source.colorSpace}:${needsAlpha ? 1 : 0}:${maxSize}`
  if (cache.has(cacheKey)) {
    const base = cache.get(cacheKey) ?? null
    if (!base) return null
    // Preserve per-slot repeat/offset/rotation/channel while sharing the underlying canvas.
    const clone = new CanvasTexture(base.image as HTMLCanvasElement)
    clone.flipY = true
    return copyTextureMetadata(source, clone, needsAlpha)
  }

  try {
    let converted: CanvasTexture
    if ((source as { isCompressedTexture?: boolean }).isCompressedTexture === true) {
      converted = await decompressViaRenderTarget(source, renderer, maxSize, needsAlpha)
    } else if (isDrawableImage(source.image)) {
      const canvas = drawImageToCanvas(source.image, source.flipY, maxSize)
      converted = new CanvasTexture(canvas)
      converted.flipY = true
      copyTextureMetadata(source, converted, needsAlpha)
    } else if (isDataTextureImage(source.image)) {
      const canvas = drawDataTextureToCanvas(source.image, source.flipY, maxSize)
      converted = new CanvasTexture(canvas)
      converted.flipY = true
      copyTextureMetadata(source, converted, needsAlpha)
    } else {
      throw new Error('Texture image is not loaded or has an unsupported source type')
    }

    cache.set(cacheKey, converted)
    return converted
  } catch (error) {
    warnTextureOnce(source, error)
    cache.set(cacheKey, null)
    return null
  }
}

/**
 * Defensive `textureUtils` adapter for `USDZExporter.setTextureUtils()` in case any compressed
 * texture ever reaches the exporter directly.
 */
export function createArTextureUtils(renderer: WebGPURenderer, maxSize = MAX_AR_TEXTURE_SIZE) {
  return {
    decompress: async (blitTexture: Texture, requestedMax = maxSize) => {
      const limit = Number.isFinite(requestedMax) ? Math.min(requestedMax, maxSize) : maxSize
      return decompressViaRenderTarget(blitTexture, renderer, limit, false)
    },
  }
}

import { GlobalFonts, createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from '@napi-rs/canvas'
import { labelBox, type LabelLine } from './labels'
import type { ExportSettings, Rect } from './types'

const FONT_REGULAR = 'FC Arial'
const FONT_BOLD = 'FC Arial Bold'
let fontsRegistered = false

/** Registers Arial (regular and bold) once; the font stacks fall back to sans-serif if missing. */
function ensureFonts(): void {
  if (fontsRegistered) return
  fontsRegistered = true
  GlobalFonts.registerFromPath('C:/Windows/Fonts/arial.ttf', FONT_REGULAR)
  GlobalFonts.registerFromPath('C:/Windows/Fonts/arialbd.ttf', FONT_BOLD)
}

const fontFor = (l: LabelLine, size: number): string =>
  l.bold ? `bold ${size}px "${FONT_BOLD}", sans-serif` : `${size}px "${FONT_REGULAR}", sans-serif`

/** Returns the PNG cropped to `crop` (captured-image coordinates), or the whole image when null. */
export async function cropImage(png: Buffer, crop: Rect | null): Promise<Image | Canvas> {
  const img = await loadImage(png)
  if (!crop) return img
  const c = createCanvas(crop.w, crop.h)
  c.getContext('2d').drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h)
  return c
}

/** Fills the cell with black, then draws the image per the fit mode. */
export function drawFitted(
  ctx: SKRSContext2D,
  img: Image | Canvas,
  cell: Rect,
  fit: ExportSettings['fit']
): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(cell.x, cell.y, cell.w, cell.h)
  const iw = img.width
  const ih = img.height
  if (iw <= 0 || ih <= 0) return
  ctx.save()
  ctx.beginPath()
  ctx.rect(cell.x, cell.y, cell.w, cell.h)
  ctx.clip()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (fit === 'stretch') {
    ctx.drawImage(img, 0, 0, iw, ih, cell.x, cell.y, cell.w, cell.h)
  } else if (fit === 'contain') {
    const s = Math.min(cell.w / iw, cell.h / ih)
    const dw = iw * s
    const dh = ih * s
    ctx.drawImage(img, 0, 0, iw, ih, cell.x + (cell.w - dw) / 2, cell.y + (cell.h - dh) / 2, dw, dh)
  } else {
    // cover: crop the source symmetrically to the cell aspect ratio
    const s = Math.max(cell.w / iw, cell.h / ih)
    const sw = cell.w / s
    const sh = cell.h / s
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, cell.x, cell.y, cell.w, cell.h)
  }
  ctx.restore()
}

/** Draws the label box anchored to the cell's top-right corner; text is right-aligned in the box. */
export function drawLabel(ctx: SKRSContext2D, lines: LabelLine[], cell: Rect, fontSize: number): void {
  if (lines.length === 0) return
  ensureFonts()
  ctx.save()
  const box = labelBox(lines, fontSize, (l) => {
    ctx.font = fontFor(l, fontSize)
    return ctx.measureText(l.text).width
  })
  const width = Math.ceil(box.width)
  const x = cell.x + cell.w - width
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.fillRect(x, cell.y, width, box.height)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  lines.forEach((l, i) => {
    ctx.font = fontFor(l, fontSize)
    ctx.fillText(l.text, cell.x + cell.w - box.padding, cell.y + box.padding + (i + 0.5) * box.lineHeight)
  })
  ctx.restore()
}

/** Scales down (never up) so the long edge is at most maxSize, keeping the aspect ratio. */
export async function resizeToMax(png: Buffer, maxSize: number): Promise<Buffer> {
  const img = await loadImage(png)
  const long = Math.max(img.width, img.height)
  if (long <= maxSize) return png
  const s = maxSize / long
  const w = Math.max(1, Math.round(img.width * s))
  const h = Math.max(1, Math.round(img.height * s))
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return c.toBuffer('image/png')
}

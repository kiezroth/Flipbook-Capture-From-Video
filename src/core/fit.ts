import type { ExportSettings, Rect } from './types'

/**
 * Where an image of `iw`×`ih` goes in `cell` for a fit mode: `src` is the part of the image drawn (image pixels),
 * `dst` where it lands. Shared by export and the frame viewer so both place the picture identically. null when the
 * image is empty.
 */
export function fitRect(iw: number, ih: number, cell: Rect, fit: ExportSettings['fit']): { src: Rect; dst: Rect } | null {
  if (iw <= 0 || ih <= 0) return null
  const whole = { x: 0, y: 0, w: iw, h: ih }
  if (fit === 'stretch') return { src: whole, dst: { ...cell } }
  if (fit === 'contain') {
    const s = Math.min(cell.w / iw, cell.h / ih)
    const w = iw * s
    const h = ih * s
    return { src: whole, dst: { x: cell.x + (cell.w - w) / 2, y: cell.y + (cell.h - h) / 2, w, h } }
  }
  // cover: crop the source symmetrically to the cell aspect ratio
  const s = Math.max(cell.w / iw, cell.h / ih)
  const sw = cell.w / s
  const sh = cell.h / s
  return { src: { x: (iw - sw) / 2, y: (ih - sh) / 2, w: sw, h: sh }, dst: { ...cell } }
}

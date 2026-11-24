import { useRef, type PointerEvent } from 'react'

import type { Rect } from '@core/types'
import type { Box } from '../player/SelectionLayer'
import { FrameCanvas } from './frameImage'

type Corner = 'nw' | 'ne' | 'sw' | 'se'
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

interface Props {
  image: HTMLImageElement
  /** Where the uncropped image is shown, in CSS pixels of the viewer stage. */
  box: Box
  /** The rectangle being edited (captured-image pixels). */
  rect: Rect
  onRect(r: Rect): void
}

/** The crop to store for an edited rectangle: null when it covers the whole image. */
export function cropFor(r: Rect, image: HTMLImageElement): Rect | null {
  return r.x === 0 && r.y === 0 && r.w === image.naturalWidth && r.h === image.naturalHeight ? null : r
}

/**
 * Crop editor over the uncropped image: drag the 4 corners. Coordinates are captured-image pixels (whole numbers);
 * the opposite corner stays put. The parent owns the rectangle, the buttons and the Enter/Esc keys.
 */
export function CropBox({ image, box, rect, onRect }: Props) {
  const W = image.naturalWidth
  const H = image.naturalHeight
  const layerRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ fixed: { x: number; y: number } } | null>(null)

  const toImage = (e: PointerEvent): { x: number; y: number } => {
    const r = layerRef.current!.getBoundingClientRect()
    const fx = r.width > 0 ? (e.clientX - r.left) / r.width : 0
    const fy = r.height > 0 ? (e.clientY - r.top) / r.height : 0
    return { x: Math.round(Math.max(0, Math.min(1, fx)) * W), y: Math.round(Math.max(0, Math.min(1, fy)) * H) }
  }

  const onHandleDown = (corner: Corner) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const r = rect
    drag.current = { fixed: { x: corner.endsWith('w') ? r.x + r.w : r.x, y: corner.startsWith('n') ? r.y + r.h : r.y } }
  }
  const onHandleMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const p = toImage(e)
    const next = { x: Math.min(p.x, d.fixed.x), y: Math.min(p.y, d.fixed.y), w: Math.abs(p.x - d.fixed.x), h: Math.abs(p.y - d.fixed.y) }
    if (next.w >= 1 && next.h >= 1) onRect(next)
  }
  const onHandleUp = (): void => {
    drag.current = null
  }

  const pct = (v: number, of: number): string => `${(v / of) * 100}%`
  return (
    <div ref={layerRef} className="crop-layer" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      <FrameCanvas image={image} crop={null} className="fill" />
      <div
        className="crop-rect"
        data-testid="crop-rect"
        style={{ left: pct(rect.x, W), top: pct(rect.y, H), width: pct(rect.w, W), height: pct(rect.h, H) }}
      >
        {CORNERS.map((c) => (
          <div
            key={c}
            className={`crop-handle ${c}`}
            data-testid={`crop-handle-${c}`}
            onPointerDown={onHandleDown(c)}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
          />
        ))}
      </div>
      <div className="crop-size">
        {rect.w}×{rect.h}
      </div>
    </div>
  )
}

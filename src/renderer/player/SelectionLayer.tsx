import { useRef, useState, type PointerEvent } from 'react'

import type { Rect, VideoInfo } from '@core/types'
import { useStore } from '../store'

/** The picture's box inside the stage, in CSS pixels. */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

interface Props {
  box: Box
  /** width/height are the rotated (display) size: the selection is in those pixels. */
  info: VideoInfo
  selection: Rect | null
}

/** Shorter drags than this (video pixels) are treated as a click and change nothing. */
const MIN_SIZE = 2

/**
 * Drag on the video to draw the capture region (dashed rectangle); a new drag replaces it. Coordinates are video
 * pixels of the displayed (rotated) picture; on release the rectangle is sent as `setSelection`.
 */
export function SelectionLayer({ box, info, selection }: Props) {
  const layerRef = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<Rect | null>(null)

  const toVideo = (e: PointerEvent): { x: number; y: number } => {
    const r = layerRef.current!.getBoundingClientRect()
    const fx = r.width > 0 ? (e.clientX - r.left) / r.width : 0
    const fy = r.height > 0 ? (e.clientY - r.top) / r.height : 0
    return {
      x: Math.round(Math.max(0, Math.min(1, fx)) * info.width),
      y: Math.round(Math.max(0, Math.min(1, fy)) * info.height)
    }
  }
  const rectFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  })

  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = toVideo(e)
    setDraft(null)
  }
  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (start.current) setDraft(rectFrom(start.current, toVideo(e)))
  }
  const onUp = (e: PointerEvent<HTMLDivElement>): void => {
    const a = start.current
    if (!a) return
    start.current = null
    setDraft(null)
    const rect = rectFrom(a, toVideo(e))
    if (rect.w < MIN_SIZE || rect.h < MIN_SIZE) return
    window.fc.execute({ type: 'setSelection', rect }).catch((err: unknown) => {
      const text = `Không đặt được vùng chọn: ${err instanceof Error ? err.message : String(err)}`
      useStore.getState().showToast({ kind: 'error', text })
    })
  }

  const shown = draft ?? selection
  const pct = (v: number, of: number): string => `${(v / of) * 100}%`
  return (
    <div
      ref={layerRef}
      className="selection-layer"
      data-testid="selection-layer"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        start.current = null
        setDraft(null)
      }}
    >
      {shown && (
        <div
          className="selection-rect"
          data-testid="selection-rect"
          style={{
            left: pct(shown.x, info.width),
            top: pct(shown.y, info.height),
            width: pct(shown.w, info.width),
            height: pct(shown.h, info.height)
          }}
        />
      )}
    </div>
  )
}

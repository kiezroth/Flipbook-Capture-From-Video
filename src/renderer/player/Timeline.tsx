import { useEffect, useRef, type PointerEvent } from 'react'

import { frameMs, snapTimelineMs } from '@core/timing'
import type { FrameRecord } from '@core/types'
import { playback, useStore } from '../store'

interface Props {
  pts: number[]
  durationMs: number
  frames: FrameRecord[]
}

/**
 * Progress bar: click or drag to seek, snapped to 100ms (Alt: to the nearest frame). Red = displayed frame,
 * green = captured frames (click one to select it, no seek), blue = selected frame.
 */
export function Timeline({ pts, durationMs, frames }: Props) {
  const barRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const lastIndex = useRef<number | null>(null)
  const altSeek = useRef(false)
  const displayed = useStore((s) => s.player.displayedIndex)
  const selectedId = useStore((s) => s.selectedFrameId)
  const selectFrame = useStore((s) => s.selectFrame)

  const span = Math.max(1, durationMs)
  const pos = (ms: number): string => `${Math.max(0, Math.min(1, ms / span)) * 100}%`

  const seekAt = (e: PointerEvent): void => {
    const r = barRef.current!.getBoundingClientRect()
    const f = r.width > 0 ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0
    if (e.altKey) altSeek.current = true
    const i = snapTimelineMs(pts, f * span, e.altKey)
    if (i === lastIndex.current) return
    lastIndex.current = i
    playback({ type: 'seekMs', ms: frameMs(pts, i) })
  }

  // Releasing Alt alone opens the menu bar on Windows; after an Alt-drag the release is consumed instead.
  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key !== 'Alt' || !altSeek.current) return
      altSeek.current = false
      e.preventDefault()
    }
    window.addEventListener('keyup', onKeyUp, true)
    return () => window.removeEventListener('keyup', onKeyUp, true)
  }, [])

  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    lastIndex.current = null
    seekAt(e)
  }
  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (dragging.current) seekAt(e)
  }
  const onUp = (): void => {
    dragging.current = false
  }

  const selected = frames.find((f) => f.id === selectedId) ?? null
  return (
    <div
      className="timeline"
      data-testid="timeline"
      ref={barRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div className="timeline-track" />
      {frames.map((f) => (
        <div
          key={f.id}
          className="timeline-mark captured"
          data-testid="timeline-frame"
          title={`${f.ms}ms`}
          style={{ left: pos(f.ms) }}
          onPointerDown={(e) => {
            e.stopPropagation()
            if (e.button === 0) selectFrame(f.id)
          }}
        />
      ))}
      {selected && <div className="timeline-mark selected" data-testid="timeline-selected" style={{ left: pos(selected.ms) }} />}
      <div className="timeline-mark playhead" data-testid="timeline-playhead" style={{ left: pos(frameMs(pts, displayed)) }} />
    </div>
  )
}

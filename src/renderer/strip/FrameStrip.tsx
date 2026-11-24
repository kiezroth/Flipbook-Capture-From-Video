import { useEffect, useMemo, useRef, type MouseEvent } from 'react'

import { numberFrames, type NumberedFrame } from '@core/ordering'
import { useStore } from '../store'
import { FrameCanvas, useFrameImage } from '../viewer/frameImage'

const THUMB_W = 112
const THUMB_H = 72

// Items never take focus: Space, the arrows, T and Delete stay with the app shortcuts.
const keepFocus = (e: MouseEvent): void => e.preventDefault()

/** Captured frames sorted by ms (then capture order) and numbered; click one to show it in the frame viewer. */
export function FrameStrip() {
  const frames = useStore((s) => s.app?.project?.frames)
  const selectedId = useStore((s) => s.selectedFrameId)
  const numbered = useMemo(() => numberFrames(frames ?? []), [frames])
  const listRef = useRef<HTMLDivElement>(null)

  // Bring the selected item into view when the selection changes (a new capture is selected, and main pushes its
  // state before the capture answers, so its item exists by then). Other state pushes leave the user's scroll alone.
  useEffect(() => {
    if (!selectedId) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-frame-id="${CSS.escape(selectedId)}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedId])

  return (
    <div className="strip" ref={listRef} role="listbox" aria-label="Frame đã chụp" aria-orientation="horizontal">
      {numbered.length === 0 ? (
        <div className="strip-empty">Chưa có frame. T: chụp frame đang xem · Ctrl+T: chụp vùng đã chọn.</div>
      ) : (
        numbered.map((f) => <StripItem key={f.id} frame={f} selected={f.id === selectedId} />)
      )}
    </div>
  )
}

function StripItem({ frame, selected }: { frame: NumberedFrame; selected: boolean }) {
  const image = useFrameImage(frame.id)
  return (
    <div
      className={selected ? 'strip-item selected' : 'strip-item'}
      data-testid="strip-item"
      data-frame-id={frame.id}
      role="option"
      aria-selected={selected}
      title={`${frame.displayName} · ${frame.ms}ms`}
      onMouseDown={keepFocus}
      onClick={() => useStore.getState().selectFrame(frame.id)}
    >
      <div className="strip-thumb">
        {image && <FrameCanvas image={image} crop={frame.crop} maxW={THUMB_W * 2} maxH={THUMB_H * 2} className="fill" />}
      </div>
      <div className="strip-caption">
        <b className="strip-index">{frame.index}</b>
        {frame.baseName && <span className="strip-name">{frame.displayName}</span>}
        <span className="strip-ms">{frame.ms}ms</span>
      </div>
    </div>
  )
}

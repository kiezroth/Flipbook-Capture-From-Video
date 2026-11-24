import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'

import { labelLines } from '@core/labels'
import { numberFrames, type NumberedFrame } from '@core/ordering'
import { exportTimes } from '@core/timing'
import { isCompositionEnter } from '../ime'
import { DEFAULT_EXPORT, type ExportSettings, type Rect } from '@core/types'
import { containBox } from '../player/Player'
import type { Box } from '../player/SelectionLayer'
import { playback, useStore } from '../store'
import { CropBox, cropFor } from './CropBox'
import { CellCanvas, useFrameImage } from './frameImage'
import { LabelOverlay } from './LabelOverlay'

// Buttons never take focus: Space, the arrows, T and Delete stay with the app shortcuts.
const keepFocus = (e: MouseEvent): void => e.preventDefault()

function Btn(props: { onClick(): void; children: ReactNode }) {
  return (
    <button type="button" tabIndex={-1} onMouseDown={keepFocus} onClick={props.onClick}>
      {props.children}
    </button>
  )
}

async function run(cmd: Parameters<typeof window.fc.execute>[0]): Promise<void> {
  try {
    const r = await window.fc.execute(cmd)
    if (!r.ok) useStore.getState().showToast({ kind: 'error', text: r.message })
  } catch (e) {
    useStore.getState().showToast({ kind: 'error', text: `Không thực hiện được: ${e instanceof Error ? e.message : String(e)}` })
  }
}

/** The frame viewer (right pane): the selected frame as its export cell (crop, fit, label), and its actions. */
export function FrameViewer() {
  const frames = useStore((s) => s.app?.project?.frames)
  const settings = useStore((s) => s.app?.project?.exportSettings ?? DEFAULT_EXPORT)
  const selectedId = useStore((s) => s.selectedFrameId)
  const numbered = useMemo(() => numberFrames(frames ?? []), [frames])
  const i = numbered.findIndex((f) => f.id === selectedId)

  return (
    <section className="pane viewer-pane" aria-label="Khung xem frame">
      {i < 0 ? (
        <>
          <div className="viewer-stage">
            <div className="empty">{numbered.length > 0 ? 'Chọn một frame ở dải frame để xem.' : 'Chưa có frame. Bấm T để chụp.'}</div>
          </div>
          <div className="viewer-actions" />
        </>
      ) : (
        <ViewerBody key={numbered[i].id} frame={numbered[i]} labelMs={exportTimes(numbered, settings.relativeMs)[i].ms} settings={settings} />
      )}
    </section>
  )
}

type Mode = 'view' | 'crop' | 'rename'

function ViewerBody({ frame, labelMs, settings }: { frame: NumberedFrame; labelMs: number; settings: ExportSettings }) {
  const image = useFrameImage(frame.id)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [mode, setMode] = useState<Mode>('view')
  const [draft, setDraft] = useState<Rect | null>(null) // crop being edited, in crop mode

  const startCrop = (): void => {
    if (!image) return
    setDraft(frame.crop ?? { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight })
    setMode('crop')
  }
  const setCrop = (crop: Rect | null): void => {
    setMode('view')
    void run({ type: 'setCrop', id: frame.id, crop })
  }
  const applyCrop = (): void => {
    if (image && draft) setCrop(cropFor(draft, image))
  }

  // crop mode: Enter applies, Esc cancels (neither is a player key)
  useEffect(() => {
    if (mode !== 'crop') return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault()
        applyCrop()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setMode('view')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    const el = stageRef.current!
    const update = (): void => setStage({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const lines = useMemo(
    () => labelLines({ index: frame.index, baseName: frame.baseName, displayName: frame.displayName, ms: labelMs }, settings),
    [frame.index, frame.baseName, frame.displayName, labelMs, settings]
  )

  let content: ReactNode = null
  if (image && mode === 'crop' && draft) {
    const box = containBox(stage.w, stage.h, image.naturalWidth, image.naturalHeight)
    content = <CropBox image={image} box={box} rect={draft} onRect={setDraft} />
  } else if (image) {
    // a preview of the export cell: same size ratio, picture fitting, black background and label as the export
    const box: Box = containBox(stage.w, stage.h, settings.cellW, settings.cellH)
    content = (
      <div className="viewer-cell" data-testid="viewer-cell" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
        <CellCanvas
          image={image}
          crop={frame.crop}
          cellW={settings.cellW}
          cellH={settings.cellH}
          fit={settings.fit}
          width={box.width}
          height={box.height}
          className="fill"
        />
        <LabelOverlay lines={lines} fontSize={settings.fontSize} cellW={settings.cellW} scale={box.width / settings.cellW} />
      </div>
    )
  }

  return (
    <>
      <div className="viewer-stage" ref={stageRef}>
        {content}
      </div>
      <div className="viewer-actions">
        {mode === 'crop' ? (
          <>
            <span className="viewer-hint">Kéo các góc · Enter: áp dụng · Esc: hủy</span>
            <Btn onClick={applyCrop}>Áp dụng</Btn>
            <Btn onClick={() => setCrop(null)}>Bỏ crop</Btn>
            <Btn onClick={() => setMode('view')}>Hủy</Btn>
          </>
        ) : (
          <>
            <Btn onClick={startCrop}>Crop</Btn>
            {mode === 'rename' ? (
              <RenameField frame={frame} onDone={() => setMode('view')} />
            ) : (
              <Btn onClick={() => setMode('rename')}>Đặt tên</Btn>
            )}
            <Btn onClick={() => playback({ type: 'gotoFrame', id: frame.id })}>Tới ms này</Btn>
            <Btn onClick={() => void run({ type: 'deleteFrame', id: frame.id })}>Xóa</Btn>
          </>
        )}
      </div>
    </>
  )
}

/** Base-name field: Enter saves (empty = back to the number), Esc or moving focus to another element cancels. */
function RenameField({ frame, onDone }: { frame: NumberedFrame; onDone(): void }) {
  const [value, setValue] = useState(frame.baseName ?? '')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current!.focus()
    ref.current!.select()
  }, [])
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (isCompositionEnter(e)) return // confirms an IME composition (Telex), not the name
    if (e.key === 'Enter') {
      e.preventDefault()
      const name = value.trim()
      void run({ type: 'renameFrame', id: frame.id, baseName: name === '' ? null : name })
      onDone()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onDone()
    }
  }
  return (
    <input
      ref={ref}
      className="name-input"
      data-testid="name-input"
      aria-label="Tên gốc"
      placeholder="Tên gốc (để trống = số)"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (document.hasFocus()) onDone() // focus moved within the window; alt-tab keeps the edit
      }}
    />
  )
}

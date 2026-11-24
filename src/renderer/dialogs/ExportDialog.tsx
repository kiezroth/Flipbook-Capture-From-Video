import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'

import { exportWarnings } from '@core/layout'
import { DEFAULT_EXPORT } from '@core/types'
import { isCompositionEnter } from '../ime'
import { useStore } from '../store'
import { aspectLockedHeight, layoutPreview, parseForm, toForm, type FieldKey, type FormValues } from './exportForm'

/** Export Flipbook (spec section 10). Mounted only while open, so every opening starts from the project's saved settings. */
export function ExportDialog() {
  const open = useStore((s) => s.exportOpen)
  return open ? <Form /> : null
}

const dirName = (path: string): string => path.replace(/[\\/][^\\/]*$/, '')

function Form() {
  const app = useStore((s) => s.app)
  const closeExport = useStore((s) => s.closeExport)
  const video = app?.video?.info ?? null
  const frameCount = app?.project?.frames.length ?? 0
  const [form, setForm] = useState<FormValues>(() => toForm(app?.project?.exportSettings ?? DEFAULT_EXPORT, video))
  const [exporting, setExporting] = useState(false)

  const parsed = useMemo(() => parseForm(form), [form])
  const preview = useMemo(() => (parsed.settings ? layoutPreview(frameCount, parsed.settings) : null), [parsed.settings, frameCount])
  const warnings = useMemo(() => (parsed.settings ? exportWarnings(parsed.settings) : []), [parsed.settings])
  const canExport = !exporting && parsed.settings !== null && preview?.ok === true

  const update = (patch: Partial<FormValues>): void => setForm((f) => ({ ...f, ...patch }))
  const setWidth = (cellW: string): void =>
    setForm((f) => {
      const n = Number(cellW.trim())
      const locked = f.keepVideoAspect && video && /^\d+$/.test(cellW.trim()) && n > 0
      return { ...f, cellW, ...(locked ? { cellH: String(aspectLockedHeight(n, video)) } : {}) }
    })
  const setKeepAspect = (keepVideoAspect: boolean): void =>
    setForm((f) => {
      const n = Number(f.cellW.trim())
      const locked = keepVideoAspect && video && /^\d+$/.test(f.cellW.trim()) && n > 0
      return { ...f, keepVideoAspect, ...(locked ? { cellH: String(aspectLockedHeight(n, video)) } : {}) }
    })

  const doExport = async (): Promise<void> => {
    const settings = parsed.settings
    if (!settings || !canExport) return
    setExporting(true)
    try {
      const r = await window.fc.exportFlipbook(settings)
      if (!r.ok) {
        useStore.getState().showToast({ kind: 'error', text: r.message })
        return
      }
      await window.fc.execute({ type: 'setExportSettings', settings })
      closeExport()
      useStore.getState().showToast({ kind: 'info', text: `Đã xuất: ${r.files[0]}` })
    } catch (e) {
      useStore.getState().showToast({ kind: 'error', text: `Không xuất được: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape' || useStore.getState().app?.busy) return
      e.preventDefault()
      closeExport()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeExport])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const t = e.target as HTMLElement
    if (e.key !== 'Enter' || t.tagName !== 'INPUT' || (t as HTMLInputElement).type !== 'text') return
    if (isCompositionEnter(e)) return // confirms an IME composition (Telex), not the dialog
    e.preventDefault()
    void doExport()
  }

  const pickDir = async (): Promise<void> => {
    const dir = await window.fc.pickExportDir(form.outDir.trim() || null)
    if (dir) update({ outDir: dir })
  }

  const text = (key: Extract<FieldKey, 'cellH' | 'columns' | 'gap' | 'maxLongEdge' | 'fontSize'>, label: string, extra: { disabled?: boolean } = {}): ReactNode => (
    <Field label={label} error={parsed.errors[key]}>
      <input type="text" inputMode="numeric" value={form[key]} disabled={extra.disabled} aria-invalid={!!parsed.errors[key]} onChange={(e) => update({ [key]: e.target.value })} />
    </Field>
  )

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Xuất flipbook" data-testid="export-dialog" onKeyDown={onKeyDown}>
        <h2>Xuất flipbook</h2>

        <fieldset>
          <legend>Ô</legend>
          <div className="row">
            <Field label="Rộng (px)" error={parsed.errors.cellW}>
              <input type="text" inputMode="numeric" autoFocus value={form.cellW} aria-invalid={!!parsed.errors.cellW} onChange={(e) => setWidth(e.target.value)} />
            </Field>
            {text('cellH', 'Cao (px)', { disabled: form.keepVideoAspect })}
            <label>
              <input type="checkbox" checked={form.keepVideoAspect} onChange={(e) => setKeepAspect(e.target.checked)} />
              Giữ theo tỉ lệ video
            </label>
          </div>
          <div className="row">
            <label>
              Đặt ảnh trong ô
              <select value={form.fit} onChange={(e) => update({ fit: e.target.value as FormValues['fit'] })}>
                <option value="contain">Vừa khung giữ tỉ lệ</option>
                <option value="cover">Lấp đầy cắt mép</option>
                <option value="stretch">Kéo giãn</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label>
              <input
                type="checkbox"
                checked={form.columnsAuto}
                onChange={(e) => update({ columnsAuto: e.target.checked, ...(!e.target.checked && form.columns === '' && preview?.ok ? { columns: String(preview.cols) } : {}) })}
              />
              Số cột tự động
            </label>
            {text('columns', 'Số cột', { disabled: form.columnsAuto })}
            {text('gap', 'Khoảng cách (px)')}
          </div>
        </fieldset>

        <fieldset>
          <legend>Trang</legend>
          <div className="row">{text('maxLongEdge', 'Cạnh dài tối đa (px)')}</div>
        </fieldset>

        <fieldset>
          <legend>Nhãn và thời gian</legend>
          <div className="row">
            <label>
              <input type="checkbox" checked={form.showIndex} onChange={(e) => update({ showIndex: e.target.checked })} />
              Hiện số
            </label>
            <label>
              <input type="checkbox" checked={form.showName} onChange={(e) => update({ showName: e.target.checked })} />
              Hiện tên
            </label>
            <label>
              <input type="checkbox" checked={form.showMs} onChange={(e) => update({ showMs: e.target.checked })} />
              Hiện ms
            </label>
            {text('fontSize', 'Cỡ chữ')}
          </div>
          <div className="row">
            <label>
              <input type="checkbox" checked={form.relativeMs} onChange={(e) => update({ relativeMs: e.target.checked })} />
              Rút gọn ms (frame đầu = 0)
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Đầu ra</legend>
          <div className="row">
            <Field label="Thư mục" grow>
              <input
                type="text"
                className="wide"
                value={form.outDir}
                placeholder={app?.filePath ? dirName(app.filePath) : 'Documents'}
                onChange={(e) => update({ outDir: e.target.value })}
              />
            </Field>
            <button type="button" onClick={() => void pickDir()}>
              Chọn…
            </button>
          </div>
          <div className="row">
            <Field label="Tên file" error={parsed.errors.fileName} grow>
              <input
                type="text"
                className="wide"
                value={form.fileName}
                placeholder={app?.filePath ? app.projectName : 'flipbook'}
                aria-invalid={!!parsed.errors.fileName}
                onChange={(e) => update({ fileName: e.target.value })}
              />
            </Field>
          </div>
        </fieldset>

        <div className="preview" data-testid="export-preview">
          {preview?.ok ? `${preview.pages} trang · ${preview.cols} cột` : ''}
        </div>
        {preview && !preview.ok && (
          <div className="error" data-testid="export-error" role="alert">
            {preview.message}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="warning" data-testid="export-warning">
            {warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        )}

        <div className="actions">
          <button type="button" onClick={closeExport} disabled={exporting}>
            Hủy
          </button>
          <button type="button" className="active" disabled={!canExport} onClick={() => void doExport()}>
            Xuất
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, error, grow, children }: { label: string; error?: string; grow?: boolean; children: ReactNode }) {
  return (
    <>
      <label style={grow ? { flex: '1 1 auto' } : undefined}>
        {label}
        {children}
      </label>
      {error && <span className="field-error">{error}</span>}
    </>
  )
}

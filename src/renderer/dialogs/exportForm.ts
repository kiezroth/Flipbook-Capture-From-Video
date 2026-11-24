import { computeLayout } from '@core/layout'
import type { ExportSettings, VideoInfo } from '@core/types'

/** Height that keeps the video's own aspect ratio for a cell of the given width (the crop's aspect is never used). */
export function aspectLockedHeight(cellW: number, video: VideoInfo): number {
  return Math.round((cellW * video.height) / video.width)
}

/** Text of every field as typed, so half-typed or empty numbers can exist without ever reaching the layout. */
export interface FormValues {
  cellW: string
  cellH: string
  keepVideoAspect: boolean
  fit: ExportSettings['fit']
  columnsAuto: boolean
  columns: string
  gap: string
  maxLongEdge: string
  showIndex: boolean
  showName: boolean
  showMs: boolean
  fontSize: string
  relativeMs: boolean
  outDir: string
  fileName: string
}

export type NumberField = 'cellW' | 'cellH' | 'columns' | 'gap' | 'maxLongEdge' | 'fontSize'
export type FieldKey = NumberField | 'fileName'
export type FieldErrors = Partial<Record<FieldKey, string>>

export function toForm(s: ExportSettings): FormValues {
  return {
    cellW: String(s.cellW),
    cellH: String(s.cellH),
    keepVideoAspect: s.keepVideoAspect,
    fit: s.fit,
    columnsAuto: s.columns === 'auto',
    columns: s.columns === 'auto' ? '' : String(s.columns),
    gap: String(s.gap),
    maxLongEdge: String(s.maxLongEdge),
    showIndex: s.showIndex,
    showName: s.showName,
    showMs: s.showMs,
    fontSize: String(s.fontSize),
    relativeMs: s.relativeMs,
    outDir: s.outDir ?? '',
    fileName: s.fileName ?? ''
  }
}

const RANGES: Record<NumberField, [min: number, max: number]> = {
  cellW: [1, 16384],
  cellH: [1, 16384],
  columns: [1, 1000],
  gap: [0, 1000],
  maxLongEdge: [1, 16384],
  fontSize: [1, 200]
}

/** Whole number in the field's range, or an error text. */
function int(text: string, key: NumberField): number | string {
  const t = text.trim()
  if (t === '') return 'Chưa nhập số.'
  if (!/^\d+$/.test(t)) return 'Chỉ nhập số nguyên.'
  const n = Number(t)
  const [min, max] = RANGES[key]
  return n < min || n > max ? `Nhập từ ${min} đến ${max}.` : n
}

// eslint-disable-next-line no-control-regex
const BAD_FILE_NAME = /[<>:"/\\|?*\u0000-\u001f]/

export interface ParsedForm {
  /** null while any field is invalid. */
  settings: ExportSettings | null
  errors: FieldErrors
}

export function parseForm(f: FormValues): ParsedForm {
  const errors: FieldErrors = {}
  const num = (key: NumberField, text: string): number => {
    const r = int(text, key)
    if (typeof r === 'string') {
      errors[key] = r
      return 0
    }
    return r
  }
  const cellW = num('cellW', f.cellW)
  const cellH = num('cellH', f.cellH)
  const gap = num('gap', f.gap)
  const maxLongEdge = num('maxLongEdge', f.maxLongEdge)
  const fontSize = num('fontSize', f.fontSize)
  const columns = f.columnsAuto ? ('auto' as const) : num('columns', f.columns)
  const fileName = f.fileName.trim()
  if (BAD_FILE_NAME.test(fileName)) errors.fileName = 'Tên file có ký tự không hợp lệ.'
  if (Object.keys(errors).length > 0) return { settings: null, errors }
  const outDir = f.outDir.trim()
  return {
    settings: {
      cellW,
      cellH,
      keepVideoAspect: f.keepVideoAspect,
      fit: f.fit,
      columns,
      gap,
      maxLongEdge,
      showIndex: f.showIndex,
      showName: f.showName,
      showMs: f.showMs,
      fontSize,
      relativeMs: f.relativeMs,
      outDir: outDir === '' ? null : outDir,
      fileName: fileName === '' ? null : fileName
    },
    errors
  }
}

export type LayoutPreview = { ok: true; pages: number; cols: number } | { ok: false; message: string }

/** The preview line's numbers, or the reason the export is blocked. */
export function layoutPreview(frameCount: number, s: ExportSettings): LayoutPreview {
  const l = computeLayout(frameCount, s)
  if (!('error' in l)) return { ok: true, pages: l.pages.length, cols: l.cols }
  switch (l.error) {
    case 'no-frames':
      return { ok: false, message: 'Chưa có frame nào để xuất.' }
    case 'cell-too-large':
      return { ok: false, message: `Ô lớn hơn cạnh dài tối đa (${s.maxLongEdge}px). Hãy giảm kích thước ô hoặc tăng cạnh dài tối đa.` }
    case 'too-many-columns':
      return { ok: false, message: `Tối đa ${l.maxCols} cột với cỡ ô và cạnh dài tối đa này.` }
  }
}

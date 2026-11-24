import type { ExportSettings } from './types'

export interface LabelLine {
  text: string
  bold: boolean
  /**
   * Set on lines that may be shortened with "…" to fit the cell (the name line); this tail (`-<index>`) is kept.
   * Lines without it (index, ms) are never shortened.
   */
  fitSuffix?: string
}

export const LABEL_PADDING = 4

export function labelLines(
  f: { index: number; baseName: string | null; displayName: string; ms: number },
  s: Pick<ExportSettings, 'showIndex' | 'showName' | 'showMs'>
): LabelLine[] {
  const lines: LabelLine[] = []
  if (s.showIndex) lines.push({ text: String(f.index), bold: true })
  // The name line only adds information when the frame has a custom name.
  if (s.showName && f.baseName) {
    const suffix = `-${f.index}`
    lines.push({ text: f.displayName, bold: false, fitSuffix: f.displayName.endsWith(suffix) ? suffix : '' })
  }
  if (s.showMs) lines.push({ text: `${f.ms}ms`, bold: false })
  return lines
}

/**
 * `text` when it fits in `maxWidth`, else the longest head of it (whole code points) + "…" + `keepSuffix` that fits;
 * "…" alone when not even "…" + `keepSuffix` fits.
 */
export function ellipsizeText(text: string, keepSuffix: string, maxWidth: number, measure: (t: string) => number): string {
  if (measure(text) <= maxWidth) return text
  const head = Array.from(keepSuffix && text.endsWith(keepSuffix) ? text.slice(0, text.length - keepSuffix.length) : text)
  const tail = keepSuffix && text.endsWith(keepSuffix) ? keepSuffix : ''
  const make = (n: number): string => `${head.slice(0, n).join('')}…${tail}`
  if (measure(make(0)) > maxWidth) return '…'
  // largest n with make(n) fitting (width grows with n)
  let lo = 0
  let hi = head.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (measure(make(mid)) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return make(lo)
}

/**
 * Shortens the lines that may be shortened (see LabelLine.fitSuffix) so the label box fits a cell `cellW` wide.
 * Export and the frame viewer both call this, so a long name is cut the same way in both.
 */
export function fitLabelLines(lines: LabelLine[], cellW: number, measure: (l: LabelLine) => number): LabelLine[] {
  const maxText = cellW - 2 * LABEL_PADDING
  return lines.map((l) => {
    if (l.fitSuffix === undefined || measure(l) <= maxText) return l
    return { ...l, text: ellipsizeText(l.text, l.fitSuffix, maxText, (t) => measure({ ...l, text: t })) }
  })
}

export function labelBox(
  lines: LabelLine[],
  fontSize: number,
  measure: (l: LabelLine) => number
): { width: number; height: number; padding: typeof LABEL_PADDING; lineHeight: number } {
  const padding = LABEL_PADDING
  const lineHeight = Math.round(1.25 * fontSize)
  const widest = lines.reduce((m, l) => Math.max(m, measure(l)), 0)
  return { width: widest + 2 * padding, height: lines.length * lineHeight + 2 * padding, padding, lineHeight }
}

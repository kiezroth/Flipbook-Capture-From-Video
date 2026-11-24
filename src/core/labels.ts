import type { ExportSettings } from './types'

export interface LabelLine {
  text: string
  bold: boolean
}

export function labelLines(
  f: { index: number; baseName: string | null; displayName: string; ms: number },
  s: Pick<ExportSettings, 'showIndex' | 'showName' | 'showMs'>
): LabelLine[] {
  const lines: LabelLine[] = []
  if (s.showIndex) lines.push({ text: String(f.index), bold: true })
  // The name line only adds information when the frame has a custom name.
  if (s.showName && f.baseName) lines.push({ text: f.displayName, bold: false })
  if (s.showMs) lines.push({ text: `${f.ms}ms`, bold: false })
  return lines
}

export function labelBox(
  lines: LabelLine[],
  fontSize: number,
  measure: (l: LabelLine) => number
): { width: number; height: number; padding: 4; lineHeight: number } {
  const padding = 4
  const lineHeight = Math.round(1.25 * fontSize)
  const widest = lines.reduce((m, l) => Math.max(m, measure(l)), 0)
  return { width: widest + 2 * padding, height: lines.length * lineHeight + 2 * padding, padding, lineHeight }
}

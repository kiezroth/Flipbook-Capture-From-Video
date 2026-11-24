import type { ExportSettings } from './types'

export interface PageLayout {
  index: number
  width: number
  height: number
  rows: number
  first: number
  count: number
}
export interface Layout {
  cols: number
  rowsPerPage: number
  pages: PageLayout[]
}
export type LayoutError =
  | { error: 'no-frames' }
  | { error: 'cell-too-large' }
  | { error: 'too-many-columns'; maxCols: number }

type LayoutSettings = Pick<ExportSettings, 'cellW' | 'cellH' | 'gap' | 'maxLongEdge' | 'columns'>

const span = (count: number, size: number, gap: number): number => count * size + (count - 1) * gap

export function computeLayout(n: number, s: LayoutSettings): Layout | LayoutError {
  if (n <= 0) return { error: 'no-frames' }
  const maxCols = Math.floor((s.maxLongEdge + s.gap) / (s.cellW + s.gap))
  const maxRows = Math.floor((s.maxLongEdge + s.gap) / (s.cellH + s.gap))
  if (maxCols < 1 || maxRows < 1) return { error: 'cell-too-large' }

  let cols: number
  if (s.columns !== 'auto') {
    if (s.columns > maxCols) return { error: 'too-many-columns', maxCols }
    cols = s.columns
  } else if (n <= maxCols * maxRows) {
    cols = 1
    let best = Infinity
    for (let c = 1; c <= Math.min(n, maxCols); c++) {
      const rows = Math.ceil(n / c)
      if (rows > maxRows) continue
      const diff = Math.abs(span(c, s.cellW, s.gap) - span(rows, s.cellH, s.gap))
      if (diff <= best) {
        best = diff
        cols = c
      }
    }
  } else {
    cols = maxCols
  }

  const rowsPerPage = Math.min(maxRows, Math.ceil(n / cols))
  const perPage = cols * rowsPerPage
  const pages: PageLayout[] = []
  for (let first = 0; first < n; first += perPage) {
    const count = Math.min(perPage, n - first)
    const rows = Math.ceil(count / cols)
    pages.push({
      index: pages.length + 1,
      width: span(cols, s.cellW, s.gap),
      height: span(rows, s.cellH, s.gap),
      rows,
      first,
      count
    })
  }
  return { cols, rowsPerPage, pages }
}

/** i is 0-based, page is 1-based. */
export function cellPosition(
  l: Layout,
  s: Pick<ExportSettings, 'cellW' | 'cellH' | 'gap'>,
  i: number
): { page: number; row: number; col: number; x: number; y: number } {
  const perPage = l.cols * l.rowsPerPage
  const within = i % perPage
  const row = Math.floor(within / l.cols)
  const col = within % l.cols
  return {
    page: Math.floor(i / perPage) + 1,
    row,
    col,
    x: col * (s.cellW + s.gap),
    y: row * (s.cellH + s.gap)
  }
}

export function exportWarnings(s: ExportSettings): string[] {
  const out: string[] = []
  if (s.fontSize < 12) {
    out.push(`Cỡ chữ ${s.fontSize}px nhỏ hơn 12px, Claude có thể không đọc rõ nhãn.`)
  }
  const side = Math.min(s.cellW, s.cellH)
  if (side < 128) {
    out.push(`Cạnh ô ${side}px nhỏ hơn 128px, Claude có thể không đọc rõ hình.`)
  }
  return out
}

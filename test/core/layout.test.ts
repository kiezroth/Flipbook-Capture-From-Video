import { describe, expect, test } from 'vitest'
import { DEFAULT_EXPORT } from '../../src/core/types'
import { cellPosition, computeLayout, exportWarnings, type Layout } from '../../src/core/layout'

const s = { cellW: 256, cellH: 256, gap: 4, maxLongEdge: 1568, columns: 'auto' as const }

describe('layout', () => {
  test('10 frames fit one page, wider wins tie', () => {
    const l = computeLayout(10, s) as Layout
    expect([l.cols, l.rowsPerPage, l.pages.length]).toEqual([4, 3, 1])
    expect([l.pages[0].width, l.pages[0].height]).toEqual([1036, 776])
  })
  test('40 frames split into pages, never shrinks cells', () => {
    const l = computeLayout(40, s) as Layout
    expect(l.cols).toBe(6)
    expect(l.pages.map((p) => [p.width, p.height, p.count])).toEqual([
      [1556, 1556, 36],
      [1556, 256, 4]
    ])
    expect(cellPosition(l, s, 36)).toMatchObject({ page: 2, row: 0, col: 0, x: 0, y: 0 })
    expect(cellPosition(l, s, 7)).toMatchObject({ page: 1, row: 1, col: 1, x: 260, y: 260 })
  })
  test('manual columns', () => {
    const l = computeLayout(10, { ...s, columns: 2 }) as Layout
    expect([l.pages[0].width, l.pages[0].height]).toEqual([516, 1296])
    expect(computeLayout(10, { ...s, columns: 7 })).toEqual({ error: 'too-many-columns', maxCols: 6 })
  })
  test('errors', () => {
    expect(computeLayout(0, s)).toEqual({ error: 'no-frames' })
    expect(computeLayout(3, { ...s, cellW: 1600, cellH: 200 })).toEqual({ error: 'cell-too-large' })
  })
  test('warnings', () => {
    expect(exportWarnings({ ...DEFAULT_EXPORT })).toEqual([])
    expect(exportWarnings({ ...DEFAULT_EXPORT, fontSize: 11 })).toHaveLength(1)
    expect(exportWarnings({ ...DEFAULT_EXPORT, cellW: 127 })[0]).toContain('Claude có thể không đọc rõ')
  })
})

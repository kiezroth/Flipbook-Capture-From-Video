import { describe, expect, test } from 'vitest'

import { displayName, numberFrames, sortFrames } from '@core/ordering'
import { DEFAULT_EXPORT, type FrameRecord } from '@core/types'

const f = (id: string, ptsSec: number, seq: number, baseName: string | null = null): FrameRecord => ({
  id,
  ptsSec,
  ms: Math.round(ptsSec * 1000),
  seq,
  baseName,
  region: null,
  crop: null
})

describe('ordering', () => {
  test('sorts by pts then capture order', () => {
    const out = numberFrames([f('c', 0.5, 3), f('a', 0.5, 1), f('b', 0.1, 2)])
    expect(out.map((x) => [x.id, x.index])).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 3]
    ])
  })

  test('inserting a frame renumbers later frames', () => {
    const out = numberFrames([f('a', 0, 1), f('b', 1, 2), f('n', 0.5, 3)])
    expect(out.map((x) => x.id)).toEqual(['a', 'n', 'b'])
    expect(out[2].index).toBe(3)
  })

  test('sortFrames does not mutate its input', () => {
    const input = [f('b', 1, 2), f('a', 0, 1)]
    const out = sortFrames(input)
    expect(out.map((x) => x.id)).toEqual(['a', 'b'])
    expect(input.map((x) => x.id)).toEqual(['b', 'a'])
  })

  test('numberFrames sets displayName from baseName and index', () => {
    const out = numberFrames([f('a', 0, 1, 'slash'), f('b', 1, 2)])
    expect(out.map((x) => x.displayName)).toEqual(['slash-1', '2'])
  })

  test('display name', () => {
    expect(displayName(null, 4)).toBe('4')
    expect(displayName('slash', 4)).toBe('slash-4')
    expect(displayName('', 4)).toBe('4')
  })
})

describe('DEFAULT_EXPORT', () => {
  test('pins the default export settings', () => {
    expect(DEFAULT_EXPORT).toEqual({
      cellW: 256,
      cellH: 256,
      keepVideoAspect: false,
      fit: 'contain',
      columns: 'auto',
      gap: 4,
      maxLongEdge: 1568,
      showIndex: true,
      showName: true,
      showMs: true,
      fontSize: 14,
      relativeMs: true,
      outDir: null,
      fileName: null
    })
  })
})

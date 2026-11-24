import { expect, test } from 'vitest'
import { DEFAULT_EXPORT, type FrameRecord, type VideoInfo } from '../../src/core/types'
import { numberFrames } from '../../src/core/ordering'
import { computeLayout, type Layout } from '../../src/core/layout'
import { buildExportLog, formatLogTxt } from '../../src/core/exportLog'

const s = { cellW: 256, cellH: 256, gap: 4, maxLongEdge: 1568, columns: 'auto' as const }
const fr = (id: string, ptsSec: number, ms: number, seq: number): FrameRecord => ({
  id, ptsSec, ms, seq, baseName: null, region: null, crop: null
})
const video: VideoInfo = {
  fileName: 'clip.mp4', codec: 'h264', width: 640, height: 360, rotation: 0, fps: 30,
  isVfr: false, durationMs: 5000, frameCount: 150, startTimeSec: 0
}
const build = (settings = DEFAULT_EXPORT, v = video) => {
  const frames = numberFrames([fr('a', 2.0, 2000, 1), fr('b', 2.42, 2420, 2), fr('c', 2.42, 2420, 3)])
  const layout = computeLayout(3, s) as Layout
  return buildExportLog({ projectName: 'clip', video: v, frames, layout, settings, pageFiles: ['clip_p1.png'] })
}

test('log json and txt', () => {
  const log = build()
  expect(log.totalMs).toBe(420)
  expect([log.firstSourceMs, log.lastSourceMs]).toEqual([2000, 2420])
  expect(log.frames[1]).toEqual({ index: 2, name: '2', ms: 420, deltaMs: 420, sourceMs: 2420, page: 1, row: 0, col: 1 })
  const txt = formatLogTxt(log)
  expect(txt).toMatch(/^# \| Name \| ms \| \+Δms \| Source ms \| Page$/m)
  expect(txt).toContain('1 | 1 | 0 | — | 2000 | 1')
  expect(txt).toContain('3 | 3 | 420 | +0 | 2420 | 1')
  expect(txt).toContain('Total: 420ms (source 2000 → 2420)')
})

test('log header lines and metadata', () => {
  const log = build()
  expect(log.cell).toEqual({ width: 256, height: 256, fit: 'contain', gap: 4, cols: 2 })
  expect(log.pages).toEqual([{ file: 'clip_p1.png', width: 516, height: 516 }])
  expect(log.timeMode).toBe('relative')
  const head = formatLogTxt(log).split('\n\n')[0].split('\n')
  expect(head).toEqual([
    'Video: clip.mp4',
    'FPS: 30',
    'Size: 640×360',
    'Frames: 3',
    'Pages: 1',
    'Cell: 256×256, contain, gap 4, 2 cols',
    'Time mode: relative (first frame = 0)',
    'Total: 420ms (source 2000 → 2420)'
  ])
})

test('source mode and VFR', () => {
  const log = build({ ...DEFAULT_EXPORT, relativeMs: false }, { ...video, isVfr: true })
  expect(log.timeMode).toBe('source')
  expect(log.frames[0].ms).toBe(2000)
  const txt = formatLogTxt(log)
  expect(txt).toContain('FPS: 30 (VFR)')
  expect(txt).toContain('Time mode: source')
})

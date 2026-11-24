import { afterEach, beforeEach, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createCanvas, loadImage, type Image } from '@napi-rs/canvas'
import { exportFlipbook, type ExportRequest } from '../../src/core/export'
import type { ExportLog } from '../../src/core/exportLog'
import { DEFAULT_EXPORT, type FrameRecord, type VideoInfo } from '../../src/core/types'

const png = (i: number): Buffer => {
  const c = createCanvas(640, 360)
  const ctx = c.getContext('2d')
  ctx.fillStyle = `rgb(${20 + (i % 10) * 10}, 40, 60)`
  ctx.fillRect(0, 0, 640, 360)
  return c.toBuffer('image/png')
}
const mk = (n: number, stepMs: number): FrameRecord[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `f${i}`, ptsSec: (i * stepMs) / 1000, ms: i * stepMs, seq: i + 1, baseName: null, region: null, crop: null
  }))
const tenFramesFromCfr30 = mk(10, 33)
const fortyThreeFrames = mk(43, 33)
const video: VideoInfo = {
  fileName: 'clip.mp4', codec: 'h264', width: 640, height: 360, rotation: 0, fps: 30,
  isVfr: false, durationMs: 5000, frameCount: 150, startTimeSec: 0
}

const maxLuma = (img: Image, r: { x: number; y: number; w: number; h: number }): number => {
  const c = createCanvas(img.width, img.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(r.x, r.y, r.w, r.h).data
  let m = 0
  for (let i = 0; i < d.length; i += 4) m = Math.max(m, 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
  return m
}

let req: ExportRequest
beforeEach(() => {
  req = {
    projectName: 'clip', video, frames: tenFramesFromCfr30,
    readFrame: async (id) => png(Number(id.slice(1))),
    settings: { ...DEFAULT_EXPORT }, outDir: mkdtempSync(join(tmpdir(), 'fc-export-')), fileName: 'slash'
  }
})
afterEach(() => rmSync(req.outDir, { recursive: true, force: true }))

test('export writes pages, logs and labels', async () => {
  const r = await exportFlipbook({ ...req, frames: tenFramesFromCfr30, fileName: 'slash' })
  expect(r.pages.map((p) => basename(p))).toEqual(['slash_p1.png'])
  const page = await loadImage(r.pages[0])
  expect([page.width, page.height]).toEqual([1036, 776])
  const log = JSON.parse(readFileSync(r.logJson, 'utf8')) as ExportLog
  expect(log.frames).toHaveLength(10)
  expect(log.frames[0]).toMatchObject({ ms: 0, deltaMs: null, page: 1, row: 0, col: 0 })
  expect(log.pages[0].file).toBe('slash_p1.png')
  expect(readFileSync(r.logTxt, 'utf8')).toContain('Frames: 10')
  expect(readdirSync(req.outDir).sort()).toEqual(['slash_log.json', 'slash_log.txt', 'slash_p1.png'])
  // label: top-right of the first cell has white pixels, top-left has none
  expect(maxLuma(page, { x: 256 - 30, y: 2, w: 28, h: 20 })).toBeGreaterThan(200)
  expect(maxLuma(page, { x: 2, y: 2, w: 28, h: 20 })).toBeLessThan(100)
})

test('43 frames → two pages (36 + 7), cells keep size', async () => {
  const r = await exportFlipbook({ ...req, frames: fortyThreeFrames })
  expect(r.pages).toHaveLength(2)
  expect((await loadImage(r.pages[1])).height).toBe(516)
})

test('cell larger than max edge → error, nothing written', async () => {
  const p = exportFlipbook({ ...req, settings: { ...DEFAULT_EXPORT, cellW: 1600 } })
  await expect(p).rejects.toThrow(/cell-too-large/)
  await expect(p).rejects.toMatchObject({ layoutError: { error: 'cell-too-large' } })
  expect(readdirSync(req.outDir)).toEqual([])
})

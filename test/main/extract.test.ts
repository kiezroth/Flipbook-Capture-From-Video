import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadImage } from '@napi-rs/canvas'
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { VideoSource } from '../../src/core/fbproj'
import { extractFrame, FrameMismatchError } from '../../src/main/ffmpeg/extract'
import { probeVideo, readPtsTable } from '../../src/main/ffmpeg/probe'
import { decodeIndex } from '../helpers/decodeIndex'
import { FIXTURES } from '../helpers/fixtures'

const dir = mkdtempSync(join(tmpdir(), 'fc-extract-'))
let n = 0
const tmpPng = (): string => join(dir, `out-${n++}.png`)

const cfrSrc: VideoSource = { kind: 'file', path: FIXTURES.cfr30 }
const rotSrc: VideoSource = { kind: 'file', path: FIXTURES.rotated }
let cfrPts: number[] = []
let rotPts: number[] = []

beforeAll(async () => {
  cfrPts = await readPtsTable(cfrSrc)
  rotPts = await readPtsTable(rotSrc)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test.each(['cfr30', 'offset_bframes', 'vfr'] as const)('%s: every 7th frame decodes to its index', async (name) => {
  const src: VideoSource = { kind: 'file', path: FIXTURES[name] }
  const pts = await readPtsTable(src)
  const info = await probeVideo(src)
  for (let i = 0; i < pts.length; i += 7) {
    const out = tmpPng()
    await extractFrame(src, pts[i], info.startTimeSec, null, out)
    expect(await decodeIndex(readFileSync(out))).toBe(i)
  }
}, 120_000)

test('region crops the full-resolution frame', async () => {
  // left half, containing bit cells 0..3
  const out = tmpPng()
  await extractFrame(cfrSrc, cfrPts[5], 0, { x: 0, y: 0, w: 320, h: 180 }, out)
  const img = await loadImage(out)
  expect([img.width, img.height]).toEqual([320, 180])
})

test('rotated video is captured upright', async () => {
  const out = tmpPng()
  await extractFrame(rotSrc, rotPts[10], 0, null, out)
  const img = await loadImage(out)
  expect([img.width, img.height]).toEqual([360, 640])
  expect(await decodeIndex(readFileSync(out), 90)).toBe(10)
})

test('pts not in video → mismatch, no file left', async () => {
  const out = tmpPng()
  await expect(extractFrame(cfrSrc, 99, 0, null, out)).rejects.toBeInstanceOf(FrameMismatchError)
  expect(existsSync(out)).toBe(false)
})

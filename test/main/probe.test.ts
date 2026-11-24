import { execFileSync } from 'node:child_process'

import { describe, expect, test } from 'vitest'

import { ffmpegInput } from '../../src/core/fbproj'
import { frameMs } from '../../src/core/timing'
import { ffmpegPaths } from '../../src/main/ffmpeg/paths'
import { needsProxy, parsePtsTable, probeVideo, readPtsTable } from '../../src/main/ffmpeg/probe'
import { decodeIndex } from '../helpers/decodeIndex'
import { FIXTURES } from '../helpers/fixtures'

describe('probe', () => {
  test('probe cfr', async () => {
    const v = await probeVideo({ kind: 'file', path: FIXTURES.cfr30 })
    expect(v).toMatchObject({ fileName: 'cfr30.mp4', codec: 'h264', width: 640, height: 360, rotation: 0, fps: 30, isVfr: false, frameCount: 90 })
    expect(v.durationMs).toBeGreaterThanOrEqual(2990)
  })
  test('pts table: offset start and b-frames are sorted', async () => {
    const pts = await readPtsTable({ kind: 'file', path: FIXTURES.offset_bframes })
    expect(pts).toHaveLength(90)
    expect(pts[0]).toBeCloseTo(1.5, 6)
    expect(frameMs(pts, 36)).toBe(1200)
  })
  test('vfr detected', async () => {
    const v = await probeVideo({ kind: 'file', path: FIXTURES.vfr })
    expect(v.isVfr).toBe(true)
    const pts = await readPtsTable({ kind: 'file', path: FIXTURES.vfr })
    expect(frameMs(pts, 3)).toBe(3 * 33 + 3 * 7)
  })
  test('trimmed (edit list): discard packets are not frames', async () => {
    const src = { kind: 'file', path: FIXTURES.trimmed } as const
    // frames the decoder actually outputs
    const decodable = execFileSync(
      ffmpegPaths().ffprobe,
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', FIXTURES.trimmed],
      { encoding: 'utf8' }
    )
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((l) => Number(l.replace(/,+$/, '')))
    const pts = await readPtsTable(src)
    expect(pts.every((p) => p >= 0)).toBe(true)
    expect(pts[0]).toBe(decodable[0])
    expect(frameMs(pts, 0)).toBe(0)
    expect(pts[0]).toBeCloseTo(0, 6)
    expect(pts).toHaveLength(decodable.length)
    const v = await probeVideo(src)
    expect(v.frameCount).toBe(decodable.length)
    expect(v.isVfr).toBe(false)
  })
  test('pts table parser drops discard packets, N/A and duplicates', () => {
    const out = ['-0.066667,KD_', '-0.033333,_D_', '0.033333,___', '0.000000,K__', 'N/A,___', '0.033333,___', ''].join('\r\n')
    expect(parsePtsTable(out)).toEqual([0, 0.033333])
  })
  test('rotated video reports display size', async () => {
    expect(await probeVideo({ kind: 'file', path: FIXTURES.rotated })).toMatchObject({ width: 360, height: 640, rotation: 90 })
  })
  test('proxy decision', async () => {
    expect(needsProxy(await probeVideo({ kind: 'file', path: FIXTURES.hevc }))).toBe(true)
    expect(needsProxy(await probeVideo({ kind: 'file', path: FIXTURES.cfr30 }))).toBe(false)
  })
  test('unreadable file gives a clear error', async () => {
    await expect(probeVideo({ kind: 'file', path: __filename })).rejects.toThrow(/không phải video|no video stream/i)
  })
  test('ffmpegInput for file and zip entry', () => {
    const winPath = String.raw`C:\a b\v.mp4`
    expect(ffmpegInput({ kind: 'file', path: winPath })).toBe(winPath)
    const zipPath = String.raw`D:\Video hiệu ứng\dự án.fbproj`
    expect(ffmpegInput({ kind: 'zipEntry', zipPath, start: 100, end: 900, fileName: 'v.mp4' })).toBe(
      String.raw`subfile,,start,100,end,900,,:D:\Video hiệu ứng\dự án.fbproj`
    )
  })
})

describe('decodeIndex', () => {
  const frame = (file: string, n: number): Buffer =>
    execFileSync(ffmpegPaths().ffmpeg, ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'], {
      maxBuffer: 64 * 1024 * 1024
    })
  test('decodes the index of a plain frame', async () => {
    expect(await decodeIndex(frame(FIXTURES.cfr30, 37))).toBe(37)
  })
  test('decodes the index of an autorotated frame', async () => {
    expect(await decodeIndex(frame(FIXTURES.rotated, 37), 90)).toBe(37)
  })
})

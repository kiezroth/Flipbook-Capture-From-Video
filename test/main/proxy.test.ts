import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, expect, test } from 'vitest'

import type { VideoSource } from '../../src/core/fbproj'
import { probeVideo, readPtsTable } from '../../src/main/ffmpeg/probe'
import { makeProxy, proxyCachePath, proxyKeyForFile, proxyKeyForZipEntry } from '../../src/main/ffmpeg/proxy'
import { FIXTURES } from '../helpers/fixtures'

const root = mkdtempSync(join(tmpdir(), 'fc-proxy-'))
let n = 0
const freshDir = (): string => {
  const d = join(root, `t${n++}`)
  mkdirSync(d)
  return d
}
afterAll(() => rmSync(root, { recursive: true, force: true }))

const hevcSrc: VideoSource = { kind: 'file', path: FIXTURES.hevc }

test('proxy keeps source PTS', async () => {
  for (const name of ['hevc', 'vfr'] as const) {
    const src: VideoSource = { kind: 'file', path: FIXTURES[name] }
    const out = join(freshDir(), 'p.mp4')
    await makeProxy(src, out, { durationMs: 3000 })
    const a = await readPtsTable(src)
    const b = await readPtsTable({ kind: 'file', path: out })
    expect(b.length).toBe(a.length)
    b.forEach((t, i) => expect(t).toBeCloseTo(a[i], 3))
    expect((await probeVideo({ kind: 'file', path: out })).codec).toBe('h264')
  }
}, 120_000)

test('progress reported and reaches 1', async () => {
  const d = freshDir()
  const out = join(d, 'p.mp4')
  const seen: number[] = []
  await makeProxy(hevcSrc, out, { durationMs: 3000, onProgress: (f) => seen.push(f) })
  expect(seen.length).toBeGreaterThan(0)
  seen.forEach((v, i) => {
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(1)
    if (i > 0) expect(v).toBeGreaterThanOrEqual(seen[i - 1])
  })
  expect(seen[seen.length - 1]).toBeGreaterThanOrEqual(0.99)
  expect(readdirSync(d)).toEqual(['p.mp4'])
}, 60_000)

test('cancel removes partial file', async () => {
  const d = freshDir()
  const out = join(d, 'p.mp4')
  const ac = new AbortController()
  const p = makeProxy(hevcSrc, out, { durationMs: 3000, signal: ac.signal, onProgress: () => ac.abort() })
  await expect(p).rejects.toThrow(/abort/i)
  await p.catch((e: Error) => expect(e.name).toBe('AbortError'))
  expect(readdirSync(d)).toEqual([])
}, 60_000)

test('already-aborted signal rejects without writing', async () => {
  const d = freshDir()
  const ac = new AbortController()
  ac.abort()
  await expect(makeProxy(hevcSrc, join(d, 'p.mp4'), { durationMs: 3000, signal: ac.signal })).rejects.toThrow(/abort/i)
  expect(readdirSync(d)).toEqual([])
})

test('failure leaves nothing behind', async () => {
  const d = freshDir()
  const bad: VideoSource = { kind: 'file', path: join(d, 'missing.mkv') }
  await expect(makeProxy(bad, join(d, 'p.mp4'), { durationMs: 1000 })).rejects.toThrow()
  expect(readdirSync(d)).toEqual([])
}, 30_000)

test('proxyCachePath joins key with .mp4', () => {
  expect(proxyCachePath(join('a', 'b'), 'k1')).toBe(join('a', 'b', 'k1.mp4'))
})

test('file key is stable and changes with size/mtime', async () => {
  const d = freshDir()
  const f = join(d, 'v.bin')
  writeFileSync(f, 'abc')
  utimesSync(f, 1000, 1000)
  const k1 = await proxyKeyForFile(f)
  expect(await proxyKeyForFile(f)).toBe(k1)
  expect(k1).toMatch(/^[0-9a-f]{40}$/)
  utimesSync(f, 2000, 2000)
  const k2 = await proxyKeyForFile(f)
  expect(k2).not.toBe(k1)
  writeFileSync(f, 'abcd')
  utimesSync(f, 2000, 2000)
  expect(await proxyKeyForFile(f)).not.toBe(k2)
})

test('zip entry key is stable and changes with offsets/mtime', async () => {
  const d = freshDir()
  const z = join(d, 'p.fbproj')
  writeFileSync(z, 'zipdata')
  utimesSync(z, 1000, 1000)
  const src = { kind: 'zipEntry', zipPath: z, start: 10, end: 20, fileName: 'a.mkv' } as const
  const k1 = await proxyKeyForZipEntry(src)
  expect(await proxyKeyForZipEntry(src)).toBe(k1)
  expect(await proxyKeyForZipEntry({ ...src, end: 21 })).not.toBe(k1)
  expect(await proxyKeyForZipEntry({ ...src, start: 11 })).not.toBe(k1)
  utimesSync(z, 2000, 2000)
  expect(await proxyKeyForZipEntry(src)).not.toBe(k1)
})

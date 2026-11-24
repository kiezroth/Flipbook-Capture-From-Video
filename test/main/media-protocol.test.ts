import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'

import { afterAll, beforeAll, expect, test } from 'vitest'

import { openFbproj, writeFbproj, type VideoSource } from '../../src/core/fbproj'
import { DEFAULT_EXPORT, type ProjectFile } from '../../src/core/types'
import { closeVideoStreams, contentTypeFor, parseRange, serveFrame, serveVideo } from '../../src/main/media-protocol'
import { FIXTURES } from '../helpers/fixtures'

const root = mkdtempSync(join(tmpdir(), 'fc-media-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

async function readAll(s: Readable | null): Promise<Buffer> {
  if (!s) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  for await (const c of s) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

const fixture = readFileSync(FIXTURES.cfr30)
let zipSource: VideoSource

beforeAll(async () => {
  const project: ProjectFile = {
    formatVersion: 1,
    video: null,
    frames: [],
    nextSeq: 1,
    selection: null,
    exportSettings: { ...DEFAULT_EXPORT }
  }
  const framesDir = join(root, 'frames')
  mkdirSync(framesDir)
  const zip = join(root, 'dự án.fbproj')
  await writeFbproj(zip, { project, video: { kind: 'file', path: FIXTURES.cfr30 }, framesDir })
  const r = await openFbproj(zip)
  zipSource = r.video
  await r.close()
})

test('parseRange', () => {
  expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
  expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 })
  expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
  expect(parseRange('bytes=1000-', 1000)).toBe('invalid')
  expect(parseRange(null, 1000)).toBeNull()
})

test('parseRange edge cases', () => {
  expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 }) // end clamped
  expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 })
  expect(parseRange('bytes=10-5', 1000)).toBe('invalid')
  expect(parseRange('bytes=-0', 1000)).toBe('invalid')
  expect(parseRange('items=0-1', 1000)).toBe('invalid')
  expect(parseRange('bytes=0-', 0)).toBe('invalid')
  expect(parseRange('', 1000)).toBeNull()
})

test('content type by extension', () => {
  expect(contentTypeFor('a.MP4')).toBe('video/mp4')
  expect(contentTypeFor('a.webm')).toBe('video/webm')
  expect(contentTypeFor('a.mkv')).toBe('video/x-matroska')
  expect(contentTypeFor('a.mov')).toBe('video/quicktime')
  expect(contentTypeFor('a.bin')).toBe('application/octet-stream')
})

for (const kind of ['file', 'zipEntry'] as const) {
  const src = (): VideoSource => (kind === 'file' ? { kind: 'file', path: FIXTURES.cfr30 } : zipSource)

  test(`${kind}: no Range serves the whole video with 200`, async () => {
    const r = await serveVideo(src(), null)
    expect(r.status).toBe(200)
    expect(r.headers['Accept-Ranges']).toBe('bytes')
    expect(r.headers['Content-Type']).toBe('video/mp4')
    expect(r.headers['Content-Length']).toBe(String(fixture.length))
    expect((await readAll(r.body)).equals(fixture)).toBe(true)
  })

  test(`${kind}: Range serves exact bytes with 206`, async () => {
    const r = await serveVideo(src(), 'bytes=100-1099')
    expect(r.status).toBe(206)
    expect(r.headers['Content-Range']).toBe(`bytes 100-1099/${fixture.length}`)
    expect(r.headers['Content-Length']).toBe('1000')
    expect(r.headers['Accept-Ranges']).toBe('bytes')
    expect((await readAll(r.body)).equals(fixture.subarray(100, 1100))).toBe(true)

    const tail = await serveVideo(src(), 'bytes=-10')
    expect(tail.status).toBe(206)
    expect((await readAll(tail.body)).equals(fixture.subarray(fixture.length - 10))).toBe(true)
  })

  test(`${kind}: unsatisfiable Range gives 416`, async () => {
    const r = await serveVideo(src(), `bytes=${fixture.length}-`)
    expect(r.status).toBe(416)
    expect(r.headers['Content-Range']).toBe(`bytes */${fixture.length}`)
    expect(r.body).toBeNull()
  })
}

test('closeVideoStreams destroys streams still being read', async () => {
  const r = await serveVideo(zipSource, null)
  const body = r.body as Readable
  body.on('error', () => undefined)
  body.pause()
  await closeVideoStreams()
  expect(body.destroyed).toBe(true)
})

test('serveFrame serves PNGs from the frames dir and rejects bad ids', async () => {
  const dir = join(root, 'wf')
  mkdirSync(dir)
  writeFileSync(join(dir, 'ab-12.png'), Buffer.from([1, 2, 3]))
  const ok = await serveFrame(dir, '/ab-12.png')
  expect(ok.status).toBe(200)
  expect(ok.headers['Content-Type']).toBe('image/png')
  expect(Buffer.from(ok.body as Buffer).equals(Buffer.from([1, 2, 3]))).toBe(true)
  expect((await serveFrame(dir, '/missing.png')).status).toBe(404)
  expect((await serveFrame(dir, '/..%2Fsecret.png')).status).toBe(404)
  expect((await serveFrame(null, '/ab-12.png')).status).toBe(404)
})

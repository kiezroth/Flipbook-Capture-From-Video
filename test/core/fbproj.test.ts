import * as fs from 'node:fs'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'

import { createCanvas } from '@napi-rs/canvas'
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import yauzl from 'yauzl'
import yazl from 'yazl'

import { DiskFullError, InvalidProjectError, openFbproj, writeFbproj } from '../../src/core/fbproj'
import { DEFAULT_EXPORT, type ProjectFile } from '../../src/core/types'
import { extractFrame } from '../../src/main/ffmpeg/extract'
import { readPtsTable } from '../../src/main/ffmpeg/probe'
import { decodeIndex } from '../helpers/decodeIndex'
import { FIXTURES } from '../helpers/fixtures'

const tmp = mkdtempSync(join(tmpdir(), 'fc-fbproj-'))
const framesDir = join(tmp, 'frames-src')
let n = 0
const tmpPng = (): string => join(tmp, `out-${n++}.png`)
const nextTarget = (): string => join(tmp, `p${n++}.fbproj`)

async function streamToBuffer(s: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of s) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

function pngBytes(color: string): Buffer {
  const c = createCanvas(16, 12)
  const ctx = c.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 16, 12)
  return c.toBuffer('image/png')
}

function writeZip(file: string, add: (z: yazl.ZipFile) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const z = new yazl.ZipFile()
    add(z)
    z.end()
    z.outputStream.pipe(fs.createWriteStream(file)).on('finish', resolve).on('error', reject)
  })
}

const project: ProjectFile = {
  formatVersion: 1,
  video: {
    fileName: 'cfr30.mp4',
    codec: 'h264',
    width: 320,
    height: 240,
    rotation: 0,
    fps: 30,
    isVfr: false,
    durationMs: 10000,
    frameCount: 300,
    startTimeSec: 0
  },
  frames: [
    { id: 'f1', ptsSec: 0.4, ms: 400, seq: 1, baseName: null, region: null, crop: null },
    {
      id: 'f2',
      ptsSec: 1.5,
      ms: 1500,
      seq: 2,
      baseName: 'cảnh',
      region: { x: 1, y: 2, w: 30, h: 40 },
      crop: { x: 0, y: 0, w: 10, h: 10 }
    }
  ],
  nextSeq: 3,
  selection: { x: 5, y: 6, w: 7, h: 8 },
  exportSettings: { ...DEFAULT_EXPORT }
}

let cfrPts: number[] = []
beforeAll(async () => {
  mkdirSync(framesDir, { recursive: true })
  writeFileSync(join(framesDir, 'f1.png'), pngBytes('red'))
  writeFileSync(join(framesDir, 'f2.png'), pngBytes('blue'))
  cfrPts = await readPtsTable({ kind: 'file', path: FIXTURES.cfr30 })
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const target = join(tmp, 'round.fbproj')

test('round trip keeps project, frames and video bytes', async () => {
  await writeFbproj(target, { project, video: { kind: 'file', path: FIXTURES.cfr30 }, framesDir })
  const r = await openFbproj(target)
  expect(r.project).toEqual(project)
  expect(r.video.fileName).toBe('cfr30.mp4')
  expect(await r.readFrame('f1')).toEqual(readFileSync(join(framesDir, 'f1.png')))
  expect(await streamToBuffer(r.openVideoRange(r.video.start, r.video.end - 1))).toEqual(readFileSync(FIXTURES.cfr30))
  expect(await streamToBuffer(r.openVideoRange(r.video.start + 100, r.video.start + 199))).toHaveLength(100)
  await r.close()
})

test('reports progress up to the total', async () => {
  const calls: Array<[number, number]> = []
  await writeFbproj(nextTarget(), { project, video: { kind: 'file', path: FIXTURES.cfr30 }, framesDir }, (w, t) =>
    calls.push([w, t])
  )
  expect(calls.length).toBeGreaterThan(0)
  const last = calls[calls.length - 1]
  expect(last[0]).toBe(last[1])
  expect(calls.every(([w, t]) => w <= t)).toBe(true)
})

test('extractFramesTo writes every frame png', async () => {
  const r = await openFbproj(target)
  const out = join(tmp, 'extracted')
  await r.extractFramesTo(out)
  expect(readdirSync(out).sort()).toEqual(['f1.png', 'f2.png'])
  expect(readFileSync(join(out, 'f2.png'))).toEqual(readFileSync(join(framesDir, 'f2.png')))
  await r.close()
})

test('all entries stored, not deflated', async () => {
  const names: string[] = []
  await new Promise<void>((resolve, reject) => {
    yauzl.open(target, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err)
      zip.on('entry', (e: yauzl.Entry) => {
        names.push(e.fileName)
        if (e.compressionMethod !== 0) reject(new Error(`${e.fileName} is compressed`))
        else zip.readEntry()
      })
      zip.on('end', () => {
        zip.close()
        resolve()
      })
      zip.readEntry()
    })
  })
  expect(names.sort()).toEqual(['frames/f1.png', 'frames/f2.png', 'project.json', 'video/cfr30.mp4'])
})

test('ffmpeg reads the video inside the project (unicode path)', async () => {
  const t = join(tmp, 'Thư mục có dấu', 'dự án.fbproj')
  mkdirSync(dirname(t), { recursive: true })
  await writeFbproj(t, { project, video: { kind: 'file', path: FIXTURES.cfr30 }, framesDir })
  const r = await openFbproj(t)
  const out = tmpPng()
  await extractFrame(r.video, cfrPts[12], 0, null, out)
  expect(await decodeIndex(readFileSync(out))).toBe(12)
  await r.close()
})

test('unicode video file name round-trips', async () => {
  const src = join(tmp, 'chém.mp4')
  fs.copyFileSync(FIXTURES.cfr30, src)
  const t = nextTarget()
  await writeFbproj(t, { project, video: { kind: 'file', path: src }, framesDir })
  const r = await openFbproj(t)
  expect(r.video.fileName).toBe('chém.mp4')
  expect(await streamToBuffer(r.openVideoRange(r.video.start, r.video.end - 1))).toEqual(readFileSync(src))
  await r.close()
})

test('resave from zip source onto the same path', async () => {
  const r = await openFbproj(target)
  await writeFbproj(target + '.2', { project, video: r.video, framesDir })
  await r.close()
  const r2 = await openFbproj(target + '.2')
  expect(r2.project).toEqual(project)
  expect(await streamToBuffer(r2.openVideoRange(r2.video.start, r2.video.end - 1))).toEqual(
    readFileSync(FIXTURES.cfr30)
  )
  await r2.close()
})

test('resave from zip source over the very same file', async () => {
  const t = nextTarget()
  await writeFbproj(t, { project, video: { kind: 'file', path: FIXTURES.cfr30 }, framesDir })
  const r = await openFbproj(t)
  const changed: ProjectFile = { ...project, nextSeq: 99 }
  await writeFbproj(t, { project: changed, video: r.video, framesDir })
  await r.close()
  const r2 = await openFbproj(t)
  expect(r2.project.nextSeq).toBe(99)
  expect(await streamToBuffer(r2.openVideoRange(r2.video.start, r2.video.end - 1))).toEqual(
    readFileSync(FIXTURES.cfr30)
  )
  await r2.close()
})

test('open reader does not block replacing the file', async () => {
  const t = nextTarget()
  await writeFbproj(t, { project, video: { kind: 'file', path: FIXTURES.cfr30 }, framesDir })
  const r = await openFbproj(t)
  await writeFbproj(t, { project, video: { kind: 'file', path: FIXTURES.cfr30 }, framesDir })
  await r.close()
})

test('failure mid-write leaves original untouched and no temp file', async () => {
  const before = readFileSync(target)
  await expect(
    writeFbproj(target, { project, video: { kind: 'file', path: 'missing.mp4' }, framesDir })
  ).rejects.toThrow()
  expect(readFileSync(target)).toEqual(before)
  expect(readdirSync(dirname(target)).filter((n) => n.includes('.tmp-'))).toEqual([])
})

test('failure after the temp file is written (rename fails) removes the temp file', async () => {
  const dir = join(tmp, 'renamefail')
  mkdirSync(dir)
  const blocked = join(dir, 'x.fbproj')
  mkdirSync(blocked) // renaming a file over a directory fails
  await expect(
    writeFbproj(blocked, { project, video: { kind: 'file', path: FIXTURES.cfr30 }, framesDir })
  ).rejects.toThrow()
  expect(readdirSync(dir)).toEqual(['x.fbproj'])
})

test('not enough disk → DiskFullError before writing', async () => {
  const dir = join(tmp, 'diskfull')
  mkdirSync(dir)
  vi.spyOn(fs.promises, 'statfs').mockResolvedValue({ bavail: 1000, bsize: 4096 } as fs.StatsFs)
  const err = await writeFbproj(join(dir, 'a.fbproj'), {
    project,
    video: { kind: 'file', path: FIXTURES.cfr30 },
    framesDir
  }).catch((e: unknown) => e)
  expect(err).toBeInstanceOf(DiskFullError)
  expect((err as DiskFullError).freeBytes).toBe(1000 * 4096)
  expect((err as DiskFullError).neededBytes).toBeGreaterThan(10 * 1024 * 1024)
  expect(readdirSync(dir)).toEqual([])
})

test('rejects non-project zip', async () => {
  const randomZip = join(tmp, 'random.zip')
  await writeZip(randomZip, (z) => z.addBuffer(Buffer.from('hello'), 'hello.txt', { compress: false }))
  await expect(openFbproj(randomZip)).rejects.toBeInstanceOf(InvalidProjectError)
})

test('rejects a file that is not a zip', async () => {
  const f = join(tmp, 'notzip.fbproj')
  writeFileSync(f, 'definitely not a zip file')
  await expect(openFbproj(f)).rejects.toBeInstanceOf(InvalidProjectError)
})

test('rejects compressed entries', async () => {
  const f = join(tmp, 'deflated.fbproj')
  // deflated by default
  await writeZip(f, (z) => z.addBuffer(Buffer.from(JSON.stringify(project)), 'project.json'))
  await expect(openFbproj(f)).rejects.toBeInstanceOf(InvalidProjectError)
})

test('rejects unsupported formatVersion with the version in the message', async () => {
  const f = join(tmp, 'v2.fbproj')
  await writeZip(f, (z) =>
    z.addBuffer(Buffer.from(JSON.stringify({ ...project, formatVersion: 2 })), 'project.json', { compress: false })
  )
  const err = await openFbproj(f).catch((e: unknown) => e)
  expect(err).toBeInstanceOf(InvalidProjectError)
  expect((err as Error).message).toContain('2')
})

test('failure DURING streaming leaves target untouched and no temp file', async () => {
  const dir = join(tmp, 'midstream')
  mkdirSync(dir)
  const fd = join(dir, 'frames')
  mkdirSync(fd)
  writeFileSync(join(fd, 'f1.png'), pngBytes('red'))
  writeFileSync(join(fd, 'f2.png'), pngBytes('blue'))
  const t = join(dir, 'p.fbproj')
  await writeFbproj(t, { project, video: { kind: 'file', path: FIXTURES.cfr30 }, framesDir: fd })
  const before = readFileSync(t)
  // first progress tick happens after sizes were stat-ed and before any streaming: truncate a frame
  // so the size yazl was promised no longer matches the bytes read
  let done = false
  await expect(
    writeFbproj(t, { project, video: { kind: 'file', path: FIXTURES.cfr30 }, framesDir: fd }, () => {
      if (!done) {
        done = true
        writeFileSync(join(fd, 'f2.png'), Buffer.from('x'))
      }
    })
  ).rejects.toThrow()
  expect(readFileSync(t)).toEqual(before)
  expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([])
})

test('ZIP64 structures are read correctly', async () => {
  const t = nextTarget()
  await writeFbproj(t, { project, video: { kind: 'file', path: FIXTURES.cfr30 }, framesDir }, undefined, {
    forceZip64: true
  })
  const r = await openFbproj(t)
  expect(r.project).toEqual(project)
  expect(await r.readFrame('f2')).toEqual(readFileSync(join(framesDir, 'f2.png')))
  expect(await streamToBuffer(r.openVideoRange(r.video.start, r.video.end - 1))).toEqual(readFileSync(FIXTURES.cfr30))
  await r.close()
})

test('data offset uses the local header extra field, not the central directory', async () => {
  // hand-built stored zip whose LOCAL header carries a 20-byte extra field the central directory lacks
  const name = Buffer.from('project.json')
  const data = Buffer.from(JSON.stringify(project))
  const video = Buffer.from('VIDEODATA')
  const vname = Buffer.from('video/v.mp4')
  const extra = Buffer.alloc(20, 0xab)
  const crc32 = (b: Buffer): number => {
    let c = ~0
    for (const x of b) {
      c ^= x
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [nm, buf, ex] of [
    [name, data, Buffer.alloc(0)],
    [vname, video, extra]
  ] as const) {
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt32LE(crc32(buf), 14)
    lh.writeUInt32LE(buf.length, 18)
    lh.writeUInt32LE(buf.length, 22)
    lh.writeUInt16LE(nm.length, 26)
    lh.writeUInt16LE(ex.length, 28)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt32LE(crc32(buf), 16)
    ch.writeUInt32LE(buf.length, 20)
    ch.writeUInt32LE(buf.length, 24)
    ch.writeUInt16LE(nm.length, 28)
    ch.writeUInt32LE(offset, 42)
    central.push(ch, nm)
    parts.push(lh, nm, ex, buf)
    offset += 30 + nm.length + ex.length + buf.length
  }
  const cd = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(2, 8)
  eocd.writeUInt16LE(2, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  const f = join(tmp, 'extra.fbproj')
  writeFileSync(f, Buffer.concat([...parts, cd, eocd]))
  const r = await openFbproj(f)
  expect(await streamToBuffer(r.openVideoRange(r.video.start, r.video.end - 1))).toEqual(video)
  await r.close()
})

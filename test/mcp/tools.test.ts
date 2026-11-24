import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import { createCanvas, loadImage } from '@napi-rs/canvas'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { exportFlipbook } from '../../src/core/export'
import { writeFbproj } from '../../src/core/fbproj'
import { DEFAULT_EXPORT, type FrameRecord, type ProjectFile, type VideoInfo } from '../../src/core/types'
import { createServer, parseRoots, resolveInsideRoots } from '../../src/mcp/tools'

const png = (w: number, h: number, shade: number): Buffer => {
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = `rgb(${shade}, 40, 60)`
  ctx.fillRect(0, 0, w, h)
  return c.toBuffer('image/png')
}

const video: VideoInfo = {
  fileName: 'clip.mp4', codec: 'h264', width: 640, height: 360, rotation: 0, fps: 30,
  isVfr: false, durationMs: 5000, frameCount: 150, startTimeSec: 0
}
const frames: FrameRecord[] = [
  { id: 'a', ptsSec: 0, ms: 0, seq: 1, baseName: null, region: null, crop: null },
  { id: 'b', ptsSec: 0.5, ms: 500, seq: 2, baseName: 'hit', region: null, crop: { x: 100, y: 50, w: 320, h: 180 } },
  { id: 'c', ptsSec: 1, ms: 1000, seq: 3, baseName: null, region: null, crop: null }
]
const project: ProjectFile = {
  formatVersion: 1, video, frames, nextSeq: 4, selection: null, exportSettings: { ...DEFAULT_EXPORT }
}

const base = mkdtempSync(join(tmpdir(), 'fc-mcp-'))
const root = join(base, 'clips')
const other = join(base, 'clips-other')
const proj = join(root, 'sub', 'dự án.fbproj')
let logPath: string
let client: Client

const snapshot = (dir: string): string[] =>
  (readdirSync(dir, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
    .map((e) => join(e.parentPath, e.name))
    .sort()
    .map((p) => `${p}|${statSync(p).mtimeMs}|${statSync(p).size}`)

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const res: any = await client.callTool({ name, arguments: args })
  return JSON.parse(res.content[0].text)
}

beforeAll(async () => {
  mkdirSync(join(root, 'sub'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'x'), { recursive: true })
  mkdirSync(join(root, '.hidden'), { recursive: true })
  mkdirSync(other, { recursive: true })
  const framesDir = join(base, 'frames-src')
  mkdirSync(framesDir)
  for (const f of frames) writeFileSync(join(framesDir, `${f.id}.png`), png(640, 360, 30 + f.seq * 20))
  const fakeVideo = join(base, 'clip.mp4')
  writeFileSync(fakeVideo, 'not really a video')
  const target = { project, video: { kind: 'file' as const, path: fakeVideo }, framesDir }
  await writeFbproj(proj, target)
  await writeFbproj(join(root, 'node_modules', 'x', 'skip.fbproj'), target)
  await writeFbproj(join(root, '.hidden', 'skip.fbproj'), target)
  await writeFbproj(join(other, 'outside.fbproj'), target)
  writeFileSync(join(root, 'sub', 'broken.fbproj'), 'junk')
  const exp = join(root, 'out')
  const r = await exportFlipbook({
    projectName: 'dự án', video, frames,
    readFrame: async (id) => png(640, 360, 30 + (id.charCodeAt(0) - 96) * 20),
    settings: { ...DEFAULT_EXPORT }, outDir: exp, fileName: 'flip'
  })
  logPath = r.logJson
  writeFileSync(join(exp, 'bad_log.json'), '{ not json')
  const server = createServer([root])
  const [ct, st] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(st), client.connect(ct)])
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

test('lists projects and exports under roots', async () => {
  const r = await call('list_projects', {})
  expect(r.map((p: { path: string }) => basename(p.path))).toEqual(['dự án.fbproj'])
  expect(r[0]).toMatchObject({ frameCount: 3, video: 'clip.mp4' })
  const exps = await call('list_exports', {})
  expect(exps).toHaveLength(1)
  expect(exps[0]).toMatchObject({ frameCount: 3, pageCount: 1, pages: ['flip_p1.png'] })
})

test('get_project returns numbered frames', async () => {
  const r = await call('get_project', { path: proj })
  expect(r.frames.map((f: { index: number; name: string }) => [f.index, f.name])).toEqual([[1, '1'], [2, 'hit-2'], [3, '3']])
  expect(r.frames[1].crop).toEqual({ x: 100, y: 50, w: 320, h: 180 })
})

test('get_flipbook returns pages as images plus log', async () => {
  const res: any = await client.callTool({ name: 'get_flipbook', arguments: { log_path: logPath } })
  expect(res.content.filter((c: any) => c.type === 'image')).toHaveLength(1)
  expect(res.content.find((c: any) => c.type === 'image').mimeType).toBe('image/png')
  expect(JSON.parse(res.content.find((c: any) => c.type === 'text').text).frames).toHaveLength(3)
})

test('get_frame applies crop and max_size', async () => {
  const res: any = await client.callTool({ name: 'get_frame', arguments: { project_path: proj, index: 2, max_size: 100 } })
  const img = await loadImage(Buffer.from(res.content[0].data, 'base64'))
  expect(Math.max(img.width, img.height)).toBe(100)
  expect(img.height).toBe(56)
  const full: any = await client.callTool({ name: 'get_frame', arguments: { project_path: proj, index: 1 } })
  const f = await loadImage(Buffer.from(full.content[0].data, 'base64'))
  expect([f.width, f.height]).toEqual([640, 360])
})

test('get_frame index out of range is a clear error', async () => {
  for (const index of [0, 4]) {
    const res: any = await client.callTool({ name: 'get_frame', arguments: { project_path: proj, index } })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain('1')
  }
})

test('rejects paths outside roots', async () => {
  const res: any = await client.callTool({ name: 'get_project', arguments: { path: 'C:/Windows/win.ini' } })
  expect(res.isError).toBe(true)
  expect(res.content[0].text).toContain('ngoài thư mục gốc')
  const sib: any = await client.callTool({ name: 'get_project', arguments: { path: join(other, 'outside.fbproj') } })
  expect(sib.isError).toBe(true)
  expect(sib.content[0].text).toContain('ngoài thư mục gốc')
})

test('resolveInsideRoots: prefix tricks, dotdot, relative', () => {
  const roots = [root]
  expect(resolveInsideRoots(roots, proj)).toBe(proj)
  expect(resolveInsideRoots(roots, proj.toUpperCase().replace('Ự', 'ự'))).toBeTruthy()
  expect(() => resolveInsideRoots(roots, join(other, 'outside.fbproj'))).toThrow('ngoài thư mục gốc')
  expect(() => resolveInsideRoots(roots, join(root, '..', 'clips-other', 'outside.fbproj'))).toThrow('ngoài thư mục gốc')
  expect(() => resolveInsideRoots(roots, 'sub/dự án.fbproj')).toThrow('tuyệt đối')
  expect(() => resolveInsideRoots(roots, join(root, 'missing.fbproj'))).toThrow()
})

test('get_flipbook refuses a log whose page points outside roots', async () => {
  const evil = join(root, 'evil_log.json')
  const log = JSON.parse(readFileSync(logPath, 'utf8'))
  log.pages[0].file = join('..', 'clips-other', 'outside.fbproj')
  writeFileSync(evil, JSON.stringify(log))
  const res: any = await client.callTool({ name: 'get_flipbook', arguments: { log_path: evil } })
  expect(res.isError).toBe(true)
  expect(res.content[0].text).toContain('ngoài thư mục gốc')
  rmSync(evil)
})

test('parseRoots collects --root values as absolute paths', () => {
  expect(parseRoots(['--root', 'a', '--root=b'])).toEqual([resolve('a'), resolve('b')])
  expect(parseRoots([])).toEqual([])
})

test('never writes', async () => {
  const before = snapshot(root)
  await call('list_projects', {})
  await call('list_exports', {})
  await call('get_project', { path: proj })
  await client.callTool({ name: 'get_flipbook', arguments: { log_path: logPath } })
  await client.callTool({ name: 'get_frame', arguments: { project_path: proj, index: 2, max_size: 100 } })
  await client.callTool({ name: 'get_frame', arguments: { project_path: proj, index: 9 } })
  expect(snapshot(root)).toEqual(before)
})


import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { VideoSource } from '../../src/core/fbproj'
import type { VideoInfo } from '../../src/core/types'
import { ProjectDocument } from '../../src/main/document'
import { FrameMismatchError, type extractFrame } from '../../src/main/ffmpeg/extract'
import { Workspace } from '../../src/main/workspace'
import type { DocCommand } from '../../src/shared/commands'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)
const pts = Array.from({ length: 90 }, (_, i) => i / 30)
const video: VideoInfo = {
  fileName: 'v.mp4',
  codec: 'h264',
  width: 640,
  height: 360,
  rotation: 0,
  fps: 30,
  isVfr: false,
  durationMs: 3000,
  frameCount: 90,
  startTimeSec: 0
}
const source: VideoSource = { kind: 'file', path: 'v.mp4' }
const capture36: DocCommand = { type: 'captureFrame', frameIndex: 36, useSelection: false }

let root: string
let ws: Workspace
let doc: ProjectDocument
let fakeExtract: ReturnType<typeof vi.fn>
let n: number

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'fc-doc-'))
  ws = await Workspace.create(root)
  n = 0
  fakeExtract = vi.fn(async (_s: VideoSource, _p: number, _t: number, _r: unknown, out: string) => {
    writeFileSync(out, PNG)
  })
  doc = new ProjectDocument({
    workspace: ws,
    pts,
    video,
    source,
    extract: fakeExtract as unknown as typeof extractFrame,
    newId: () => `id${++n}`
  })
})
afterEach(async () => {
  await doc.idle()
  rmSync(root, { recursive: true, force: true })
})

const idOf = (r: unknown): string => (r as { frameId: string }).frameId

test('capture, duplicate, second region on same frame', async () => {
  expect(await doc.execute(capture36)).toMatchObject({ ok: true })
  expect(doc.state.project.frames[0]).toMatchObject({ ms: 1200, seq: 1, region: null, ptsSec: 36 / 30 })
  expect(await doc.execute(capture36)).toMatchObject({ ok: false, reason: 'duplicate' })
  await doc.execute({ type: 'setSelection', rect: { x: 10, y: 10, w: 100, h: 50 } })
  expect(await doc.execute({ type: 'captureFrame', frameIndex: 36, useSelection: true })).toMatchObject({ ok: true })
  expect(fakeExtract).toHaveBeenCalledTimes(2)
  expect(doc.state.project.frames[1]).toMatchObject({ seq: 2, region: { x: 10, y: 10, w: 100, h: 50 } })
  expect(fakeExtract.mock.calls[0][2]).toBe(0) // startTimeSec comes from the video
  expect(existsSync(join(ws.framesDir, 'id1.png'))).toBe(true)
})

test('ctrl+T without selection', async () => {
  const r = await doc.execute({ type: 'captureFrame', frameIndex: 0, useSelection: true })
  expect(r).toMatchObject({
    ok: false,
    reason: 'no-selection',
    message: 'Hãy kéo chuột trên video để vẽ vùng trước khi bấm Ctrl+T.'
  })
  expect(fakeExtract).not.toHaveBeenCalled()
})

test('frameIndex out of range and unknown ids are not-found', async () => {
  expect(await doc.execute({ type: 'captureFrame', frameIndex: 90, useSelection: false })).toMatchObject({ ok: false, reason: 'not-found' })
  expect(await doc.execute({ type: 'captureFrame', frameIndex: -1, useSelection: false })).toMatchObject({ ok: false, reason: 'not-found' })
  expect(await doc.execute({ type: 'deleteFrame', id: 'x' })).toMatchObject({ ok: false, reason: 'not-found' })
  expect(await doc.execute({ type: 'renameFrame', id: 'x', baseName: 'a' })).toMatchObject({ ok: false, reason: 'not-found' })
  expect(await doc.execute({ type: 'setCrop', id: 'x', crop: null })).toMatchObject({ ok: false, reason: 'not-found' })
  expect(doc.state.canUndo).toBe(false)
})

test('FrameMismatchError becomes mismatch and adds nothing; other errors propagate', async () => {
  fakeExtract.mockRejectedValueOnce(new FrameMismatchError(1.2, 1.3))
  expect(await doc.execute(capture36)).toMatchObject({ ok: false, reason: 'mismatch' })
  expect(doc.state.project.frames).toHaveLength(0)
  expect(doc.state.project.nextSeq).toBe(1)
  expect(doc.state.canUndo).toBe(false)
  fakeExtract.mockRejectedValueOnce(new Error('boom'))
  await expect(doc.execute(capture36)).rejects.toThrow('boom')
  expect(doc.state.project.frames).toHaveLength(0)
  // the queue survives a rejected command
  expect(await doc.execute(capture36)).toMatchObject({ ok: true })
})

test('undo/redo covers capture, rename, crop, delete', async () => {
  const id = idOf(await doc.execute(capture36))
  await doc.execute({ type: 'renameFrame', id, baseName: 'slash' })
  await doc.execute({ type: 'setCrop', id, crop: { x: 1, y: 2, w: 3, h: 4 } })
  await doc.execute({ type: 'deleteFrame', id })
  expect(doc.state.project.frames).toHaveLength(0)

  await doc.undo()
  expect(doc.state.project.frames[0]).toMatchObject({ baseName: 'slash', crop: { x: 1, y: 2, w: 3, h: 4 } })
  await doc.undo()
  expect(doc.state.project.frames[0]).toMatchObject({ baseName: 'slash', crop: null })
  await doc.undo()
  expect(doc.state.project.frames[0].baseName).toBeNull()
  await doc.undo()
  expect(doc.state.project.frames).toHaveLength(0)
  expect(doc.state.canUndo).toBe(false)
  expect(doc.state.canRedo).toBe(true)
  expect(existsSync(join(ws.framesDir, `${id}.png`))).toBe(true) // PNG kept for redo

  await doc.redo()
  await doc.redo()
  await doc.redo()
  expect(doc.state.project.frames[0]).toMatchObject({ baseName: 'slash', crop: { x: 1, y: 2, w: 3, h: 4 } })
  await doc.redo()
  expect(doc.state.project.frames).toHaveLength(0)
  expect(doc.state.canRedo).toBe(false)
  await doc.undo()
  expect(doc.state.project.frames).toHaveLength(1)
})

test('delete undo restores the original position', async () => {
  const a = idOf(await doc.execute({ type: 'captureFrame', frameIndex: 1, useSelection: false }))
  await doc.execute({ type: 'captureFrame', frameIndex: 2, useSelection: false })
  await doc.execute({ type: 'deleteFrame', id: a })
  await doc.undo()
  expect(doc.state.project.frames.map((f) => f.id)).toEqual(['id1', 'id2'])
})

test('new command clears redo; selection/settings are not in history', async () => {
  await doc.execute(capture36)
  await doc.undo()
  expect(doc.state.canRedo).toBe(true)
  await doc.execute({ type: 'setSelection', rect: null })
  expect(doc.state.canRedo).toBe(true)
  await doc.execute({ type: 'setExportSettings', settings: { ...doc.state.project.exportSettings, gap: 9 } })
  expect(doc.state.canRedo).toBe(true)
  expect(doc.state.project.exportSettings.gap).toBe(9)
  await doc.execute(capture36)
  expect(doc.state.canRedo).toBe(false)
})

test('no-op rename and setCrop add no history and no dirty', async () => {
  const id = idOf(await doc.execute(capture36))
  await doc.markSaved()
  expect(await doc.execute({ type: 'renameFrame', id, baseName: '  ' })).toMatchObject({ ok: true })
  expect(await doc.execute({ type: 'setCrop', id, crop: null })).toMatchObject({ ok: true })
  await doc.execute({ type: 'setCrop', id, crop: { x: 1, y: 1, w: 2, h: 2 } })
  await doc.markSaved()
  await doc.execute({ type: 'setCrop', id, crop: { x: 1, y: 1, w: 2, h: 2 } })
  expect(doc.state.dirty).toBe(false)
  await doc.undo()
  expect(doc.state.project.frames[0].crop).toBeNull() // only one crop entry in history
})

test('failing workspace write: execute still returns the real result, writeError emitted', async () => {
  const errors: unknown[] = []
  doc.on('writeError', (e) => errors.push(e))
  vi.spyOn(ws, 'write').mockRejectedValueOnce(new Error('disk'))
  expect(await doc.execute(capture36)).toMatchObject({ ok: true })
  expect(errors).toHaveLength(1)
  expect(doc.state.project.frames).toHaveLength(1)
  expect(doc.state.canUndo).toBe(true)
  expect(doc.state.dirty).toBe(true)
})

test('failing workspace write on undo emits writeError', async () => {
  await doc.execute(capture36)
  const errors: unknown[] = []
  doc.on('writeError', (e) => errors.push(e))
  vi.spyOn(ws, 'write').mockRejectedValueOnce(new Error('disk'))
  await doc.undo()
  expect(errors).toHaveLength(1)
  expect(doc.state.project.frames).toHaveLength(0)
})

test('undo issued during an in-flight capture applies after it', async () => {
  let release: (() => void) | undefined
  fakeExtract.mockImplementationOnce(
    (_s: VideoSource, _p: number, _t: number, _r: unknown, out: string) =>
      new Promise<void>((res) => {
        release = () => {
          writeFileSync(out, PNG)
          res()
        }
      })
  )
  const cap = doc.execute(capture36)
  const und = doc.undo()
  const saved = doc.markSaved()
  await vi.waitFor(() => expect(release).toBeDefined())
  release!()
  expect(await cap).toMatchObject({ ok: true })
  await und
  await saved
  expect(doc.state.project.frames).toHaveLength(0) // the undo undid the capture
  expect(doc.state.canRedo).toBe(true)
  expect(doc.state.dirty).toBe(false) // markSaved ran last
})

test('rename blank becomes null', async () => {
  const id = idOf(await doc.execute(capture36))
  await doc.execute({ type: 'renameFrame', id, baseName: 'a' })
  await doc.execute({ type: 'renameFrame', id, baseName: '   ' })
  expect(doc.state.project.frames[0].baseName).toBeNull()
})

test('state.project is a snapshot', async () => {
  await doc.execute(capture36)
  const snap = doc.state.project
  snap.frames.length = 0
  snap.exportSettings.gap = 99
  expect(doc.state.project.frames).toHaveLength(1)
  expect(doc.state.project.exportSettings.gap).toBe(4)
})

test('dirty tracking', async () => {
  expect(doc.state.dirty).toBe(false)
  await doc.execute(capture36)
  expect(doc.state.dirty).toBe(true)
  await doc.markSaved()
  expect(doc.state.dirty).toBe(false)
  await doc.execute({ type: 'setSelection', rect: { x: 0, y: 0, w: 5, h: 5 } })
  expect(doc.state.dirty).toBe(true)
  await doc.markSaved()
  await doc.undo()
  expect(doc.state.dirty).toBe(true)
  await doc.markSaved()
  await doc.redo()
  expect(doc.state.dirty).toBe(true)
})

test('workspace persists every change and is recoverable', async () => {
  await doc.execute(capture36)
  let found = await Workspace.findRecoverable(root)
  expect(found[0].project.frames).toHaveLength(1)
  expect(found[0].meta.dirty).toBe(true)
  await doc.undo()
  await doc.idle()
  found = await Workspace.findRecoverable(root)
  expect(found[0].project.frames).toHaveLength(0)
  await doc.markSaved()
  await doc.idle()
  expect(await Workspace.findRecoverable(root)).toEqual([])
})

test('setMeta is persisted; changed is emitted after each write', async () => {
  const seen: number[] = []
  doc.on('changed', () => seen.push(1))
  await doc.setMeta({ videoOrigin: { kind: 'file', path: 'C:/v.mp4' }, savedPath: null })
  await doc.execute(capture36)
  expect(seen.length).toBe(2)
  const found = await Workspace.findRecoverable(root)
  expect(found[0].meta.videoOrigin).toEqual({ kind: 'file', path: 'C:/v.mp4' })
})

test('concurrent commands are serialized', async () => {
  const rs = await Promise.all(
    [0, 1, 2, 3, 4].map((i) => doc.execute({ type: 'captureFrame', frameIndex: i, useSelection: false }))
  )
  expect(rs.every((r) => r.ok)).toBe(true)
  expect(doc.state.project.frames.map((f) => f.seq)).toEqual([1, 2, 3, 4, 5])
  await doc.idle()
  const found = await Workspace.findRecoverable(root)
  expect(found[0].project.frames).toHaveLength(5)
})

test('can start from a given project', async () => {
  await doc.execute(capture36)
  const again = new ProjectDocument({
    workspace: ws,
    pts,
    video,
    source,
    project: doc.state.project,
    extract: fakeExtract as unknown as typeof extractFrame,
    newId: () => 'z'
  })
  expect(again.state.project.frames).toHaveLength(1)
  expect(again.state.canUndo).toBe(false)
})

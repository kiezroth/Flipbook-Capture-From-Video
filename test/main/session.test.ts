import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { DiskFullError, openFbproj, writeFbproj } from '../../src/core/fbproj'
import { serveVideo } from '../../src/main/media-protocol'
import { ProjectSession, type Ask } from '../../src/main/session'
import type { DocCommand } from '../../src/shared/commands'
import { FIXTURES } from '../helpers/fixtures'

vi.mock('../../src/core/fbproj', async (orig) => {
  const m = await orig<typeof import('../../src/core/fbproj')>()
  return { ...m, writeFbproj: vi.fn(m.writeFbproj) }
})
vi.setConfig({ testTimeout: 60_000 })

const capture36: DocCommand = { type: 'captureFrame', frameIndex: 36, useSelection: false }

let tmp: string
let s: ProjectSession
let ask: ReturnType<typeof vi.fn<Ask>>
let pickSave: ReturnType<typeof vi.fn<() => Promise<string | null>>>
let pickOpen: ReturnType<typeof vi.fn<() => Promise<string | null>>>
let pickVideo: ReturnType<typeof vi.fn<() => Promise<string | null>>>
let releaseVideo: ReturnType<typeof vi.fn<() => Promise<void>>>
let toasts: { kind: string; text: string }[]
const sessions: ProjectSession[] = []

function makeSession(): ProjectSession {
  const session = new ProjectSession({
    workRoot: join(tmp, 'work'),
    cacheDir: join(tmp, 'cache'),
    ask,
    pickSavePath: pickSave,
    pickOpenPath: pickOpen,
    pickVideoPath: pickVideo,
    releaseVideo
  })
  session.on('toast', (t: { kind: string; text: string }) => toasts.push(t))
  sessions.push(session)
  return session
}

/** Opens a read stream on the current video through the same serve function the protocol uses (like the player). */
async function openVideoStreamFromSession(session: ProjectSession): Promise<Readable> {
  const r = await serveVideo(session.media().video!, 'bytes=0-')
  const body = r.body as Readable
  body.on('error', () => undefined)
  body.pause() // keep it open, like a player that has buffered enough
  return body
}

const workDirs = (): string[] => (existsSync(join(tmp, 'work')) ? readdirSync(join(tmp, 'work')) : [])

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fc-session-'))
  ask = vi.fn<Ask>(async () => 'yes')
  pickSave = vi.fn(async () => null)
  pickOpen = vi.fn(async () => null)
  pickVideo = vi.fn(async () => null)
  releaseVideo = vi.fn(async () => undefined)
  toasts = []
  s = makeSession()
})

afterEach(async () => {
  for (const x of sessions.splice(0)) await x.dispose()
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('save, reopen, save over the open file while its video stream is open', async () => {
  await s.importVideo(FIXTURES.cfr30)
  await s.doc!.execute(capture36)
  pickSave.mockResolvedValue(join(tmp, 'dự án.fbproj'))
  await s.save()
  expect(releaseVideo).not.toHaveBeenCalled() // first save does not overwrite the playing file
  await s.open(join(tmp, 'dự án.fbproj'))
  const held = await openVideoStreamFromSession(s) // keep a read stream open like the player
  const urlBefore = s.rendererState().video!.url
  await s.doc!.execute({ type: 'renameFrame', id: s.doc!.state.project.frames[0].id, baseName: 'slash' })
  expect(await s.save()).toBe(true)
  expect(releaseVideo).toHaveBeenCalled()
  expect(held.destroyed).toBe(true)
  expect((await openFbproj(join(tmp, 'dự án.fbproj'))).project.frames[0].baseName).toBe('slash')

  // the player gets a new URL and the video is served from the new file; captures still work
  const st = s.rendererState()
  expect(st.video!.url).not.toBe(urlBefore)
  expect(st.dirty).toBe(false)
  expect(st.projectName).toBe('dự án')
  const video = s.media().video!
  expect(video.kind).toBe('zipEntry')
  const served = await serveVideo(video, null)
  const chunks: Buffer[] = []
  for await (const c of served.body as Readable) chunks.push(c as Buffer)
  expect(Buffer.concat(chunks).equals(readFileSync(FIXTURES.cfr30))).toBe(true)
  expect((await s.doc!.execute({ type: 'captureFrame', frameIndex: 40, useSelection: false })).ok).toBe(true)
  expect(readdirSync(tmp).filter((n) => n.includes('.tmp') || n.includes('.saving'))).toEqual([])
})

test('first save switches the source to the saved file and records the session meta', async () => {
  await s.importVideo(FIXTURES.cfr30)
  expect(s.rendererState()).toMatchObject({ projectName: 'Untitled', dirty: true, filePath: null })
  pickSave.mockResolvedValue(join(tmp, 'clip'))
  expect(await s.save()).toBe(true)
  const path = join(tmp, 'clip.fbproj') // extension added
  expect(s.filePath).toBe(path)
  expect(s.media().video).toMatchObject({ kind: 'zipEntry', zipPath: path })
  expect(s.rendererState()).toMatchObject({ projectName: 'clip', dirty: false })
  const dir = join(tmp, 'work', workDirs()[0])
  expect(JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'))).toEqual({
    videoOrigin: { kind: 'fbproj', path },
    savedPath: path,
    dirty: false
  })
})

test('save as cancelled returns false and changes nothing', async () => {
  await s.importVideo(FIXTURES.cfr30)
  expect(await s.saveAs()).toBe(false)
  expect(s.filePath).toBeNull()
  expect(s.rendererState().dirty).toBe(true)
})

test('open extracts frames into a new workspace and disposes the previous one', async () => {
  await s.importVideo(FIXTURES.cfr30)
  await s.doc!.execute(capture36)
  pickSave.mockResolvedValue(join(tmp, 'a.fbproj'))
  await s.save()
  const before = workDirs()
  expect(before).toHaveLength(1)
  await s.open(join(tmp, 'a.fbproj'))
  const after = workDirs()
  expect(after).toHaveLength(1)
  expect(after[0]).not.toBe(before[0])
  const id = s.doc!.state.project.frames[0].id
  expect(existsSync(join(s.media().framesDir!, `${id}.png`))).toBe(true)
  expect(s.rendererState()).toMatchObject({ filePath: join(tmp, 'a.fbproj'), dirty: false })
  expect(s.rendererState().video!.pts).toHaveLength(90)
})

test('opening an invalid file shows an error and keeps the current project', async () => {
  await s.importVideo(FIXTURES.cfr30)
  ask.mockResolvedValue('discard')
  await s.open(FIXTURES.cfr30) // not a zip
  expect(s.doc).not.toBeNull()
  expect(toasts.at(-1)?.kind).toBe('error')
  expect(workDirs()).toHaveLength(1)
})

test('import over existing video asks and clears frames', async () => {
  await s.importVideo(FIXTURES.cfr30)
  await s.doc!.execute(capture36)
  ask.mockResolvedValueOnce('no')
  await s.importVideo(FIXTURES.vfr)
  expect(ask).toHaveBeenLastCalledWith('replaceVideo', expect.anything())
  expect(s.doc!.state.project.frames).toHaveLength(1)
  expect(s.rendererState().video!.info.fileName).toBe('cfr30.mp4')

  ask.mockResolvedValueOnce('yes')
  await s.importVideo(FIXTURES.vfr)
  expect(s.doc!.state.project.frames).toEqual([])
  expect(s.doc!.state.dirty).toBe(true)
  expect(s.rendererState().video!.info.fileName).toBe('vfr.mp4')
  expect(s.doc!.state.project.video!.fileName).toBe('vfr.mp4')
  expect(workDirs()).toHaveLength(1)
})

test('unsaved changes: cancel keeps project open', async () => {
  await s.importVideo(FIXTURES.cfr30)
  await s.doc!.execute(capture36)
  const doc = s.doc
  ask.mockResolvedValue('cancel')
  await s.newProject()
  expect(ask).toHaveBeenCalledWith('unsaved', expect.anything())
  expect(s.doc).toBe(doc)
  expect(s.doc!.state.project.frames).toHaveLength(1)
  expect(s.rendererState().dirty).toBe(true)

  ask.mockResolvedValue('discard')
  await s.newProject()
  expect(s.doc).toBeNull()
  expect(s.rendererState()).toMatchObject({ project: null, video: null, projectName: 'Untitled', dirty: false })
  expect(workDirs()).toEqual([]) // clean close disposes the workspace
})

test('unsaved changes: save then continue', async () => {
  await s.importVideo(FIXTURES.cfr30)
  ask.mockResolvedValue('save')
  pickSave.mockResolvedValue(join(tmp, 'kept.fbproj'))
  expect(await s.confirmClose()).toBe(true)
  expect(existsSync(join(tmp, 'kept.fbproj'))).toBe(true)
  pickSave.mockResolvedValue(null)
  await s.doc!.execute(capture36)
  ask.mockResolvedValue('save')
  pickSave.mockClear() // saved: no dialog the second time
  expect(await s.confirmClose()).toBe(true)
  expect(pickSave).not.toHaveBeenCalled()
  expect((await openFbproj(join(tmp, 'kept.fbproj'))).project.frames).toHaveLength(1)
})

test('recover after crash', async () => {
  await s.importVideo(FIXTURES.cfr30)
  await s.doc!.execute(capture36)
  await s.doc!.idle()
  // the first session is abandoned (no dispose) as if the app crashed
  sessions.splice(sessions.indexOf(s), 1)

  const s2 = makeSession()
  ask.mockClear()
  ask.mockResolvedValue('yes')
  await s2.recoverOnStartup()
  expect(ask).toHaveBeenCalledWith('recover', expect.anything())
  expect(s2.doc!.state.project.frames).toHaveLength(1)
  expect(s2.doc!.state.dirty).toBe(true)
  expect(s2.rendererState().video!.info.fileName).toBe('cfr30.mp4')
  // the recovered frame image is served and a new capture works
  expect(existsSync(join(s2.media().framesDir!, `${s2.doc!.state.project.frames[0].id}.png`))).toBe(true)
  expect((await s2.doc!.execute({ type: 'captureFrame', frameIndex: 10, useSelection: false })).ok).toBe(true)
})

test('recover asks for the video when the original file is gone', async () => {
  const copy = join(tmp, 'gone.mp4')
  copyFileSync(FIXTURES.cfr30, copy)
  await s.importVideo(copy)
  await s.doc!.execute(capture36)
  await s.doc!.idle()
  sessions.splice(sessions.indexOf(s), 1)
  rmSync(copy)

  const s2 = makeSession()
  pickVideo.mockResolvedValue(FIXTURES.cfr30)
  await s2.recoverOnStartup()
  expect(pickVideo).toHaveBeenCalled()
  expect(s2.doc!.state.project.frames).toHaveLength(1)
  expect(s2.media().video).toEqual({ kind: 'file', path: FIXTURES.cfr30 })
})

test('declining recovery removes the crashed workspace', async () => {
  await s.importVideo(FIXTURES.cfr30)
  await s.doc!.idle()
  sessions.splice(sessions.indexOf(s), 1)
  const s2 = makeSession()
  ask.mockResolvedValue('no')
  await s2.recoverOnStartup()
  expect(s2.doc).toBeNull()
  expect(workDirs()).toEqual([])
})

test('reportVideoError makes a proxy and bumps the video URL', async () => {
  await s.importVideo(FIXTURES.cfr30)
  expect(s.media().proxyPath).toBeNull()
  const url = s.rendererState().video!.url
  await s.reportVideoError()
  expect(s.media().proxyPath).not.toBeNull()
  expect(existsSync(s.media().proxyPath!)).toBe(true)
  expect(s.rendererState().video!.url).not.toBe(url)
})

test('importing a codec Chromium cannot play makes a proxy', async () => {
  await s.importVideo(FIXTURES.hevc)
  expect(s.media().proxyPath).not.toBeNull()
  expect(s.rendererState().busy).toBeNull()
})

test('disk full on save shows the Vietnamese message', async () => {
  await s.importVideo(FIXTURES.cfr30)
  vi.mocked(writeFbproj).mockRejectedValueOnce(new DiskFullError(200 * 1024 * 1024, 50 * 1024 * 1024))
  pickSave.mockResolvedValue(join(tmp, 'x.fbproj'))
  expect(await s.save()).toBe(false)
  expect(toasts.at(-1)).toEqual({
    kind: 'error',
    text: 'Không đủ dung lượng đĩa: cần 200.0 MB, còn 50.0 MB. File cũ không bị thay đổi.'
  })
  expect(s.filePath).toBeNull()
  expect(s.rendererState().dirty).toBe(true)
})

test('export uses project folder and name by default', async () => {
  await s.importVideo(FIXTURES.cfr30)
  await s.doc!.execute(capture36)
  pickSave.mockResolvedValue(join(tmp, 'clip.fbproj'))
  await s.save()
  const r = await s.exportFlipbook(s.doc!.state.project.exportSettings, { documentsDir: join(tmp, 'docs') })
  expect(r).toEqual({
    ok: true,
    files: [join(tmp, 'clip_p1.png'), join(tmp, 'clip_log.txt'), join(tmp, 'clip_log.json')]
  })
  const unsaved = makeSession()
  await unsaved.importVideo(FIXTURES.cfr30)
  await unsaved.doc!.execute(capture36)
  const r2 = await unsaved.exportFlipbook(unsaved.doc!.state.project.exportSettings, { documentsDir: join(tmp, 'docs') })
  expect(r2.ok && r2.files[0]).toBe(join(tmp, 'docs', 'flipbook_p1.png'))
})

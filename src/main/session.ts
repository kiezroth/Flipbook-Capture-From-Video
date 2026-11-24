import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'

import { exportFlipbook as renderFlipbook } from '../core/export'
import { DiskFullError, openFbproj, writeFbproj, type FbprojReader, type VideoSource } from '../core/fbproj'
import { DEFAULT_EXPORT, type ExportSettings, type ProjectFile, type VideoInfo } from '../core/types'
import type { CommandResult, DocCommand } from '../shared/commands'
import type { BusyState, ExportResponse, RendererState, Toast } from '../shared/ipc'
import { ProjectDocument } from './document'
import { extractFrame } from './ffmpeg/extract'
import { needsProxy, probeVideo, readPtsTable } from './ffmpeg/probe'
import { makeProxy, proxyCachePath, proxyKeyForFile, proxyKeyForZipEntry } from './ffmpeg/proxy'
import { closeVideoStreams, VIDEO_SCHEME, type MediaState } from './media-protocol'
import { Workspace, type SessionMeta } from './workspace'

export type Ask = (
  kind: 'unsaved' | 'replaceVideo' | 'recover',
  detail?: string
) => Promise<'save' | 'discard' | 'cancel' | 'yes' | 'no'>

export interface SessionOptions {
  workRoot: string
  cacheDir: string
  ask: Ask
  pickSavePath: () => Promise<string | null>
  pickOpenPath: () => Promise<string | null>
  pickVideoPath: () => Promise<string | null>
  /** Makes the player drop the video (and its open requests); resolves when it has. */
  releaseVideo: () => Promise<void>
}

/** Everything that belongs to the loaded video; replaced as a whole on New/Open/Import/Recover. */
interface Loaded {
  workspace: Workspace
  doc: ProjectDocument
  source: VideoSource
  reader: FbprojReader | null
  pts: number[]
  info: VideoInfo
  proxyPath: string | null
  /** A proxy was already made, cancelled or failed for this video: video errors must not start another one. */
  proxyTried: boolean
}

const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1)
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const samePath = (a: string, b: string): boolean => resolve(a).toLowerCase() === resolve(b).toLowerCase()

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await rename(from, to)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      // Windows: antivirus/indexer may hold the target for a moment
      if (i >= 10 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e
      await new Promise((r) => setTimeout(r, 100))
    }
  }
}

/**
 * The project open in the app window: the document, its workspace, the video it plays and the file it is saved to.
 * Public operations run one at a time (a save never overlaps a capture or an open).
 * Events: 'state' (RendererState), 'toast' (Toast), 'progress' (BusyState | null).
 */
export class ProjectSession extends EventEmitter {
  private loaded: Loaded | null = null
  private path: string | null = null
  private version = 0
  private releasing = false
  private busy: BusyState | null = null
  private abort: AbortController | null = null
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly o: SessionOptions) {
    super()
  }

  get doc(): ProjectDocument | null {
    return this.loaded?.doc ?? null
  }

  get filePath(): string | null {
    return this.path
  }

  get projectName(): string {
    return this.path ? basename(this.path, extname(this.path)) : 'Untitled'
  }

  /** What the media protocols serve. No video while the player is released for a save over the playing file. */
  media(): MediaState {
    const L = this.loaded
    return {
      video: L && !this.releasing ? L.source : null,
      proxyPath: L && !this.releasing ? L.proxyPath : null,
      framesDir: L ? L.workspace.framesDir : null
    }
  }

  rendererState(): RendererState {
    const L = this.loaded
    const st = L?.doc.state
    return {
      filePath: this.path,
      projectName: this.projectName,
      dirty: st?.dirty ?? false,
      canUndo: st?.canUndo ?? false,
      canRedo: st?.canRedo ?? false,
      project: st?.project ?? null,
      video: L ? { url: `${VIDEO_SCHEME}://current/?v=${this.version}`, pts: [...L.pts], info: { ...L.info } } : null,
      busy: this.busy ? { ...this.busy } : null
    }
  }

  // ----------------------------------------------------------------------------------------------- public operations

  newProject(): Promise<void> {
    return this.exclusive(async () => {
      if (!(await this.confirmCloseNow())) return
      await this.closeCurrent()
      this.emitState()
    })
  }

  open(path?: string): Promise<void> {
    return this.exclusive(() => this.openNow(path))
  }

  importVideo(path?: string): Promise<void> {
    return this.exclusive(() => this.importNow(path))
  }

  save(): Promise<boolean> {
    return this.exclusive(() => this.saveNow())
  }

  saveAs(): Promise<boolean> {
    return this.exclusive(() => this.saveAsNow())
  }

  /** true = the current project may be closed (nothing unsaved, saved, or the user chose to discard). */
  confirmClose(): Promise<boolean> {
    return this.exclusive(() => this.confirmCloseNow())
  }

  recoverOnStartup(): Promise<void> {
    return this.exclusive(() => this.recoverNow())
  }

  /**
   * The <video> element could not play the video: make a proxy even for an allowed codec. Ignored while the player
   * is released for a save (its requests may fail then), and once a proxy was made, cancelled or failed.
   */
  reportVideoError(): Promise<void> {
    // checked at call time: a report queued behind the save would otherwise run after `releasing` is cleared
    if (this.releasing) return Promise.resolve()
    return this.exclusive(async () => {
      const L = this.loaded
      if (!L || this.releasing) return
      if (L.proxyPath) {
        this.toast('error', 'Không phát được video này, kể cả bản proxy.')
        return
      }
      if (L.proxyTried) return
      L.proxyTried = true
      const proxy = await this.makeProxyFor(L.source, L.info)
      if (proxy && this.loaded === L) {
        L.proxyPath = proxy
        this.version++
        this.emitState()
      }
    })
  }

  execute(cmd: DocCommand): Promise<CommandResult> {
    return this.exclusive(async () => {
      const doc = this.loaded?.doc
      if (!doc) return { ok: false, reason: 'no-video', message: 'Chưa có video. Hãy dùng File > Import Video.' }
      return doc.execute(cmd)
    })
  }

  undo(): Promise<void> {
    return this.exclusive(async () => this.loaded?.doc.undo())
  }

  redo(): Promise<void> {
    return this.exclusive(async () => this.loaded?.doc.redo())
  }

  cancelBusy(): void {
    if (this.busy?.cancellable) this.abort?.abort()
  }

  /**
   * Exports the current frames. Defaults: folder of the .fbproj (Documents when unsaved) and the project name
   * ("flipbook" when unsaved); `defaultOutDir` overrides the default folder.
   */
  exportFlipbook(settings: ExportSettings, o: { documentsDir: string; defaultOutDir?: string }): Promise<ExportResponse> {
    return this.exclusive(async () => {
      const L = this.loaded
      if (!L) return { ok: false, message: 'Chưa có video.' }
      const project = L.doc.state.project
      if (project.frames.length === 0) return { ok: false, message: 'Chưa có frame nào để xuất' }
      const outDir = settings.outDir ?? o.defaultOutDir ?? (this.path ? dirname(this.path) : o.documentsDir)
      const fileName = settings.fileName ?? (this.path ? this.projectName : 'flipbook')
      try {
        const r = await this.withBusy('Đang xuất flipbook…', false, () =>
          renderFlipbook({
            projectName: this.projectName,
            video: project.video ?? L.info,
            frames: project.frames,
            readFrame: (id) => readFile(join(L.workspace.framesDir, `${id}.png`)),
            settings,
            outDir,
            fileName
          })
        )
        return { ok: true, files: [...r.pages, r.logTxt, r.logJson] }
      } catch (e) {
        return { ok: false, message: errText(e) }
      }
    })
  }

  /** Closes the project without asking (call confirmClose first): disposes the workspace. */
  dispose(): Promise<void> {
    this.abort?.abort()
    return this.exclusive(() => this.closeCurrent())
  }

  // ----------------------------------------------------------------------------------------------- implementation

  private exclusive<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job)
    this.chain = run.catch(() => undefined)
    return run
  }

  private emitState(): void {
    this.emit('state', this.rendererState())
  }

  private toast(kind: Toast['kind'], text: string): void {
    this.emit('toast', { kind, text } satisfies Toast)
  }

  private setBusy(b: BusyState | null): void {
    this.busy = b
    this.emit('progress', b)
    this.emitState()
  }

  /** Shows a busy state while `job` runs; progress updates are reported in whole percents. */
  private async withBusy<T>(label: string, cancellable: boolean, job: (progress: (f: number) => void) => Promise<T>): Promise<T> {
    let shown = -1
    this.setBusy({ label, progress: -1, cancellable })
    try {
      return await job((f) => {
        const pct = Math.floor(Math.min(1, Math.max(0, f)) * 100)
        if (pct === shown) return
        shown = pct
        this.setBusy({ label, progress: pct / 100, cancellable })
      })
    } finally {
      this.setBusy(null)
    }
  }

  private async confirmCloseNow(): Promise<boolean> {
    const L = this.loaded
    if (!L) return true
    await L.doc.idle()
    if (!L.doc.state.dirty) return true
    const a = await this.o.ask('unsaved', this.projectName)
    if (a === 'save') return this.saveNow()
    return a === 'discard'
  }

  private async closeCurrent(): Promise<void> {
    const prev = this.loaded
    this.loaded = null
    this.path = null
    this.version++
    if (prev) await this.release(prev)
  }

  /** Disposes a no longer current project (its workspace goes away). */
  private async release(prev: Loaded): Promise<void> {
    prev.doc.removeAllListeners()
    await prev.doc.idle()
    await prev.reader?.close()
    await prev.workspace.dispose()
  }

  private async switchTo(next: Loaded, path: string | null): Promise<void> {
    const prev = this.loaded
    this.loaded = next
    this.path = path
    this.version++
    next.doc.on('changed', () => {
      if (this.loaded?.doc === next.doc) this.emitState()
    })
    next.doc.on('writeError', (e: unknown) => this.toast('error', `Không ghi được thư mục làm việc: ${errText(e)}`))
    this.emitState()
    if (prev) await this.release(prev)
  }

  private async probe(source: VideoSource): Promise<{ info: VideoInfo; pts: number[] }> {
    const info = await probeVideo(source)
    const pts = await readPtsTable(source)
    if (pts.length === 0) throw new Error('Video không có frame nào.')
    return { info, pts }
  }

  /** Builds (or reuses from the cache) a playback proxy. null when cancelled or failed (a toast says why). */
  private async makeProxyFor(source: VideoSource, info: VideoInfo): Promise<string | null> {
    const ac = new AbortController()
    this.abort = ac
    try {
      const key = source.kind === 'file' ? await proxyKeyForFile(source.path) : await proxyKeyForZipEntry(source)
      const out = proxyCachePath(this.o.cacheDir, key)
      if (existsSync(out)) return out
      await mkdir(this.o.cacheDir, { recursive: true })
      await this.withBusy('Đang tạo bản phát (proxy) cho video…', true, (progress) =>
        makeProxy(source, out, { durationMs: info.durationMs, onProgress: progress, signal: ac.signal })
      )
      return out
    } catch (e) {
      if ((e as Error).name === 'AbortError') this.toast('info', 'Đã hủy tạo proxy. Video có thể không phát được.')
      else this.toast('error', `Không tạo được proxy để phát video: ${errText(e)}`)
      return null
    } finally {
      if (this.abort === ac) this.abort = null
    }
  }

  private async importNow(path?: string): Promise<void> {
    const p = path ?? (await this.o.pickVideoPath())
    if (!p) return
    const prev = this.loaded
    if (prev && (await this.o.ask('replaceVideo', basename(p))) !== 'yes') return
    const source: VideoSource = { kind: 'file', path: resolve(p) }
    let workspace: Workspace | null = null
    try {
      const { info, pts } = await this.withBusy('Đang đọc video…', false, () => this.probe(source))
      workspace = await Workspace.create(this.o.workRoot)
      const project: ProjectFile = {
        formatVersion: 1,
        video: info,
        frames: [], // frames belong to the old video
        nextSeq: 1,
        selection: null,
        exportSettings: prev ? prev.doc.state.project.exportSettings : { ...DEFAULT_EXPORT }
      }
      const doc = new ProjectDocument({ workspace, pts, video: info, source, project, extract: extractFrame, dirty: true })
      await doc.setMeta({ videoOrigin: { kind: 'file', path: source.path }, savedPath: this.path })
      const proxyPath = needsProxy(info) ? await this.makeProxyFor(source, info) : null
      await this.switchTo({ workspace, doc, source, reader: null, pts, info, proxyPath, proxyTried: needsProxy(info) }, this.path)
    } catch (e) {
      await workspace?.dispose()
      this.toast('error', `Không nhập được video: ${errText(e)}`)
    }
  }

  private async openNow(path?: string): Promise<void> {
    if (!(await this.confirmCloseNow())) return
    const p = path ?? (await this.o.pickOpenPath())
    if (!p) return
    const target = resolve(p)
    // filled as the steps succeed, so a failure can undo exactly what was done
    const got: { reader?: FbprojReader; workspace?: Workspace } = {}
    try {
      const { info, pts } = await this.withBusy('Đang mở dự án…', false, async () => {
        got.reader = await openFbproj(target)
        got.workspace = await Workspace.create(this.o.workRoot)
        await got.reader.extractFramesTo(got.workspace.framesDir)
        return this.probe(got.reader.video)
      })
      const { reader, workspace } = got as Required<typeof got>
      const doc = new ProjectDocument({ workspace, pts, video: info, source: reader.video, project: reader.project, extract: extractFrame })
      await doc.setMeta({ videoOrigin: { kind: 'fbproj', path: target }, savedPath: target })
      const proxyPath = needsProxy(info) ? await this.makeProxyFor(reader.video, info) : null
      await this.switchTo({ workspace, doc, source: reader.video, reader, pts, info, proxyPath, proxyTried: needsProxy(info) }, target)
    } catch (e) {
      await got.reader?.close()
      await got.workspace?.dispose()
      this.toast('error', `Không mở được dự án: ${errText(e)}`)
    }
  }

  private async saveNow(): Promise<boolean> {
    if (!this.loaded) return false
    return this.path ? this.writeTo(this.path) : this.saveAsNow()
  }

  private async saveAsNow(): Promise<boolean> {
    if (!this.loaded) return false
    const p = await this.o.pickSavePath()
    if (!p) return false
    let target = resolve(p)
    if (extname(target).toLowerCase() !== '.fbproj') target += '.fbproj'
    return this.writeTo(target)
  }

  /**
   * Writes a staging file next to the target, then renames it over the target. When the target is the file the
   * video plays from, the player is released and every read stream closed before the rename. Afterwards the video
   * is served from the saved file (new zip offsets) and the URL version bumps so the player reloads.
   */
  private async writeTo(target: string): Promise<boolean> {
    const L = this.loaded
    if (!L) return false
    await L.doc.idle()
    const project = L.doc.state.project
    const overwritingSource = L.source.kind === 'zipEntry' && samePath(L.source.zipPath, target)
    const staging = `${target}.saving-${randomBytes(4).toString('hex')}`
    let released = false
    let renamed = false
    try {
      await this.withBusy('Đang lưu dự án…', false, (progress) =>
        writeFbproj(staging, { project, video: L.source, framesDir: L.workspace.framesDir }, (w, t) => progress(t > 0 ? w / t : 1))
      )
      if (overwritingSource) {
        released = true
        this.releasing = true
        await this.o.releaseVideo()
        await closeVideoStreams()
        await L.reader?.close()
      }
      await renameWithRetry(staging, target)
      renamed = true
      const reader = await openFbproj(target)
      const old = L.reader
      L.reader = reader
      L.source = reader.video
      L.doc.setSource(reader.video)
      if (old && !overwritingSource) await old.close()
      this.releasing = false
      this.path = target
      this.version++
      await L.doc.markSaved()
      await L.doc.setMeta({ videoOrigin: { kind: 'fbproj', path: target }, savedPath: target })
      this.emitState()
      return true
    } catch (e) {
      if (!renamed) await rm(staging, { force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined)
      if (released) {
        this.releasing = false
        this.version++
        this.emitState()
      }
      this.toast(
        'error',
        e instanceof DiskFullError
          ? `Không đủ dung lượng đĩa: cần ${mb(e.neededBytes)} MB, còn ${mb(e.freeBytes)} MB. File cũ không bị thay đổi.`
          : `Không lưu được dự án: ${errText(e)}`
      )
      return false
    }
  }

  private async recoverNow(): Promise<void> {
    const root = this.o.workRoot
    const current = this.loaded?.workspace.dir
    const found = (await Workspace.findRecoverable(root)).filter((r) => r.dir !== current)
    const mtime = async (dir: string): Promise<number> => (await stat(join(dir, 'session.json'))).mtimeMs
    const withTime = await Promise.all(found.map(async (r) => ({ ...r, t: await mtime(r.dir) })))
    withTime.sort((a, b) => b.t - a.t)

    const pending = new Set(withTime.map((r) => r.dir))
    for (const r of withTime) {
      const name = r.meta.savedPath ? basename(r.meta.savedPath, extname(r.meta.savedPath)) : 'Untitled'
      const answer = await this.o.ask('recover', `${name} (${r.project.frames.length} frame)`)
      if (answer !== 'yes') {
        pending.delete(r.dir)
        await Workspace.adopt(r.dir).dispose()
        continue
      }
      if (await this.recoverOne(r.dir, r.meta, r.project)) {
        pending.delete(r.dir)
        break
      }
    }

    // Leftovers with nothing unsaved (or unreadable) are of no use: clear them so the work dir does not grow.
    let names: string[] = []
    try {
      names = await readdir(root)
    } catch {
      return
    }
    const keep = new Set([...pending, this.loaded?.workspace.dir].filter((d): d is string => !!d))
    for (const n of names) {
      const dir = join(root, n)
      if (!keep.has(dir)) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async recoverOne(dir: string, meta: SessionMeta, project: ProjectFile): Promise<boolean> {
    let reader: FbprojReader | null = null
    let source: VideoSource | null = null
    const origin = meta.videoOrigin
    try {
      if (origin?.kind === 'fbproj' && existsSync(origin.path)) {
        reader = await openFbproj(origin.path)
        source = reader.video
      } else if (origin?.kind === 'file' && existsSync(origin.path)) {
        source = { kind: 'file', path: origin.path }
      }
    } catch {
      source = null
    }
    if (!source) {
      const picked = await this.o.pickVideoPath()
      if (!picked) {
        this.toast('error', 'Không khôi phục được dự án vì không tìm thấy video gốc.')
        return false
      }
      source = { kind: 'file', path: resolve(picked) }
    }
    try {
      const { info, pts } = await this.withBusy('Đang khôi phục dự án…', false, () => this.probe(source))
      const workspace = Workspace.adopt(dir)
      const doc = new ProjectDocument({ workspace, pts, video: info, source, project, extract: extractFrame, dirty: true })
      const savedPath = meta.savedPath && existsSync(meta.savedPath) ? meta.savedPath : null
      await doc.setMeta({
        videoOrigin: source.kind === 'file' ? { kind: 'file', path: source.path } : { kind: 'fbproj', path: source.zipPath },
        savedPath
      })
      const proxyPath = needsProxy(info) ? await this.makeProxyFor(source, info) : null
      await this.switchTo({ workspace, doc, source, reader, pts, info, proxyPath, proxyTried: needsProxy(info) }, savedPath)
      return true
    } catch (e) {
      await reader?.close()
      this.toast('error', `Không khôi phục được dự án: ${errText(e)}`)
      return false
    }
  }
}

import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'

import type { VideoSource } from '../core/fbproj'
import { frameMs } from '../core/timing'
import { DEFAULT_EXPORT, type FrameRecord, type ProjectFile, type Rect, type VideoInfo } from '../core/types'
import type { CommandResult, DocCommand } from '../shared/commands'
import type { extractFrame } from './ffmpeg/extract'
import { FrameMismatchError } from './ffmpeg/extract'
import type { SessionMeta, Workspace } from './workspace'

export interface DocState {
  project: ProjectFile
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
}

interface HistoryEntry {
  do(): void
  undo(): void
}

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === null || b === null ? a === b : a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

const fail = (reason: Extract<CommandResult, { ok: false }>['reason'], message: string): CommandResult => ({
  ok: false,
  reason,
  message
})

/**
 * The open project. All user actions arrive as DocCommand through execute(); undoable ones go on a history stack.
 * Every state change is written to the workspace (serialized) and then 'changed' is emitted.
 * Emits 'writeError' (Error) when a workspace write fails; the in-memory change stands and the command result is unaffected.
 */
export class ProjectDocument extends EventEmitter {
  private project: ProjectFile
  private dirty = false
  private mutated = false
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private meta: Omit<SessionMeta, 'dirty'> = { videoOrigin: null, savedPath: null }
  private commandChain: Promise<unknown> = Promise.resolve()
  private writeChain: Promise<void> = Promise.resolve()

  private readonly workspace: Workspace
  private readonly pts: number[]
  private readonly video: VideoInfo
  private source: VideoSource
  private readonly extract: typeof extractFrame
  private readonly newId: () => string

  constructor(o: {
    workspace: Workspace
    pts: number[]
    video: VideoInfo
    source: VideoSource
    project?: ProjectFile
    extract: typeof extractFrame
    newId?: () => string
    /** Start dirty (imported video, recovered session). */
    dirty?: boolean
  }) {
    super()
    this.dirty = o.dirty === true
    this.workspace = o.workspace
    this.pts = o.pts
    this.video = o.video
    this.source = o.source
    this.extract = o.extract
    this.newId = o.newId ?? (() => randomUUID())
    this.project = structuredClone(
      o.project ?? {
        formatVersion: 1,
        video: o.video,
        frames: [],
        nextSeq: 1,
        selection: null,
        exportSettings: { ...DEFAULT_EXPORT }
      }
    )
  }

  /** A deep copy: mutating it never touches the document. */
  get state(): DocState {
    return {
      project: structuredClone(this.project),
      dirty: this.dirty,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0
    }
  }

  /** Sets the session metadata (video origin, saved path) written to session.json; resolves once persisted. */
  setMeta(meta: Omit<SessionMeta, 'dirty'>): Promise<void> {
    this.meta = { ...meta }
    return this.persist()
  }

  /** Where captures read the video from; changes when a save moves the video into a (new) .fbproj. */
  setSource(source: VideoSource): void {
    this.source = source
  }

  /** Commands run strictly one at a time, in call order. */
  execute(cmd: DocCommand): Promise<CommandResult> {
    return this.enqueue(() => this.run(cmd))
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.commandChain.then(job)
    this.commandChain = run.catch(() => undefined)
    return run
  }

  /** Undo/redo/markSaved are queued behind in-flight commands, so they apply in call order. */
  undo(): Promise<void> {
    return this.enqueue(async () => {
      const e = this.undoStack.pop()
      if (!e) return
      e.undo()
      this.redoStack.push(e)
      this.dirty = true
      await this.persistSafe()
    })
  }

  redo(): Promise<void> {
    return this.enqueue(async () => {
      const e = this.redoStack.pop()
      if (!e) return
      e.do()
      this.undoStack.push(e)
      this.dirty = true
      await this.persistSafe()
    })
  }

  markSaved(): Promise<void> {
    return this.enqueue(async () => {
      this.dirty = false
      await this.persistSafe()
    })
  }

  /** Resolves when all queued commands and workspace writes have finished. */
  async idle(): Promise<void> {
    await this.commandChain
    await this.writeChain
  }

  // ---------------------------------------------------------------------------------------------

  private async run(cmd: DocCommand): Promise<CommandResult> {
    this.mutated = false
    const result = await this.apply(cmd)
    if (result.ok && this.mutated) {
      this.dirty = true
      await this.persistSafe()
    }
    return result
  }

  private async apply(cmd: DocCommand): Promise<CommandResult> {
    switch (cmd.type) {
      case 'captureFrame':
        return this.capture(cmd.frameIndex, cmd.useSelection)
      case 'deleteFrame': {
        const index = this.project.frames.findIndex((f) => f.id === cmd.id)
        if (index < 0) return this.notFound(cmd.id)
        const frame = this.project.frames[index]
        this.record({
          do: () => this.project.frames.splice(index, 1),
          undo: () => this.project.frames.splice(index, 0, frame)
        })
        return { ok: true }
      }
      case 'renameFrame': {
        const frame = this.project.frames.find((f) => f.id === cmd.id)
        if (!frame) return this.notFound(cmd.id)
        const next = cmd.baseName === null || cmd.baseName.trim() === '' ? null : cmd.baseName
        const prev = frame.baseName
        if (next === prev) return { ok: true }
        this.record({
          do: () => void (frame.baseName = next),
          undo: () => void (frame.baseName = prev)
        })
        return { ok: true }
      }
      case 'setCrop': {
        const frame = this.project.frames.find((f) => f.id === cmd.id)
        if (!frame) return this.notFound(cmd.id)
        const next = cmd.crop ? { ...cmd.crop } : null
        const prev = frame.crop
        if (sameRect(next, prev)) return { ok: true }
        this.record({
          do: () => void (frame.crop = next),
          undo: () => void (frame.crop = prev)
        })
        return { ok: true }
      }
      case 'setSelection':
        this.project.selection = cmd.rect ? { ...cmd.rect } : null
        this.mutated = true
        return { ok: true }
      case 'setExportSettings':
        this.project.exportSettings = { ...cmd.settings }
        this.mutated = true
        return { ok: true }
    }
  }

  private async capture(frameIndex: number, useSelection: boolean): Promise<CommandResult> {
    if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= this.pts.length) {
      return fail('not-found', `Không có frame số ${frameIndex} trong video.`)
    }
    if (useSelection && this.project.selection === null) {
      return fail('no-selection', 'Hãy kéo chuột trên video để vẽ vùng trước khi bấm Ctrl+T.')
    }
    const region = useSelection && this.project.selection ? { ...this.project.selection } : null
    const ptsSec = this.pts[frameIndex]
    if (this.project.frames.some((f) => f.ptsSec === ptsSec && sameRect(f.region, region))) {
      return fail('duplicate', 'Frame này (cùng vùng) đã được chụp rồi.')
    }

    const id = this.newId()
    try {
      await this.extract(this.source, ptsSec, this.video.startTimeSec, region, join(this.workspace.framesDir, `${id}.png`))
    } catch (e) {
      if (e instanceof FrameMismatchError) return fail('mismatch', e.message)
      throw e
    }

    const frame: FrameRecord = {
      id,
      ptsSec,
      ms: frameMs(this.pts, frameIndex),
      seq: this.project.nextSeq,
      baseName: null,
      region,
      crop: null
    }
    // Undo drops the record only: the PNG stays so Redo can bring the frame back. nextSeq is not reused.
    this.record({
      do: () => this.project.frames.push(frame),
      undo: () => {
        const i = this.project.frames.findIndex((f) => f.id === id)
        if (i >= 0) this.project.frames.splice(i, 1)
      }
    })
    this.project.nextSeq = frame.seq + 1
    return { ok: true, frameId: id }
  }

  private notFound(id: string): CommandResult {
    return fail('not-found', `Không tìm thấy frame ${id}.`)
  }

  /** Performs a new undoable change and clears Redo. */
  private record(entry: HistoryEntry): void {
    entry.do()
    this.undoStack.push(entry)
    this.redoStack = []
    this.mutated = true
  }

  /** Persists; a failed write is reported via 'writeError' and never changes a command's result. */
  private async persistSafe(): Promise<void> {
    try {
      await this.persist()
    } catch (e) {
      this.emit('writeError', e)
    }
  }

  /** Queues a workspace write of the current state (writes never interleave), then emits 'changed'. */
  private persist(): Promise<void> {
    const job = this.writeChain.then(async () => {
      await this.workspace.write(structuredClone(this.project), { ...this.meta, dirty: this.dirty })
      this.emit('changed')
    })
    this.writeChain = job.catch(() => undefined)
    return job
  }
}

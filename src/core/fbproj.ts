import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import yauzl from 'yauzl'
import yazl from 'yazl'

import type { ProjectFile } from './types'

export type VideoSource =
  | { kind: 'file'; path: string }
  // start/end are byte offsets of the stored entry inside the zip; end is exclusive (matches ffmpeg subfile `end`)
  | { kind: 'zipEntry'; zipPath: string; start: number; end: number; fileName: string }

/** The `-i` argument ffmpeg/ffprobe needs to read this source. */
export function ffmpegInput(src: VideoSource): string {
  return src.kind === 'file' ? src.path : `subfile,,start,${src.start},end,${src.end},,:${src.zipPath}`
}

// ---------------------------------------------------------------------------------------------
// .fbproj = zip with every entry stored (no compression): project.json, video/<name>, frames/<id>.png.
// The reader never keeps a file handle open between calls, so the file can be replaced (Windows
// rename-over) while a project is open; every read is a fresh ranged stream on the zip file.
// ---------------------------------------------------------------------------------------------

const SLACK_BYTES = 10 * 1024 * 1024
const ZIP64_THRESHOLD = 0xffffffff
const LOCAL_HEADER_SIZE = 30
const LOCAL_HEADER_SIG = 0x04034b50

const mb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1)

export class DiskFullError extends Error {
  constructor(
    public neededBytes: number,
    public freeBytes: number
  ) {
    super(`Không đủ dung lượng ổ đĩa để lưu dự án: cần ${mb(neededBytes)} MB, còn trống ${mb(freeBytes)} MB.`)
    this.name = 'DiskFullError'
  }
}

export class InvalidProjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidProjectError'
  }
}

export interface FbprojReader {
  path: string
  project: ProjectFile
  video: VideoSource & { kind: 'zipEntry' }
  readFrame(id: string): Promise<Buffer>
  extractFramesTo(dir: string): Promise<void>
  /** Absolute byte offsets inside the zip file, both inclusive. */
  openVideoRange(start: number, endInclusive: number): Readable
  close(): Promise<void>
}

interface RawEntry {
  name: string
  headerOffset: number
  size: number
}

interface StoredEntry {
  name: string
  start: number // absolute offset of the entry data in the zip file
  size: number
}

function listEntries(path: string): Promise<RawEntry[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err) {
        // system errors (ENOENT, EACCES...) pass through; everything else means "not a zip"
        const code = (err as NodeJS.ErrnoException).code
        return reject(code ? err : new InvalidProjectError('Tệp không phải là dự án Flipbook hợp lệ (không phải tệp zip).'))
      }
      const out: RawEntry[] = []
      zip.on('error', (e) => reject(new InvalidProjectError(`Tệp dự án bị hỏng: ${e.message}`)))
      zip.on('entry', (e: yauzl.Entry) => {
        if (e.fileName.endsWith('/')) return zip.readEntry()
        if (e.compressionMethod !== 0) {
          zip.close()
          return reject(new InvalidProjectError(`Tệp dự án không hợp lệ: mục "${e.fileName}" bị nén.`))
        }
        out.push({ name: e.fileName, headerOffset: e.relativeOffsetOfLocalHeader, size: e.uncompressedSize })
        zip.readEntry()
      })
      zip.on('end', () => resolve(out)) // autoClose releases the handle
      zip.readEntry()
    })
  })
}

async function resolveData(fh: fs.promises.FileHandle, e: RawEntry): Promise<StoredEntry> {
  const buf = Buffer.alloc(LOCAL_HEADER_SIZE)
  const { bytesRead } = await fh.read(buf, 0, LOCAL_HEADER_SIZE, e.headerOffset)
  if (bytesRead < LOCAL_HEADER_SIZE || buf.readUInt32LE(0) !== LOCAL_HEADER_SIG) {
    throw new InvalidProjectError(`Tệp dự án bị hỏng: không đọc được header của "${e.name}".`)
  }
  // lengths must come from the LOCAL header; the central directory copies may differ
  const nameLen = buf.readUInt16LE(26)
  const extraLen = buf.readUInt16LE(28)
  return { name: e.name, start: e.headerOffset + LOCAL_HEADER_SIZE + nameLen + extraLen, size: e.size }
}

/** Destroys a stream and resolves once its underlying resource is closed. */
function destroyAndWait(s: Readable | fs.WriteStream): Promise<void> {
  if (s.closed) return Promise.resolve()
  return new Promise((resolve) => {
    s.once('close', () => resolve())
    s.destroy()
  })
}

export async function openFbproj(path: string): Promise<FbprojReader> {
  const raw = await listEntries(path)
  const fh = await fs.promises.open(path, 'r')
  let entries: StoredEntry[]
  try {
    entries = await Promise.all(raw.map((e) => resolveData(fh, e)))
  } finally {
    await fh.close()
  }
  const byName = new Map(entries.map((e) => [e.name, e]))

  const open = new Set<Readable>()
  const rangeStream = (start: number, endInclusive: number): Readable => {
    const s = fs.createReadStream(path, { start, end: endInclusive })
    open.add(s)
    s.once('close', () => open.delete(s))
    return s
  }
  const entryStream = (e: StoredEntry): Readable => rangeStream(e.start, e.start + e.size - 1)
  const readEntryBuffer = async (e: StoredEntry): Promise<Buffer> => {
    if (e.size === 0) return Buffer.alloc(0)
    const chunks: Buffer[] = []
    for await (const c of entryStream(e)) chunks.push(c as Buffer)
    return Buffer.concat(chunks)
  }

  const projectEntry = byName.get('project.json')
  if (!projectEntry) throw new InvalidProjectError('Tệp không phải là dự án Flipbook hợp lệ (thiếu project.json).')
  let project: ProjectFile
  try {
    project = JSON.parse((await readEntryBuffer(projectEntry)).toString('utf8')) as ProjectFile
  } catch {
    throw new InvalidProjectError('Tệp dự án bị hỏng: không đọc được project.json.')
  }
  if (project?.formatVersion !== 1) {
    throw new InvalidProjectError(
      `Phiên bản định dạng dự án không được hỗ trợ (${String(project?.formatVersion)}); ứng dụng chỉ mở được phiên bản 1.`
    )
  }
  const videoEntry = entries.find((e) => e.name.startsWith('video/') && e.name.length > 'video/'.length)
  if (!videoEntry) throw new InvalidProjectError('Tệp dự án không hợp lệ: thiếu video.')

  return {
    path,
    project,
    video: {
      kind: 'zipEntry',
      zipPath: path,
      start: videoEntry.start,
      end: videoEntry.start + videoEntry.size,
      fileName: videoEntry.name.slice('video/'.length)
    },
    async readFrame(id) {
      const e = byName.get(`frames/${id}.png`)
      if (!e) throw new InvalidProjectError(`Tệp dự án không có ảnh cho frame "${id}".`)
      return readEntryBuffer(e)
    },
    async extractFramesTo(dir) {
      await fs.promises.mkdir(dir, { recursive: true })
      for (const e of entries) {
        if (!e.name.startsWith('frames/')) continue
        const out = fs.createWriteStream(join(dir, e.name.slice('frames/'.length)))
        if (e.size === 0) {
          out.end()
          await new Promise((res, rej) => out.on('finish', res).on('error', rej))
        } else await pipeline(entryStream(e), out)
      }
    },
    openVideoRange: (start, endInclusive) => rangeStream(start, endInclusive),
    async close() {
      // wait for every fd to be released so a following rename-over is not racing a handle
      await Promise.all([...open].map((s) => destroyAndWait(s)))
      open.clear()
    }
  }
}

export async function writeFbproj(
  target: string,
  a: { project: ProjectFile; video: VideoSource; framesDir: string },
  onProgress?: (written: number, total: number) => void,
  /** Internal/test only: force ZIP64 structures on every entry and the end record. */
  opts?: { forceZip64?: boolean }
): Promise<void> {
  const dir = dirname(target)
  const projectJson = Buffer.from(JSON.stringify(a.project), 'utf8')

  let videoSize: number
  let videoName: string
  let videoStream: () => Readable
  if (a.video.kind === 'file') {
    const p = a.video.path
    videoSize = (await fs.promises.stat(p)).size
    videoName = basename(p)
    videoStream = () => fs.createReadStream(p)
  } else {
    const { zipPath, start, end } = a.video
    videoSize = end - start
    videoName = a.video.fileName
    videoStream = () => fs.createReadStream(zipPath, { start, end: end - 1 })
  }
  const frames = await Promise.all(
    a.project.frames.map(async (f) => {
      const p = join(a.framesDir, `${f.id}.png`)
      return { id: f.id, path: p, size: (await fs.promises.stat(p)).size }
    })
  )

  const total = projectJson.length + videoSize + frames.reduce((s, f) => s + f.size, 0)
  const needed = total + SLACK_BYTES
  const st = await fs.promises.statfs(dir)
  const free = Number(st.bavail) * Number(st.bsize)
  if (free < needed) throw new DiskFullError(needed, free)

  const tmp = `${target}.tmp-${randomBytes(6).toString('hex')}`
  const forceZip64 = opts?.forceZip64 === true
  const sources = new Set<Readable>()
  const sink = fs.createWriteStream(tmp)
  try {
    let written = 0
    const tick = (n: number): void => {
      written += n
      onProgress?.(written, total)
    }
    const zip = new yazl.ZipFile()
    const out = zip.outputStream as unknown as Readable
    zip.on('error', (e) => out.destroy(e))

    const addLazy = (name: string, size: number, open: () => Readable, force = false): void => {
      zip.addReadStreamLazy(name, { compress: false, size, forceZip64Format: force || forceZip64 }, (cb) => {
        const s = open()
        sources.add(s)
        s.once('close', () => sources.delete(s))
        s.on('error', (e) => out.destroy(e))
        s.on('data', (c: Buffer | string) => tick(c.length))
        cb(null, s)
      })
    }
    zip.addBuffer(projectJson, 'project.json', { compress: false })
    tick(projectJson.length)
    addLazy(`video/${videoName}`, videoSize, videoStream, videoSize >= ZIP64_THRESHOLD)
    for (const f of frames) addLazy(`frames/${f.id}.png`, f.size, () => fs.createReadStream(f.path))
    zip.end({ forceZip64Format: forceZip64, comment: '' })

    await pipeline(out, sink)
    // flush to disk before the rename makes this file the project
    const fh = await fs.promises.open(tmp, 'r+')
    try {
      await fh.sync()
    } finally {
      await fh.close()
    }
    await fs.promises.rename(tmp, target)
  } catch (err) {
    // release every handle first (Windows cannot delete a file that is still open), then remove the temp
    await Promise.all([...sources, sink].map((s) => destroyAndWait(s)))
    try {
      await fs.promises.rm(tmp, { force: true, maxRetries: 5, retryDelay: 50 })
    } catch (cleanupErr) {
      throw new Error(`Không xóa được tệp tạm "${tmp}" sau khi lưu thất bại: ${String(cleanupErr)}`, { cause: err })
    }
    throw err
  }
}

import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'

import { protocol } from 'electron'

import type { VideoSource } from '../core/fbproj'

// fbvideo://current/?v=<n>  → the current video (proxy if any, else the source file or the stored zip entry)
// fbwork://frames/<id>.png  → captured frame PNG from the workspace frames dir

export const VIDEO_SCHEME = 'fbvideo'
export const WORK_SCHEME = 'fbwork'

export interface ServeResult<B> {
  status: number
  headers: Record<string, string>
  body: B | null
}

/** Single byte range of a `Range` header. null = no/empty header (serve everything); 'invalid' = 416. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
  if (header === null || header.trim() === '') return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '') || size <= 0) return 'invalid'
  if (m[1] === '') {
    const n = Number(m[2])
    if (n === 0) return 'invalid'
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(m[1])
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  if (start >= size || start > end) return 'invalid'
  return { start, end }
}

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime'
}

export function contentTypeFor(name: string): string {
  return TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'
}

// Every stream handed out for video is tracked, so a save can close them all before renaming over the file.
const openStreams = new Set<Readable>()

/** Destroys every video stream still open and resolves once their file handles are closed. */
export async function closeVideoStreams(): Promise<void> {
  await Promise.all(
    [...openStreams].map(
      (s) =>
        new Promise<void>((resolve) => {
          if (s.closed) return resolve()
          s.once('close', () => resolve())
          s.destroy()
        })
    )
  )
  openStreams.clear()
}

/** Response for a video request: 200 whole file, 206 for a range, 416 for an unsatisfiable range. */
export async function serveVideo(source: VideoSource, rangeHeader: string | null): Promise<ServeResult<Readable>> {
  let path: string
  let base: number
  let size: number
  let name: string
  if (source.kind === 'file') {
    path = source.path
    base = 0
    size = (await stat(path)).size
    name = path
  } else {
    path = source.zipPath
    base = source.start
    size = source.end - source.start
    name = source.fileName
  }
  const headers: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentTypeFor(name),
    'Access-Control-Allow-Origin': '*'
  }
  const range = parseRange(rangeHeader, size)
  if (range === 'invalid') {
    return { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` }, body: null }
  }
  const { start, end } = range ?? { start: 0, end: size - 1 }
  const length = end - start + 1
  headers['Content-Length'] = String(length)
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  let body: Readable
  if (length <= 0) body = Readable.from([])
  else {
    body = createReadStream(path, { start: base + start, end: base + end })
    openStreams.add(body)
    body.once('close', () => openStreams.delete(body))
  }
  return { status: range ? 206 : 200, headers, body }
}

const FRAME_PATH = /^\/([A-Za-z0-9_-]+)\.png$/

/** Response for fbwork://frames<pathname>: a PNG from the workspace frames dir. */
export async function serveFrame(framesDir: string | null, pathname: string): Promise<ServeResult<Buffer>> {
  const m = FRAME_PATH.exec(pathname)
  if (!framesDir || !m) return { status: 404, headers: {}, body: null }
  try {
    const data = await readFile(join(framesDir, `${m[1]}.png`))
    return { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' }, body: data }
  } catch {
    return { status: 404, headers: {}, body: null }
  }
}

/** Must run before app 'ready'. */
export function registerMediaSchemes(): void {
  const privileges = { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true }
  protocol.registerSchemesAsPrivileged([
    { scheme: VIDEO_SCHEME, privileges },
    { scheme: WORK_SCHEME, privileges }
  ])
}

export interface MediaState {
  video: VideoSource | null
  proxyPath: string | null
  framesDir: string | null
}

export function installMediaHandlers(get: () => MediaState): void {
  protocol.handle(VIDEO_SCHEME, async (req) => {
    const { video, proxyPath } = get()
    const source: VideoSource | null = proxyPath ? { kind: 'file', path: proxyPath } : video
    if (!source) return new Response(null, { status: 404 })
    try {
      const r = await serveVideo(source, req.headers.get('range'))
      const body = r.body ? (Readable.toWeb(r.body) as ReadableStream<Uint8Array>) : null
      return new Response(body, { status: r.status, headers: r.headers })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
  protocol.handle(WORK_SCHEME, async (req) => {
    const url = new URL(req.url)
    if (url.hostname !== 'frames') return new Response(null, { status: 404 })
    const r = await serveFrame(get().framesDir, url.pathname)
    return new Response(r.body ? new Uint8Array(r.body) : null, { status: r.status, headers: r.headers })
  })
}

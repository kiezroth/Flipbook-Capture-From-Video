import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { rename, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { ffmpegInput, type VideoSource } from '../../core/fbproj'
import { ffmpegPaths } from './paths'

const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex')

export function proxyCachePath(cacheDir: string, key: string): string {
  return join(cacheDir, `${key}.mp4`)
}

/** Cache key for a plain video file: absolute path + size + mtime, so editing/replacing the file invalidates it. */
export async function proxyKeyForFile(path: string): Promise<string> {
  const abs = resolve(path)
  const st = await stat(abs)
  return sha1(`file\0${abs}\0${st.size}\0${st.mtimeMs}`)
}

/** Cache key for a video stored inside a .fbproj: zip path + entry byte range + zip mtime. */
export async function proxyKeyForZipEntry(src: VideoSource & { kind: 'zipEntry' }): Promise<string> {
  const abs = resolve(src.zipPath)
  const st = await stat(abs)
  return sha1(`zip\0${abs}\0${src.start}\0${src.end}\0${st.mtimeMs}`)
}

function abortError(): Error {
  const e = new Error('Đã hủy tạo proxy (aborted).')
  e.name = 'AbortError'
  return e
}

export interface ProxyOptions {
  durationMs: number
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/**
 * Transcodes `src` to an H.264 mp4 at `out` for Chromium playback. `-copyts` + `-fps_mode passthrough` keep the
 * source PTS (no frame dropped/duplicated), so the player's frame mapping stays exact. `-enc_time_base demux` is
 * required too: without it ffmpeg re-times VFR frames onto a 1/framerate grid (e.g. 0.132 -> 0.1334) even with
 * passthrough. Written to a temp file and
 * renamed on success; on failure or abort nothing is left behind.
 */
export async function makeProxy(src: VideoSource, out: string, o: ProxyOptions): Promise<void> {
  if (o.signal?.aborted) throw abortError()
  const file = ffmpegPaths().ffmpeg
  // keep the .mp4 extension so ffmpeg infers the muxer
  const tmp = `${out}.tmp-${randomBytes(6).toString('hex')}.mp4`
  const args = [
    '-v', 'error', '-copyts', '-i', ffmpegInput(src), '-map', '0:v:0', '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-fps_mode', 'passthrough', '-enc_time_base', 'demux', '-progress', 'pipe:1', '-y', tmp
  ]
  const totalUs = Math.max(1, o.durationMs * 1000)
  let last = -1
  const report = (f: number): void => {
    const v = Math.min(1, Math.max(0, last, f))
    if (v === last) return
    last = v
    o.onProgress?.(v)
  }

  try {
    await new Promise<void>((resolveP, rejectP) => {
      const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let stderr = ''
      let buf = ''
      let aborted = false
      let settled = false
      const onAbort = (): void => {
        aborted = true
        child.kill()
      }
      o.signal?.addEventListener('abort', onAbort, { once: true })
      const done = (err?: Error): void => {
        if (settled) return
        settled = true
        o.signal?.removeEventListener('abort', onAbort)
        if (err) rejectP(err)
        else resolveP()
      }
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (d: string) => {
        stderr = (stderr + d).slice(-8192)
      })
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (d: string) => {
        buf += d
        const lines = buf.split(/\r?\n/)
        buf = lines.pop() ?? ''
        for (const line of lines) {
          // out_time_ms is also in microseconds (ffmpeg quirk); prefer out_time_us
          const m = /^out_time_(?:us|ms)=(-?\d+)/.exec(line)
          if (m && !aborted) report(Number(m[1]) / totalUs)
        }
      })
      child.on('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code
        done(
          code === 'ENOENT' || code === 'EACCES'
            ? new Error(`Không chạy được ffmpeg (${file}): ${err.message}`)
            : new Error(`ffmpeg lỗi: ${err.message}`)
        )
      })
      // 'close' fires after the process has exited and stdio is drained
      child.on('close', (code) => {
        if (aborted || o.signal?.aborted) done(abortError())
        else if (code === 0) done()
        else done(new Error(`ffmpeg lỗi: ${stderr.trim() || `mã thoát ${code}`}`))
      })
      if (o.signal?.aborted) onAbort()
    })
    await rename(tmp, out)
    report(1)
  } catch (e) {
    await rm(tmp, { force: true, maxRetries: 5, retryDelay: 100 })
    throw e
  }
}

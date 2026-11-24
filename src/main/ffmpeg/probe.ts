import { execFile } from 'node:child_process'
import { basename } from 'node:path'

import { ffmpegInput, type VideoSource } from '../../core/fbproj'
import type { VideoInfo } from '../../core/types'
import { ffmpegPaths } from './paths'

const PROXY_FREE_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1'])

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // execFile = argument array, no shell, so Unicode paths pass through intact
    execFile(file, args, { maxBuffer: 256 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code
        // ENOENT/EACCES: ffprobe itself could not be launched (not an unreadable input)
        if (code === 'ENOENT' || code === 'EACCES') {
          reject(Object.assign(new Error(`Không chạy được ffprobe (${file}): ${err.message}`), { spawnFailed: true }))
        } else reject(new Error(`ffprobe lỗi: ${stderr.trim() || err.message}`))
      }
      else resolve(stdout)
    })
  })
}

function rate(s: string | undefined): number {
  if (!s) return 0
  const [n, d] = s.split('/').map(Number)
  return d ? n / d : n
}

interface ProbeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
  side_data_list?: { rotation?: number }[]
}

/**
 * Display Matrix rotation, normalized to 0/90/180/270.
 * Empirical (ffmpeg 9): `-display_rotation 90` (counter-clockwise, per ffmpeg docs) is reported by ffprobe
 * as `rotation=90` and ffmpeg's autorotate turns the frame 90 degrees counter-clockwise. We keep ffprobe's
 * sign convention: a file reporting rotation -90 is normalized to 270.
 */
function normalizeRotation(s: ProbeStream): 0 | 90 | 180 | 270 {
  const raw = s.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ?? 0
  const deg = ((Math.round(raw) % 360) + 360) % 360
  return (deg === 90 || deg === 180 || deg === 270 ? deg : 0) as 0 | 90 | 180 | 270
}

/**
 * Parses `ffprobe -show_entries packet=pts_time,flags -of csv=p=0` output: packets flagged discard (`D`, e.g. the
 * packets before the start of an MP4 edit list) are dropped because the decoder never outputs them. Ascending,
 * duplicates removed.
 */
export function parsePtsTable(out: string): number[] {
  const nums: number[] = []
  for (const line of out.split(/\r?\n/)) {
    const [pts = '', flags = ''] = line.trim().split(',')
    if (pts === '' || pts === 'N/A' || flags.includes('D')) continue
    const n = Number(pts)
    if (Number.isFinite(n)) nums.push(n)
  }
  nums.sort((a, b) => a - b)
  return nums.filter((n, i) => i === 0 || n !== nums[i - 1])
}

/** pts_time of every decodable packet of the first video stream, ascending, duplicates removed. */
export async function readPtsTable(src: VideoSource): Promise<number[]> {
  const out = await run(ffmpegPaths().ffprobe, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', '-i', ffmpegInput(src)
  ])
  return parsePtsTable(out)
}

/** Stream info and the PTS table, which the info's frameCount and isVfr are computed from (one packet scan). */
export async function probeVideoWithPts(src: VideoSource): Promise<{ info: VideoInfo; pts: number[] }> {
  let raw: string
  try {
    raw = await run(ffmpegPaths().ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', '-i', ffmpegInput(src)])
  } catch (e) {
    if ((e as { spawnFailed?: boolean }).spawnFailed) throw e
    throw new Error(`Tệp này không phải video hoặc không đọc được (no video stream). ${(e as Error).message}`)
  }
  const json = JSON.parse(raw) as { streams?: ProbeStream[]; format?: { duration?: string; start_time?: string } }
  const s = json.streams?.find((x) => x.codec_type === 'video')
  if (!s) throw new Error('Tệp này không phải video (no video stream).')

  const rotation = normalizeRotation(s)
  const swap = rotation === 90 || rotation === 270
  const pts = await readPtsTable(src)
  let gapsVary = false
  for (let i = 2; i < pts.length && !gapsVary; i++) {
    gapsVary = Math.abs(pts[i] - pts[i - 1] - (pts[1] - pts[0])) * 1000 > 1
  }
  const fps = rate(s.avg_frame_rate)
  const fileName = src.kind === 'file' ? basename(src.path) : src.fileName
  const info: VideoInfo = {
    fileName,
    codec: s.codec_name ?? '',
    width: (swap ? s.height : s.width) ?? 0,
    height: (swap ? s.width : s.height) ?? 0,
    rotation,
    fps,
    isVfr: gapsVary || rate(s.r_frame_rate) !== fps,
    durationMs: Math.round(Number(json.format?.duration ?? 0) * 1000),
    frameCount: pts.length,
    startTimeSec: Number(json.format?.start_time ?? 0)
  }
  return { info, pts }
}

export async function probeVideo(src: VideoSource): Promise<VideoInfo> {
  return (await probeVideoWithPts(src)).info
}

export function needsProxy(info: VideoInfo): boolean {
  return !PROXY_FREE_CODECS.has(info.codec)
}

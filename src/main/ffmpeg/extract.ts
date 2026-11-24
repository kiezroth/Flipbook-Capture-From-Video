import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { rename, rm } from 'node:fs/promises'

import { ffmpegInput, type VideoSource } from '../../core/fbproj'
import type { Rect } from '../../core/types'
import { ffmpegPaths } from './paths'

const TOLERANCE_SEC = 0.0005
const SEEK_MARGIN_SEC = 3

export class FrameMismatchError extends Error {
  constructor(
    public expectedSec: number,
    public gotSec: number | null
  ) {
    super(
      gotSec === null
        ? `Không trích được frame tại ${expectedSec}s (ffmpeg không trả về frame nào).`
        : `Frame trích được lệch: cần ${expectedSec}s, nhận ${gotSec}s.`
    )
    this.name = 'FrameMismatchError'
  }
}

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const file = ffmpegPaths().ffmpeg
    // execFile = argument array, no shell, so Unicode paths pass through intact
    execFile(file, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, _stdout, stderr) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'EACCES') {
          reject(new Error(`Không chạy được ffmpeg (${file}): ${err.message}`))
        } else reject(new Error(`ffmpeg lỗi: ${stderr.trim() || err.message}`))
      } else resolve(stderr)
    })
  })
}

const num = (n: number): string => n.toFixed(6)

/**
 * Extracts exactly the frame whose pts is `ptsSec` as a PNG. `region` is in rotated (display) coordinates
 * because ffmpeg autorotates before the filter chain. The PTS ffmpeg reports for the output frame is checked
 * against `ptsSec`; on mismatch nothing is left at `outPng` and FrameMismatchError is thrown.
 */
export async function extractFrame(
  src: VideoSource,
  ptsSec: number,
  startTimeSec: number,
  region: Rect | null,
  outPng: string
): Promise<void> {
  // With -copyts, input -ss is still relative to the container start_time, hence the subtraction.
  const seek = Math.max(0, ptsSec - startTimeSec - SEEK_MARGIN_SEC)
  let vf = `select='gte(t\,${num(ptsSec - 0.0001)})',showinfo`
  if (region) {
    vf += `,crop=${Math.round(region.w)}:${Math.round(region.h)}:${Math.round(region.x)}:${Math.round(region.y)}`
  }
  const tmp = `${outPng}.tmp-${randomBytes(6).toString('hex')}.png`
  try {
    const log = await runFfmpeg([
      '-v', 'info', '-hide_banner', '-copyts', '-ss', num(seek), '-i', ffmpegInput(src),
      '-vf', vf, '-frames:v', '1', '-y', tmp
    ])
    // showinfo can print more than one line even with -frames:v 1; the first one is the frame written
    const m = /pts_time:\s*(-?[\d.]+)/.exec(log)
    const got = m ? Number(m[1]) : null
    if (got === null || !Number.isFinite(got) || Math.abs(got - ptsSec) > TOLERANCE_SEC) {
      throw new FrameMismatchError(ptsSec, got !== null && Number.isFinite(got) ? got : null)
    }
    await rename(tmp, outPng)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}

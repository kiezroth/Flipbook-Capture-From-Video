import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { extname, resolve } from 'node:path'

import { ffmpegPaths } from '../src/main/ffmpeg/paths'

const genDir = resolve(__dirname, '..', 'test', 'fixtures', 'gen')

// 640x360 gray frames; the top eighth of the picture holds 8 cells encoding the frame index N in binary
// (cell b is white when bit b of N is set), plus the frame number drawn as text.
const BASE_FILTER =
  "geq=lum='if(lt(Y,H/4),255*mod(floor(N/pow(2,floor(X*8/W))),2),64)':cb=128:cr=128," +
  "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='%{frame_num}':x=20:y=H/2:fontsize=96:fontcolor=white"
const SRC = ['-f', 'lavfi', '-i', 'color=c=0x404040:s=640x360:r=30:d=3']

/** Runs ffmpeg writing to `<name>.tmp.<ext>`, then renames to `final`; the tmp file is removed on failure. */
function ffmpeg(args: string[], final: string): void {
  const tmp = final.slice(0, -extname(final).length) + '.tmp' + extname(final)
  rmSync(tmp, { force: true })
  try {
    execFileSync(ffmpegPaths().ffmpeg, ['-y', '-v', 'error', ...args, tmp], { stdio: 'inherit' })
    renameSync(tmp, final)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}

/** Generates any missing fixture videos into test/fixtures/gen/. Existing files are kept. */
export function makeFixtures(): void {
  mkdirSync(genDir, { recursive: true })
  const out = (name: string): string => resolve(genDir, name)
  const missing = (name: string): boolean => !existsSync(out(name))

  if (missing('cfr30.mp4')) {
    ffmpeg([...SRC, '-vf', `format=yuv420p,${BASE_FILTER}`, '-c:v', 'libx264', '-bf', '0', '-g', '30', '-crf', '12'], out('cfr30.mp4'))
  }
  if (missing('offset_bframes.mp4')) {
    ffmpeg(
      [
        ...SRC,
        '-vf', `format=yuv420p,${BASE_FILTER}`,
        '-c:v', 'libx264', '-bf', '3', '-g', '30', '-crf', '12', '-output_ts_offset', '1.5'
      ],
      out('offset_bframes.mp4')
    )
  }
  if (missing('vfr.mp4')) {
    ffmpeg(
      [
        ...SRC,
        '-vf', `settb=1/1000,setpts='(N*33+mod(N\\,4)*7)/1000/TB',format=yuv420p,${BASE_FILTER}`,
        '-fps_mode', 'passthrough', '-enc_time_base', '1/1000', '-frames:v', '60',
        '-c:v', 'libx264', '-bf', '0', '-g', '30', '-crf', '12', '-video_track_timescale', '1000'
      ],
      out('vfr.mp4')
    )
  }
  if (missing('rotated.mp4')) {
    ffmpeg(['-display_rotation', '90', '-i', out('cfr30.mp4'), '-c', 'copy'], out('rotated.mp4'))
  }
  if (missing('trimmed.mp4')) {
    // Stream copy from a non-keyframe point: the mp4 gets an edit list and the packets before the cut point are
    // flagged discard (negative pts); the decodable frames start at pts 0.
    ffmpeg(['-ss', '1.1', '-i', out('cfr30.mp4'), '-c', 'copy'], out('trimmed.mp4'))
  }
  if (missing('hevc.mkv')) {
    ffmpeg([...SRC, '-vf', `format=yuv420p,${BASE_FILTER}`, '-c:v', 'libx265', '-crf', '12'], out('hevc.mkv'))
  }
}

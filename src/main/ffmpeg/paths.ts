import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function ffmpegPaths(): { ffmpeg: string; ffprobe: string } {
  const candidates: string[] = []
  const res = (process as { resourcesPath?: string }).resourcesPath
  if (res) candidates.push(join(res, 'ffmpeg'))
  if (process.env.FC_FFMPEG_DIR) candidates.push(process.env.FC_FFMPEG_DIR)
  for (const dir of candidates) {
    const ffmpeg = join(dir, 'ffmpeg.exe')
    if (existsSync(ffmpeg)) return { ffmpeg, ffprobe: join(dir, 'ffprobe.exe') }
  }
  return { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }
}

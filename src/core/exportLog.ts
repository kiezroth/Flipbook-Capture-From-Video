import type { ExportSettings, VideoInfo } from './types'
import type { NumberedFrame } from './ordering'
import { exportTimes } from './timing'
import { cellPosition, type Layout } from './layout'

export interface ExportLog {
  version: 1
  project: string
  video: { name: string; fps: number; isVfr: boolean; width: number; height: number }
  frameCount: number
  pageCount: number
  cell: { width: number; height: number; fit: string; gap: number; cols: number }
  timeMode: 'relative' | 'source'
  totalMs: number
  firstSourceMs: number
  lastSourceMs: number
  pages: { file: string; width: number; height: number }[]
  frames: {
    index: number
    name: string
    ms: number
    deltaMs: number | null
    sourceMs: number
    page: number
    row: number
    col: number
  }[]
}

export function buildExportLog(a: {
  projectName: string
  video: VideoInfo
  frames: NumberedFrame[]
  layout: Layout
  settings: ExportSettings
  pageFiles: string[]
}): ExportLog {
  const { video, frames, layout, settings } = a
  const times = exportTimes(frames, settings.relativeMs)
  const firstSourceMs = times.length ? times[0].sourceMs : 0
  const lastSourceMs = times.length ? times[times.length - 1].sourceMs : 0
  return {
    version: 1,
    project: a.projectName,
    video: { name: video.fileName, fps: video.fps, isVfr: video.isVfr, width: video.width, height: video.height },
    frameCount: frames.length,
    pageCount: layout.pages.length,
    cell: { width: settings.cellW, height: settings.cellH, fit: settings.fit, gap: settings.gap, cols: layout.cols },
    timeMode: settings.relativeMs ? 'relative' : 'source',
    totalMs: lastSourceMs - firstSourceMs,
    firstSourceMs,
    lastSourceMs,
    pages: layout.pages.map((p, i) => ({ file: a.pageFiles[i], width: p.width, height: p.height })),
    frames: frames.map((f, i) => {
      const pos = cellPosition(layout, settings, i)
      return {
        index: f.index,
        name: f.displayName,
        ms: times[i].ms,
        deltaMs: times[i].deltaMs,
        sourceMs: times[i].sourceMs,
        page: pos.page,
        row: pos.row,
        col: pos.col
      }
    })
  }
}

export function formatLogTxt(log: ExportLog): string {
  const c = log.cell
  const head = [
    `Video: ${log.video.name}`,
    `FPS: ${log.video.fps}${log.video.isVfr ? ' (VFR)' : ''}`,
    `Size: ${log.video.width}×${log.video.height}`,
    `Frames: ${log.frameCount}`,
    `Pages: ${log.pageCount}`,
    `Cell: ${c.width}×${c.height}, ${c.fit}, gap ${c.gap}, ${c.cols} cols`,
    log.timeMode === 'relative' ? 'Time mode: relative (first frame = 0)' : 'Time mode: source',
    `Total: ${log.totalMs}ms (source ${log.firstSourceMs} → ${log.lastSourceMs})`
  ]
  const rows = log.frames.map(
    (f) =>
      `${f.index} | ${f.name} | ${f.ms} | ${f.deltaMs === null ? '—' : `+${f.deltaMs}`} | ${f.sourceMs} | ${f.page}`
  )
  return [...head, '', '# | Name | ms | +Δms | Source ms | Page', ...rows].join('\n') + '\n'
}

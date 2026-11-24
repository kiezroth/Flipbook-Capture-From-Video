import { createCanvas } from '@napi-rs/canvas'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { buildExportLog, formatLogTxt } from './exportLog'
import { cropImage, drawFitted, drawLabel } from './image'
import { labelLines } from './labels'
import { cellPosition, computeLayout, type LayoutError } from './layout'
import { numberFrames } from './ordering'
import { exportTimes } from './timing'
import type { ExportSettings, FrameRecord, VideoInfo } from './types'

export interface ExportRequest {
  projectName: string
  video: VideoInfo
  frames: FrameRecord[]
  readFrame: (id: string) => Promise<Buffer>
  settings: ExportSettings
  outDir: string
  fileName: string
}

export interface ExportResult {
  pages: string[]
  logTxt: string
  logJson: string
}

export type LayoutExportError = Error & { layoutError: LayoutError }

export async function exportFlipbook(r: ExportRequest): Promise<ExportResult> {
  const s = r.settings
  const frames = numberFrames(r.frames)
  const layout = computeLayout(frames.length, s)
  if ('error' in layout) {
    const err = new Error(`Layout error: ${layout.error}`) as LayoutExportError
    err.layoutError = layout
    throw err
  }

  const times = exportTimes(frames, s.relativeMs)
  const pageNames = layout.pages.map((p) => `${r.fileName}_p${p.index}.png`)

  // Render everything in memory first so a failure leaves nothing on disk.
  const pageBuffers: Buffer[] = []
  for (const page of layout.pages) {
    const canvas = createCanvas(page.width, page.height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, page.width, page.height)
    for (let i = page.first; i < page.first + page.count; i++) {
      const f = frames[i]
      const pos = cellPosition(layout, s, i)
      const cell = { x: pos.x, y: pos.y, w: s.cellW, h: s.cellH }
      const img = await cropImage(await r.readFrame(f.id), f.crop)
      drawFitted(ctx, img, cell, s.fit)
      const lines = labelLines(
        { index: f.index, baseName: f.baseName, displayName: f.displayName, ms: times[i].ms },
        s
      )
      drawLabel(ctx, lines, cell, s.fontSize)
    }
    pageBuffers.push(canvas.toBuffer('image/png'))
  }

  const log = buildExportLog({
    projectName: r.projectName,
    video: r.video,
    frames,
    layout,
    settings: s,
    pageFiles: pageNames
  })
  const outDir = resolve(r.outDir)
  const pages = pageNames.map((n) => join(outDir, n))
  const logTxt = join(outDir, `${r.fileName}_log.txt`)
  const logJson = join(outDir, `${r.fileName}_log.json`)
  const files: { path: string; data: Buffer | string }[] = [
    ...pages.map((path, i) => ({ path, data: pageBuffers[i] })),
    { path: logTxt, data: formatLogTxt(log) },
    { path: logJson, data: JSON.stringify(log, null, 2) + '\n' }
  ]

  await mkdir(outDir, { recursive: true })
  for (const f of files) {
    const tmp = `${f.path}.${process.pid}.tmp`
    await writeFile(tmp, f.data)
    await rename(tmp, f.path)
  }
  return { pages, logTxt, logJson }
}

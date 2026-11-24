/** Rectangle in pixels, in rotated (display) coordinates. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface VideoInfo {
  fileName: string
  codec: string
  width: number
  height: number
  rotation: 0 | 90 | 180 | 270
  fps: number
  isVfr: boolean
  durationMs: number
  frameCount: number
  startTimeSec: number
}

export interface FrameRecord {
  id: string
  ptsSec: number
  ms: number
  seq: number
  baseName: string | null
  region: Rect | null
  /** Crop rectangle in captured-image coordinates. */
  crop: Rect | null
}

export interface ExportSettings {
  cellW: number
  cellH: number
  keepVideoAspect: boolean
  fit: 'contain' | 'cover' | 'stretch'
  columns: 'auto' | number
  gap: number
  maxLongEdge: number
  showIndex: boolean
  showName: boolean
  showMs: boolean
  fontSize: number
  relativeMs: boolean
  outDir: string | null
  fileName: string | null
}

export const DEFAULT_EXPORT: ExportSettings = {
  cellW: 256,
  cellH: 256,
  keepVideoAspect: false,
  fit: 'contain',
  columns: 'auto',
  gap: 4,
  maxLongEdge: 1568,
  showIndex: true,
  showName: true,
  showMs: true,
  fontSize: 14,
  relativeMs: true,
  outDir: null,
  fileName: null
}

export interface ProjectFile {
  formatVersion: 1
  video: VideoInfo | null
  frames: FrameRecord[]
  nextSeq: number
  selection: Rect | null
  exportSettings: ExportSettings
}

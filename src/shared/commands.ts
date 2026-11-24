import type { ExportSettings, Rect } from '../core/types'

export type DocCommand =
  | { type: 'captureFrame'; frameIndex: number; useSelection: boolean }
  | { type: 'deleteFrame'; id: string }
  | { type: 'renameFrame'; id: string; baseName: string | null }
  | { type: 'setCrop'; id: string; crop: Rect | null }
  | { type: 'setSelection'; rect: Rect | null }
  | { type: 'setExportSettings'; settings: ExportSettings }

export type PlaybackCommand =
  | { type: 'togglePlay' }
  | { type: 'seekMs'; ms: number }
  | { type: 'stepMs'; deltaMs: number }
  | { type: 'stepFrame'; delta: number }
  | { type: 'setSpeed'; speed: 0.1 | 0.25 | 0.5 | 1 }
  | { type: 'gotoFrame'; id: string }

export type CommandResult =
  | { ok: true; frameId?: string }
  | {
      ok: false
      reason: 'no-video' | 'no-selection' | 'duplicate' | 'mismatch' | 'not-found'
      message: string
    }

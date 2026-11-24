import type { ExportSettings, Rect } from '../core/types'

export type DocCommand =
  | { type: 'captureFrame'; frameIndex: number; useSelection: boolean }
  | { type: 'deleteFrame'; id: string }
  | { type: 'renameFrame'; id: string; baseName: string | null }
  | { type: 'setCrop'; id: string; crop: Rect | null }
  | { type: 'setSelection'; rect: Rect | null }
  | { type: 'setExportSettings'; settings: ExportSettings }

/** Playback speeds (spec section 6). */
export type Speed = 0.1 | 0.25 | 0.5 | 1
export const SPEEDS: readonly Speed[] = [0.1, 0.25, 0.5, 1]

export type PlaybackCommand =
  | { type: 'togglePlay' }
  | { type: 'seekMs'; ms: number }
  | { type: 'stepMs'; deltaMs: number }
  | { type: 'stepFrame'; delta: number }
  | { type: 'setSpeed'; speed: Speed }
  | { type: 'gotoFrame'; id: string }

export type CommandResult =
  | { ok: true; frameId?: string }
  | {
      ok: false
      reason: 'no-video' | 'no-selection' | 'duplicate' | 'mismatch' | 'not-found'
      message: string
    }

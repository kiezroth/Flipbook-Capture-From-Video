import type { ExportSettings, ProjectFile, VideoInfo } from '../core/types'
import type { CommandResult, DocCommand, PlaybackCommand } from './commands'

export interface BusyState {
  label: string
  /** 0..1; -1 when the progress is unknown. */
  progress: number
  cancellable: boolean
}

export interface RendererState {
  filePath: string | null
  projectName: string
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  project: ProjectFile | null
  /** url changes (`?v=` bumps) whenever the player must reload, e.g. after a save over the playing file. */
  video: { url: string; pts: number[]; info: VideoInfo } | null
  busy: BusyState | null
}

export type MenuEvent = 'export' | 'connectClaude' | 'deleteFrame'

export interface Toast {
  kind: 'info' | 'error'
  text: string
}

export type ExportResponse = { ok: true; files: string[] } | { ok: false; message: string }

export interface FcApi {
  getState(): Promise<RendererState>
  onState(cb: (s: RendererState) => void): () => void
  execute(c: DocCommand): Promise<CommandResult>
  undo(): void
  redo(): void
  onPlayback(cb: (c: PlaybackCommand) => void): () => void
  /** 'deleteFrame' = Edit > Xóa frame clicked; the renderer deletes its selected frame. */
  onMenu(cb: (m: MenuEvent) => void): () => void
  onToast(cb: (t: Toast) => void): () => void
  exportFlipbook(s: ExportSettings): Promise<ExportResponse>
  cancelBusy(): void
  reportVideoError(): void
}

/** IPC channel names. invoke = renderer→main with reply, send = renderer→main, push = main→renderer. */
export const IPC = {
  getState: 'fc:getState', // invoke
  execute: 'fc:execute', // invoke
  exportFlipbook: 'fc:exportFlipbook', // invoke
  undo: 'fc:undo', // send
  redo: 'fc:redo', // send
  cancelBusy: 'fc:cancelBusy', // send
  reportVideoError: 'fc:reportVideoError', // send
  videoReleased: 'fc:videoReleased', // send (ack of releaseVideo, carries the request token)
  menuCommand: 'fc:menuCommand', // send (MenuCommandId from a keyboard shortcut, see shared/shortcuts.ts)
  state: 'fc:state', // push
  toast: 'fc:toast', // push
  playback: 'fc:playback', // push
  menu: 'fc:menu', // push
  releaseVideo: 'fc:releaseVideo' // push (token): drop the <video> src, then ack with videoReleased
} as const

export const APP_NAME = 'Flipbook Capture'

export function windowTitle(s: Pick<RendererState, 'projectName' | 'dirty'>): string {
  return `${s.projectName}${s.dirty ? '*' : ''} — ${APP_NAME}`
}

declare global {
  interface Window {
    fc: FcApi
  }
}

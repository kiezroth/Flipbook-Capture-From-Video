import type { ExportSettings, ProjectFile, VideoInfo } from '../core/types'
import type { CommandResult, DocCommand, PlaybackCommand, Speed } from './commands'

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

/** What the "Kết nối với Claude" dialog needs to build the `claude mcp add` command. */
export interface ConnectInfo {
  exePath: string
  serverPath: string
  /** Default roots: the open project's folder, else Documents. */
  roots: string[]
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
  /** Folder picker for the export dialog; null when cancelled. */
  pickExportDir(current: string | null): Promise<string | null>
  /** Folder picker for the MCP roots in the connect dialog; null when cancelled. */
  pickRootDir(): Promise<string | null>
  getConnectInfo(): Promise<ConnectInfo>
  cancelBusy(): void
  reportVideoError(): void
  /** The player's speed changed (on-screen buttons): main checks the matching View menu item. */
  reportSpeed(speed: Speed): void
}

/** IPC channel names. invoke = renderer→main with reply, send = renderer→main, push = main→renderer. */
export const IPC = {
  getState: 'fc:getState', // invoke
  execute: 'fc:execute', // invoke
  exportFlipbook: 'fc:exportFlipbook', // invoke
  pickExportDir: 'fc:pickExportDir', // invoke
  pickRootDir: 'fc:pickRootDir', // invoke
  getConnectInfo: 'fc:getConnectInfo', // invoke
  undo: 'fc:undo', // send
  redo: 'fc:redo', // send
  cancelBusy: 'fc:cancelBusy', // send
  reportVideoError: 'fc:reportVideoError', // send
  reportSpeed: 'fc:reportSpeed', // send (Speed)
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

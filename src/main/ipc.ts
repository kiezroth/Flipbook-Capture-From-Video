import { app, BrowserWindow, dialog, ipcMain } from 'electron'

import type { ExportSettings } from '../core/types'
import type { DocCommand, PlaybackCommand } from '../shared/commands'
import { IPC, type MenuEvent, type RendererState, type Toast } from '../shared/ipc'
import type { ProjectSession } from './session'

const RELEASE_TIMEOUT_MS = 2000

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Runs a fire-and-forget session operation; a failure becomes an error toast instead of an unhandled rejection. */
export function toastOnError(session: ProjectSession, p: Promise<unknown>): void {
  p.catch((e: unknown) => session.emit('toast', { kind: 'error', text: `Đã xảy ra lỗi: ${message(e)}` } satisfies Toast))
}

/** Wires the renderer API (see FcApi) to the session and forwards session events to the window. */
export function registerIpc(session: ProjectSession, win: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.getState, () => session.rendererState())
  ipcMain.handle(IPC.execute, (_e, c: DocCommand) => session.execute(c))
  ipcMain.handle(IPC.exportFlipbook, (_e, s: ExportSettings) =>
    session.exportFlipbook(s, {
      documentsDir: app.getPath('documents'),
      defaultOutDir: process.env.FC_E2E_OUT_DIR || undefined
    })
  )
  ipcMain.handle(IPC.pickExportDir, async (_e, current: string | null) => {
    if (process.env.FC_E2E) return process.env.FC_E2E_OUT_DIR || null
    const w = win()
    const opts = { title: 'Chọn thư mục xuất', defaultPath: current ?? undefined, properties: ['openDirectory' as const, 'createDirectory' as const] }
    const r = await (w ? dialog.showOpenDialog(w, opts) : dialog.showOpenDialog(opts))
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipcMain.on(IPC.undo, () => toastOnError(session, session.undo()))
  ipcMain.on(IPC.redo, () => toastOnError(session, session.redo()))
  ipcMain.on(IPC.cancelBusy, () => session.cancelBusy())
  ipcMain.on(IPC.reportVideoError, () => toastOnError(session, session.reportVideoError()))

  const send = (channel: string, payload: unknown): void => {
    const w = win()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
  session.on('state', (s: RendererState) => send(IPC.state, s))
  session.on('toast', (t: Toast) => send(IPC.toast, t))
}

export function sendPlayback(w: BrowserWindow | null, c: PlaybackCommand): void {
  if (w && !w.isDestroyed()) w.webContents.send(IPC.playback, c)
}

export function sendMenu(w: BrowserWindow | null, m: MenuEvent): void {
  if (w && !w.isDestroyed()) w.webContents.send(IPC.menu, m)
}

/**
 * The session's releaseVideo: asks the renderer to drop the <video> src and waits for its ack
 * (or a 2 s timeout, so a hung renderer cannot block a save forever).
 */
export function makeReleaseVideo(win: () => BrowserWindow | null): () => Promise<void> {
  let next = 0
  return () =>
    new Promise<void>((resolve) => {
      const w = win()
      if (!w || w.isDestroyed()) return resolve()
      const token = ++next
      const done = (): void => {
        clearTimeout(timer)
        ipcMain.removeListener(IPC.videoReleased, onAck)
        resolve()
      }
      const onAck = (_e: unknown, t: number): void => {
        if (t === token) done()
      }
      const timer = setTimeout(done, RELEASE_TIMEOUT_MS)
      ipcMain.on(IPC.videoReleased, onAck)
      w.webContents.send(IPC.releaseVideo, token)
    })
}

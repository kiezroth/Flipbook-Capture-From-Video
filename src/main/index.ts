import { join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'

import { IPC, windowTitle } from '../shared/ipc'
import type { MenuCommandId } from '../shared/shortcuts'
import { makeReleaseVideo, registerIpc, sendMenu, sendPlayback, toastOnError } from './ipc'
import { installMediaHandlers, registerMediaSchemes } from './media-protocol'
import { buildMenu, runMenuCommand, updateMenu } from './menu'
import { ProjectSession, type Ask } from './session'

const E2E = process.env.FC_E2E === '1'

// %APPDATA%\Flipbook Capture (work\ holds the recoverable workspaces); tests redirect it.
app.setPath('userData', process.env.FC_E2E_USER_DATA || join(app.getPath('appData'), 'Flipbook Capture'))
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()
registerMediaSchemes()

let win: BrowserWindow | null = null
const getWin = (): BrowserWindow | null => win

const FBPROJ_FILTER = { name: 'Dự án Flipbook Capture', extensions: ['fbproj'] }
const VIDEO_FILTER = { name: 'Video', extensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi'] }

const e2eAnswers = (): Record<string, string> => {
  try {
    return JSON.parse(process.env.FC_E2E_ANSWERS || '{}') as Record<string, string>
  } catch {
    return {}
  }
}

const ask: Ask = async (kind, detail) => {
  if (E2E) return (e2eAnswers()[kind] ?? (kind === 'unsaved' ? 'discard' : 'yes')) as Awaited<ReturnType<Ask>>
  const box = (message: string, detailText: string, buttons: string[], cancelId: number): Promise<number> => {
    const opts = { type: 'question' as const, title: 'Flipbook Capture', message, detail: detailText, buttons, defaultId: 0, cancelId, noLink: true }
    const w = getWin()
    return (w ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts)).then((r) => r.response)
  }
  switch (kind) {
    case 'unsaved': {
      const r = await box(`Dự án "${detail ?? ''}" có thay đổi chưa lưu.`, 'Lưu lại trước khi đóng?', ['Lưu', 'Không lưu', 'Hủy'], 2)
      return (['save', 'discard', 'cancel'] as const)[r] ?? 'cancel'
    }
    case 'replaceVideo': {
      const r = await box(
        `Thay video của dự án bằng "${detail ?? ''}"?`,
        'Toàn bộ frame đã chụp sẽ bị xóa vì chúng thuộc video cũ.',
        ['Thay video', 'Hủy'],
        1
      )
      return r === 0 ? 'yes' : 'no'
    }
    case 'recover': {
      const r = await box(
        'Lần trước ứng dụng bị tắt khi còn thay đổi chưa lưu.',
        `Khôi phục dự án ${detail ?? ''}? Chọn "Bỏ đi" sẽ xóa phần chưa lưu này.`,
        ['Khôi phục', 'Bỏ đi'],
        1
      )
      return r === 0 ? 'yes' : 'no'
    }
  }
}

async function pickSavePath(): Promise<string | null> {
  if (E2E) return process.env.FC_E2E_SAVE_PATH || null
  const w = getWin()
  const defaultPath = session?.filePath ?? join(app.getPath('documents'), `${session?.projectName ?? 'Untitled'}.fbproj`)
  const opts = { title: 'Lưu dự án', defaultPath, filters: [FBPROJ_FILTER] }
  const r = await (w ? dialog.showSaveDialog(w, opts) : dialog.showSaveDialog(opts))
  return r.canceled || !r.filePath ? null : r.filePath
}

async function pickOpen(title: string, filter: Electron.FileFilter, e2eVar: string): Promise<string | null> {
  if (E2E) return process.env[e2eVar] || null
  const w = getWin()
  const opts = { title, filters: [filter], properties: ['openFile' as const] }
  const r = await (w ? dialog.showOpenDialog(w, opts) : dialog.showOpenDialog(opts))
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
}

let session: ProjectSession | null = null

function createWindow(s: ProjectSession): BrowserWindow {
  const w = new BrowserWindow({
    width: 1400,
    height: 900,
    title: windowTitle(s.rendererState()),
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })
  w.once('ready-to-show', () => w.show())

  // Unsaved changes: ask before the window goes away (also for app.quit / Exit).
  let closing = false
  let confirming = false
  w.on('close', (e) => {
    if (closing) return
    e.preventDefault()
    if (confirming) return // a second click on X while the question is open
    confirming = true
    void (async () => {
      let ok: boolean
      try {
        ok = await s.confirmClose()
      } catch (err) {
        // the user's choice is unknown: keep the window (and the project) open
        s.emit('toast', { kind: 'error', text: `Không đóng được cửa sổ: ${err instanceof Error ? err.message : String(err)}` })
        return
      } finally {
        confirming = false
      }
      if (!ok) return
      closing = true
      // The user has decided (saved, discarded or nothing to save): close even if cleanup fails. A leftover
      // workspace is cleared, or offered for recovery if it was dirty, at the next start.
      await s.dispose().catch(() => undefined)
      w.close()
    })()
  })

  if (process.env['ELECTRON_RENDERER_URL']) void w.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void w.loadFile(join(__dirname, '../renderer/index.html'))
  return w
}

app.whenReady().then(() => {
  if (!primary) return
  const s = new ProjectSession({
    workRoot: join(app.getPath('userData'), 'work'),
    cacheDir: join(app.getPath('userData'), 'proxy-cache'),
    ask,
    pickSavePath,
    pickOpenPath: () => pickOpen('Mở dự án', FBPROJ_FILTER, 'FC_E2E_OPEN_PATH'),
    pickVideoPath: () => pickOpen('Chọn video', VIDEO_FILTER, 'FC_E2E_VIDEO_PATH'),
    releaseVideo: makeReleaseVideo(getWin)
  })
  session = s
  installMediaHandlers(() => s.media())
  registerIpc(s, getWin)

  const run = (p: Promise<unknown>): void => toastOnError(s, p)
  const menu = buildMenu({
    newProject: () => run(s.newProject()),
    open: () => run(s.open()),
    save: () => run(s.save()),
    saveAs: () => run(s.saveAs()),
    importVideo: () => run(s.importVideo()),
    exportFlipbook: () => sendMenu(win, 'export'),
    exit: () => win?.close(),
    undo: () => run(s.undo()),
    redo: () => run(s.redo()),
    deleteFrame: () => sendMenu(win, 'deleteFrame'),
    setSpeed: (speed) => sendPlayback(win, { type: 'setSpeed', speed }),
    connectClaude: () => sendMenu(win, 'connectClaude')
  })
  Menu.setApplicationMenu(menu)
  ipcMain.on(IPC.menuCommand, (_e, id: MenuCommandId) => runMenuCommand(menu, id))
  s.on('state', (st: ReturnType<ProjectSession['rendererState']>) => {
    updateMenu(menu, { hasVideo: st.video !== null, canUndo: st.canUndo, canRedo: st.canRedo })
    if (win && !win.isDestroyed()) win.setTitle(windowTitle(st))
  })

  if (E2E) (globalThis as { __fc?: unknown }).__fc = { session: s }

  win = createWindow(s)
  win.on('closed', () => (win = null))
  win.webContents.once('did-finish-load', () => run(s.recoverOnStartup()))
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('window-all-closed', () => app.quit())

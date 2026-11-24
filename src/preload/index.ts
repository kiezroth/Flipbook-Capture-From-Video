import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import { IPC, windowTitle, type FcApi, type RendererState } from '../shared/ipc'
import { shortcutFor } from '../shared/shortcuts'

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, listener)
  return () => void ipcRenderer.removeListener(channel, listener)
}

const api: FcApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: (cb) => on(IPC.state, cb),
  execute: (c) => ipcRenderer.invoke(IPC.execute, c),
  undo: () => ipcRenderer.send(IPC.undo),
  redo: () => ipcRenderer.send(IPC.redo),
  onPlayback: (cb) => on(IPC.playback, cb),
  onMenu: (cb) => on(IPC.menu, cb),
  onToast: (cb) => on(IPC.toast, cb),
  exportFlipbook: (s) => ipcRenderer.invoke(IPC.exportFlipbook, s),
  cancelBusy: () => ipcRenderer.send(IPC.cancelBusy),
  reportVideoError: () => ipcRenderer.send(IPC.reportVideoError),
  reportSpeed: (speed) => ipcRenderer.send(IPC.reportSpeed, speed)
}

contextBridge.exposeInMainWorld('fc', api)

// Infrastructure kept out of the UI code:
// - the document title follows the project (`<name>[*] — Flipbook Capture`);
// - before a save renames over the playing .fbproj, every <video> drops its fbvideo: src so no request stays open.
//   The next state carries a new `?v=` URL and the player reloads it.
const setTitle = (s: RendererState): void => void (document.title = windowTitle(s))
ipcRenderer.on(IPC.state, (_e, s: RendererState) => setTitle(s))
window.addEventListener('DOMContentLoaded', () => {
  void ipcRenderer.invoke(IPC.getState).then(setTitle)
})
// File/Edit shortcuts go to main, which runs the matching (enabled) menu item.
window.addEventListener(
  'keydown',
  (e) => {
    const t = e.target as HTMLElement | null
    const inEditable = !!t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
    const keys = { key: e.key, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, inEditable }
    const id = shortcutFor({ ...keys, repeat: e.repeat })
    if (!id) {
      if (e.repeat && shortcutFor({ ...keys, repeat: false })) e.preventDefault() // swallow held-key repeats
      return
    }
    e.preventDefault()
    e.stopPropagation()
    ipcRenderer.send(IPC.menuCommand, id)
  },
  true
)
ipcRenderer.on(IPC.releaseVideo, (_e, token: number) => {
  for (const v of Array.from(document.querySelectorAll('video'))) {
    if (!(v.getAttribute('src') ?? '').startsWith('fbvideo:')) continue
    v.pause()
    v.removeAttribute('src')
    v.load()
  }
  ipcRenderer.send(IPC.videoReleased, token)
})

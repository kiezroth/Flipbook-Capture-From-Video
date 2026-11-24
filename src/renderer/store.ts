import { create } from 'zustand'

import type { PlaybackCommand } from '@shared/commands'
import type { RendererState, Toast } from '@shared/ipc'
import type { AppAction } from './keymap'
import type { PlayerController, PlayerStatus } from './player/controller'

/**
 * Renderer copy of the main-process state plus UI-only state (spec section 12: main owns the project, the renderer
 * mirrors it and sends commands).
 */
export interface Store {
  /** Last state pushed by main. `app.video.pts` keeps its identity while the PTS table is unchanged. */
  app: RendererState | null
  /** Bumped when a different video is loaded (fileName or PTS table changed); a new URL alone is a reload. */
  videoKey: number
  /** Frame shown in the frame viewer and marked blue on the timeline. */
  selectedFrameId: string | null
  player: PlayerStatus
  controller: PlayerController | null
  toast: Toast | null
  /** Bumped by every showToast, so the same text shown twice restarts the toast's timer. */
  toastId: number
  /** The Export Flipbook dialog is open. */
  exportOpen: boolean

  setAppState(s: RendererState): void
  selectFrame(id: string | null): void
  setController(c: PlayerController | null): void
  setPlayer(s: PlayerStatus): void
  showToast(t: Toast | null): void
  /** Ctrl+E / File > Export Flipbook: opens the dialog, or a toast when there is nothing to export. */
  openExport(): void
  closeExport(): void
  /**
   * Capture (T / Ctrl+T): pauses on the frame on screen, waits until the player has verified it, then asks main to
   * capture that frame. The new frame becomes the selected one; a refusal (duplicate, no selection, mismatch) is a toast.
   */
  capture(useSelection: boolean): Promise<void>
  /** Delete key and Edit > Xóa frame: deletes the selected frame. */
  deleteSelectedFrame(): Promise<void>
  runAction(a: AppAction): void
}

export const INITIAL_PLAYER: PlayerStatus = {
  displayedIndex: 0,
  playing: false,
  speed: 1,
  verified: false,
  loading: false,
  settled: false
}

const NO_VIDEO = 'Chưa có video. Hãy dùng File › Import Video (Ctrl+I).'
const MISMATCH = 'Không khớp frame đang hiển thị, chưa thể chụp. Hãy tua sang frame khác rồi quay lại.'

function samePts(a: number[], b: number[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export const useStore = create<Store>()((set, get) => ({
  app: null,
  videoKey: 0,
  selectedFrameId: null,
  player: INITIAL_PLAYER,
  controller: null,
  toast: null,
  toastId: 0,
  exportOpen: false,

  setAppState(s) {
    const prev = get().app?.video ?? null
    let video = s.video
    let videoKey = get().videoKey
    if (video && prev && prev.info.fileName === video.info.fileName && samePts(prev.pts, video.pts)) {
      video = { ...video, pts: prev.pts }
    } else if (video || prev) {
      videoKey++
    }
    const frames = s.project?.frames ?? []
    const sel = get().selectedFrameId
    set({
      app: { ...s, video },
      videoKey,
      selectedFrameId: sel && frames.some((f) => f.id === sel) ? sel : null
    })
  },

  selectFrame: (id) => set({ selectedFrameId: id }),
  setController: (c) => set({ controller: c }),
  setPlayer: (s) => set({ player: s }),
  showToast: (t) => set((s) => ({ toast: t, toastId: s.toastId + 1 })),

  openExport() {
    if ((get().app?.project?.frames.length ?? 0) === 0) {
      get().showToast({ kind: 'info', text: 'Chưa có frame nào để xuất' })
      return
    }
    set({ exportOpen: true })
  },
  closeExport: () => set({ exportOpen: false }),

  async capture(useSelection) {
    const controller = get().controller
    if (!controller || !get().app?.video) {
      get().showToast({ kind: 'error', text: NO_VIDEO })
      return
    }
    const frameIndex = await controller.pauseAndSettle()
    if (get().controller !== controller) return // the video changed meanwhile: that frame is gone
    if (!controller.verified) {
      get().showToast({ kind: 'error', text: MISMATCH })
      return
    }
    const r = await window.fc.execute({ type: 'captureFrame', frameIndex, useSelection })
    if (!r.ok) {
      get().showToast({ kind: r.reason === 'duplicate' || r.reason === 'no-selection' ? 'info' : 'error', text: r.message })
      return
    }
    // main pushes the new state before it answers, so the frame is already in app.project.frames
    if (r.frameId) set({ selectedFrameId: r.frameId })
  },

  async deleteSelectedFrame() {
    const id = get().selectedFrameId
    if (!id) return
    const r = await window.fc.execute({ type: 'deleteFrame', id })
    if (r.ok) {
      if (get().selectedFrameId === id) set({ selectedFrameId: null })
    } else get().showToast({ kind: 'error', text: r.message })
  },

  runAction(a) {
    switch (a.kind) {
      case 'playback':
        void get().controller?.execute(a.cmd)
        return
      case 'capture':
        void get().capture(a.useSelection)
        return
      case 'deleteSelectedFrame':
        void get().deleteSelectedFrame()
        return
    }
  }
}))

export const playback = (cmd: PlaybackCommand): void => useStore.getState().runAction({ kind: 'playback', cmd })

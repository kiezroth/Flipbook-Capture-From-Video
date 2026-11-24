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

  setAppState(s: RendererState): void
  selectFrame(id: string | null): void
  setController(c: PlayerController | null): void
  setPlayer(s: PlayerStatus): void
  showToast(t: Toast | null): void
  /** Capture (T / Ctrl+T). The capture flow is not part of the player; until it is installed, the keys do nothing. */
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
  showToast: (t) => set({ toast: t }),

  capture: async () => undefined,

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

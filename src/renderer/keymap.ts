import type { PlaybackCommand } from '@shared/commands'

/** What a key press asks the renderer to do. App shortcuts (Ctrl+N/O/S/I/E/Z/Y) are not here: the preload owns them. */
export type AppAction =
  | { kind: 'playback'; cmd: PlaybackCommand }
  | { kind: 'capture'; useSelection: boolean }
  | { kind: 'deleteSelectedFrame' }

export interface KeyEventInfo {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  /** Focus is in a text field (input, textarea, select, contenteditable). */
  inEditable: boolean
  /** A modal dialog is open. */
  modalOpen: boolean
}

const playback = (cmd: PlaybackCommand): AppAction => ({ kind: 'playback', cmd })

/** Player and capture keys (spec sections 5-7). Returns null for keys the renderer leaves alone. */
export function keyToAction(e: KeyEventInfo): AppAction | null {
  if (e.inEditable || e.modalOpen || e.altKey) return null
  if (e.ctrlKey) return e.key.toLowerCase() === 't' ? { kind: 'capture', useSelection: true } : null
  switch (e.key) {
    case ' ':
      return playback({ type: 'togglePlay' })
    case 'ArrowLeft':
      return playback({ type: 'stepMs', deltaMs: e.shiftKey ? -1000 : -100 })
    case 'ArrowRight':
      return playback({ type: 'stepMs', deltaMs: e.shiftKey ? 1000 : 100 })
    case ',':
      return playback({ type: 'stepFrame', delta: -1 })
    case '.':
      return playback({ type: 'stepFrame', delta: 1 })
    case 't':
    case 'T':
      return { kind: 'capture', useSelection: false }
    case 'Delete':
      return { kind: 'deleteSelectedFrame' }
    default:
      return null
  }
}

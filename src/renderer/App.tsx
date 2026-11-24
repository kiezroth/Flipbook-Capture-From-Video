import { useEffect } from 'react'

import { frameMs } from '@core/timing'
import { BusyOverlay } from './dialogs/BusyOverlay'
import { ConnectClaudeDialog } from './dialogs/ConnectClaudeDialog'
import { ExportDialog } from './dialogs/ExportDialog'
import { Toast } from './dialogs/Toast'
import { keyToAction } from './keymap'
import { Player } from './player/Player'
import { Timeline } from './player/Timeline'
import { Transport } from './player/Transport'
import { StatusBar } from './StatusBar'
import { useStore } from './store'
import { FrameStrip } from './strip/FrameStrip'
import { FrameViewer } from './viewer/FrameViewer'

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
}

/** Held keys repeat steps (hold `.` to walk frames); play/pause, capture and delete fire once per press. */
const REPEATABLE = new Set(['stepMs', 'stepFrame'])

function useMainProcessBridge(): void {
  useEffect(() => {
    const store = useStore.getState
    let pushed = false
    const offs = [
      window.fc.onState((s) => {
        pushed = true
        store().setAppState(s)
      }),
      window.fc.onToast((t) => store().showToast(t)),
      window.fc.onPlayback((cmd) => store().runAction({ kind: 'playback', cmd })),
      window.fc.onMenu((m) => {
        if (m === 'deleteFrame') store().runAction({ kind: 'deleteSelectedFrame' })
        else if (m === 'export') store().openExport()
        else if (m === 'connectClaude') store().openConnect()
      }),
      // the View menu's speed radio follows the on-screen speed buttons
      useStore.subscribe((s, prev) => {
        if (s.player.speed !== prev.player.speed) window.fc.reportSpeed(s.player.speed)
      })
    ]
    // a state pushed before getState answers is newer: keep it
    void window.fc.getState().then((s) => {
      if (!pushed) store().setAppState(s)
    })

    const onKey = (e: KeyboardEvent): void => {
      const a = keyToAction({
        key: e.key,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        inEditable: isEditable(e.target),
        modalOpen: document.querySelector('[aria-modal="true"]') !== null
      })
      if (!a) return
      e.preventDefault()
      if (e.repeat && !(a.kind === 'playback' && REPEATABLE.has(a.cmd.type))) return
      store().runAction(a)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      for (const off of offs) off()
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])
}

/**
 * Layout B3 (spec section 5): video and frame viewer side by side at the same size, then timeline, transport, frame
 * strip and status bar. No capture or export buttons: capture is T / Ctrl+T, export is in the File menu.
 */
export function App() {
  useMainProcessBridge()
  const app = useStore((s) => s.app)
  const videoKey = useStore((s) => s.videoKey)
  const video = app?.video ?? null
  const durationMs = video ? Math.max(video.info.durationMs, frameMs(video.pts, video.pts.length - 1)) : 0

  return (
    <div className="app">
      <div className="top">
        <section className="pane video-pane">
          {video ? <Player key={videoKey} url={video.url} pts={video.pts} info={video.info} /> : <div className="empty">Chưa có video. Dùng File › Import Video (Ctrl+I).</div>}
        </section>
        <FrameViewer />
      </div>
      {video && (
        <div className="controls">
          <Timeline pts={video.pts} durationMs={durationMs} frames={app?.project?.frames ?? []} />
          <Transport pts={video.pts} durationMs={durationMs} />
        </div>
      )}
      {video && <FrameStrip />}
      <StatusBar />
      <ExportDialog />
      <ConnectClaudeDialog />
      <BusyOverlay />
      <Toast />
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'

import { frameMs } from '@core/timing'
import type { VideoInfo } from '@core/types'
import { useStore } from '../store'
import { PlayerController } from './controller'
import { SelectionLayer, type Box } from './SelectionLayer'

interface Props {
  url: string
  pts: number[]
  info: VideoInfo
}

/** Where a contain-fitted picture of w×h sits inside a cw×ch box. */
export function containBox(cw: number, ch: number, w: number, h: number): Box {
  if (cw <= 0 || ch <= 0 || w <= 0 || h <= 0) return { left: 0, top: 0, width: 0, height: 0 }
  const scale = Math.min(cw / w, ch / h)
  const width = w * scale
  const height = h * scale
  return { left: (cw - width) / 2, top: (ch - height) / 2, width, height }
}

/**
 * The video pane: one PlayerController per video (App remounts this component when the video changes); a new URL
 * for the same video (save over the playing file, proxy) reloads it and returns to the displayed frame.
 */
export function Player({ url, pts, info }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [controller, setController] = useState<PlayerController | null>(null)
  const [box, setBox] = useState<Box>({ left: 0, top: 0, width: 0, height: 0 })
  const player = useStore((s) => s.player)
  const selection = useStore((s) => s.app?.project?.selection ?? null)

  useEffect(() => {
    const store = useStore.getState()
    const c = new PlayerController(videoRef.current!, pts, {
      frameSec: (id) => useStore.getState().app?.project?.frames.find((f) => f.id === id)?.ptsSec ?? null
    })
    void c.execute({ type: 'setSpeed', speed: store.player.speed })
    store.setPlayer(c.status)
    const off = c.onChange((s) => useStore.getState().setPlayer(s))
    store.setController(c)
    setController(c)
    return () => {
      off()
      c.dispose()
      if (useStore.getState().controller === c) useStore.getState().setController(null)
    }
  }, [pts])

  useEffect(() => {
    if (controller) void controller.load(url)
  }, [controller, url])

  useEffect(() => {
    const stage = stageRef.current!
    const update = (): void => setBox(containBox(stage.clientWidth, stage.clientHeight, info.width, info.height))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [info.width, info.height])

  const ms = frameMs(pts, Math.min(player.displayedIndex, pts.length - 1))
  return (
    <div className="player">
      <div className="stage" ref={stageRef} data-testid="player" data-settled={String(player.settled)}>
        <video ref={videoRef} muted playsInline preload="auto" crossOrigin="anonymous" onError={() => window.fc.reportVideoError()} />
        {player.loading && <div className="stage-cover">Đang tải video…</div>}
        <SelectionLayer box={box} info={info} selection={selection} />
      </div>
      <div className="viewing">
        <span data-testid="viewing">Đang xem {ms}ms</span>
        {!player.verified && !player.loading && !player.playing && player.settled && (
          <span className="mismatch" data-testid="mismatch">
            Không khớp frame, chưa thể chụp
          </span>
        )}
      </div>
    </div>
  )
}

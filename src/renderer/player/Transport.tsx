import type { MouseEvent, ReactNode } from 'react'

import { frameMs } from '@core/timing'
import { SPEEDS, type PlaybackCommand } from '@shared/commands'
import { playback, useStore } from '../store'
import { formatMs } from './controller'

interface Props {
  pts: number[]
  durationMs: number
}

// Buttons never take focus: Space and the arrow keys stay with the player shortcuts.
const keepFocus = (e: MouseEvent): void => e.preventDefault()

function Btn(props: { cmd: PlaybackCommand; label?: string; pressed?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={props.label}
      aria-pressed={props.pressed}
      className={props.pressed ? 'active' : undefined}
      onMouseDown={keepFocus}
      onClick={() => playback(props.cmd)}
    >
      {props.children}
    </button>
  )
}

/** Time display (`mm:ss.mmm` of the displayed frame / duration), step buttons and speed buttons. */
export function Transport({ pts, durationMs }: Props) {
  const player = useStore((s) => s.player)
  const shown = formatMs(frameMs(pts, Math.min(player.displayedIndex, pts.length - 1)))
  return (
    <div className="transport">
      <div className="transport-row">
        <span className="clock">
          <span data-testid="time">{shown}</span> / <span data-testid="duration">{formatMs(durationMs)}</span>
        </span>
        <Btn cmd={{ type: 'stepMs', deltaMs: -100 }}>-100ms</Btn>
        <Btn cmd={{ type: 'stepFrame', delta: -1 }}>◀frame</Btn>
        <Btn cmd={{ type: 'togglePlay' }} label={player.playing ? 'Dừng' : 'Phát'}>
          {player.playing ? '❚❚' : '▶'}
        </Btn>
        <Btn cmd={{ type: 'stepFrame', delta: 1 }}>frame▶</Btn>
        <Btn cmd={{ type: 'stepMs', deltaMs: 100 }}>+100ms</Btn>
      </div>
      <div className="transport-row speeds">
        {SPEEDS.map((speed) => (
          <Btn key={speed} cmd={{ type: 'setSpeed', speed }} pressed={player.speed === speed}>
            {`${speed}x`}
          </Btn>
        ))}
      </div>
    </div>
  )
}

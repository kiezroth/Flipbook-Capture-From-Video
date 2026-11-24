import { expect, test } from 'vitest'

import { frameMs } from '../../src/core/timing'
import { formatMs, indexAtDisplayedMs, PlayerController, type PlayerStatus, type VideoLike } from '../../src/renderer/player/controller'

/**
 * A <video> stand-in with Chromium's observable behaviour: frame k is presented at mediaTime mt[k] = pts[k] − shift;
 * a seek presents the frame whose span contains currentTime (the first frame before it), fires rVFC, then `seeked`.
 * `land` can make a seek present a different frame; `rvfcOnSeek = false` withholds rVFC on paused seeks.
 */
class FakeVideo extends EventTarget {
  readyState = 0
  paused = true
  muted = false
  playbackRate = 1
  defaultPlaybackRate = 1
  shown = -1
  seeks: number[] = []
  rvfcOnSeek = true
  land: (natural: number) => number = (n) => n
  private mt: number[] = []
  private _src = ''
  private t = 0
  private cbs = new Map<number, VideoFrameRequestCallback>()
  private handle = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly pts: number[],
    shift: number
  ) {
    super()
    this.setShift(shift)
  }

  setShift(shift: number): void {
    this.mt = this.pts.map((p) => p - shift)
  }

  get src(): string {
    return this._src
  }

  set src(u: string) {
    this._src = u
    this.readyState = 0
    this.t = 0
    this.stop()
    setTimeout(() => this.dispatchEvent(new Event('emptied')), 0)
    setTimeout(() => {
      if (this._src !== u) return
      this.readyState = 4
      this.present(0)
      this.dispatchEvent(new Event('loadeddata'))
    }, 3)
  }

  get currentTime(): number {
    return this.t
  }

  set currentTime(t: number) {
    this.t = t
    this.seeks.push(t)
    const k = this.land(this.frameAt(t))
    setTimeout(() => {
      if (this.rvfcOnSeek) this.present(k)
      else this.shown = k
      this.dispatchEvent(new Event('seeked'))
    }, 1)
  }

  frameAt(t: number): number {
    let k = 0
    while (k + 1 < this.mt.length && this.mt[k + 1] <= t + 1e-9) k++
    return k
  }

  requestVideoFrameCallback(cb: VideoFrameRequestCallback): number {
    this.cbs.set(++this.handle, cb)
    return this.handle
  }

  cancelVideoFrameCallback(h: number): void {
    this.cbs.delete(h)
  }

  play(): Promise<void> {
    this.paused = false
    this.timer = setInterval(() => {
      const k = Math.min(this.shown + 1, this.mt.length - 1)
      this.t = this.mt[k]
      this.present(k)
      if (k === this.mt.length - 1) this.pause()
    }, 3)
    return Promise.resolve()
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    this.stop()
    setTimeout(() => this.dispatchEvent(new Event('pause')), 0)
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private present(k: number): void {
    this.shown = k
    const cbs = [...this.cbs.values()]
    this.cbs.clear()
    for (const cb of cbs) cb(0, { mediaTime: this.mt[k] } as VideoFrameCallbackMetadata)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const cfr = Array.from({ length: 90 }, (_, i) => 1.5 + i / 30)
// B-frame/VFR-like irregular spacing
const vfr = Array.from({ length: 60 }, (_, i) => (i * 33 + (i % 4) * 7) / 1000)

function make(pts: number[], shift: number, opts = {}) {
  const v = new FakeVideo(pts, shift)
  const c = new PlayerController(v as unknown as VideoLike, pts, opts)
  return { v, c }
}

test.each([
  ['timeline from 0 (offset 1.5s)', 1.5],
  ['timeline on absolute PTS', 0],
  ['timeline shifted by an edit list', 1.5 - 0.0667]
])('calibrates (%s): first frame verified, the video muted', async (_name, shift) => {
  const { v, c } = make(cfr, shift)
  expect(v.muted).toBe(true)
  await c.load('fbvideo://current/?v=0')
  expect(c.displayedIndex).toBe(0)
  expect(v.shown).toBe(0)
  expect(c.verified).toBe(true)
  await c.execute({ type: 'stepFrame', delta: 45 })
  expect(v.shown).toBe(45)
  expect(c.displayedIndex).toBe(45)
})

test('rapid steps coalesce onto the newest target', async () => {
  const { v, c } = make(cfr, 1.5)
  await c.load('u')
  const before = v.seeks.length
  const all: Promise<void>[] = []
  for (let i = 0; i < 10; i++) all.push(c.execute({ type: 'stepFrame', delta: 1 }))
  expect(c.targetIndex).toBe(10) // steps count from the target, not from the frame on screen
  await Promise.all(all)
  expect([c.displayedIndex, v.shown, c.verified]).toEqual([10, 10, true])
  expect(v.seeks.length - before).toBeLessThanOrEqual(2)
  await c.execute({ type: 'stepMs', deltaMs: 100 })
  expect([c.displayedIndex, v.shown]).toEqual([13, 13])
  await c.execute({ type: 'stepFrame', delta: -100 })
  expect([c.displayedIndex, v.shown]).toEqual([0, 0])
})

test('steps on a VFR table follow the PTS table', async () => {
  const { v, c } = make(vfr, 0)
  await c.load('u')
  for (let i = 0; i < 7; i++) void c.execute({ type: 'stepFrame', delta: 1 })
  await c.pauseAndSettle()
  expect([c.displayedIndex, v.shown]).toEqual([7, 7])
  await c.execute({ type: 'stepMs', deltaMs: 100 })
  const limit = (vfr[7] - vfr[0]) * 1000 + 100
  const expected = vfr.filter((p) => (p - vfr[0]) * 1000 <= limit).length - 1
  expect([c.displayedIndex, v.shown]).toEqual([expected, expected])
})

test('a seek that lands wrong once is re-seeked and verified', async () => {
  const { v, c } = make(cfr, 1.5)
  await c.load('u')
  let wrong = 1
  v.land = (n) => (n === 20 && wrong-- > 0 ? 19 : n)
  await c.execute({ type: 'stepFrame', delta: 20 })
  expect([c.displayedIndex, v.shown, c.verified]).toEqual([20, 20, true])
})

test('a seek that still lands wrong blocks capture and shows the frame really on screen', async () => {
  const { v, c } = make(cfr, 1.5)
  await c.load('u')
  v.land = (n) => (n === 20 ? 19 : n)
  const seen: PlayerStatus[] = []
  c.onChange((s) => seen.push(s))
  await c.execute({ type: 'stepFrame', delta: 20 })
  expect([c.displayedIndex, c.targetIndex, v.shown, c.verified]).toEqual([19, 19, 19, false])
  expect(seen.at(-1)).toMatchObject({ displayedIndex: 19, verified: false, settled: true })
  await c.execute({ type: 'stepFrame', delta: 2 })
  expect([c.displayedIndex, v.shown, c.verified]).toEqual([21, 21, true])
})

test('without rVFC on paused seeks, falls back to seeked + currentTime', async () => {
  const { v, c } = make(cfr, 1.5, { rvfcTimeoutMs: 5 })
  v.rvfcOnSeek = false
  await c.load('u')
  await c.execute({ type: 'stepFrame', delta: 12 })
  expect([c.displayedIndex, v.shown, c.verified]).toEqual([12, 12, true])
})

test('a new URL for the same video reloads, re-calibrates and returns to the displayed frame', async () => {
  const { v, c } = make(cfr, 1.5)
  await c.load('fbvideo://current/?v=1')
  await c.execute({ type: 'stepFrame', delta: 37 })
  const loading: boolean[] = []
  c.onChange((s) => loading.push(s.loading))
  v.setShift(0) // e.g. a proxy whose timeline Chromium maps differently
  const p = c.load('fbvideo://current/?v=2')
  expect(c.status.loading).toBe(true)
  await p
  expect([c.displayedIndex, v.shown, c.verified, c.status.loading, c.status.settled]).toEqual([37, 37, true, false, true])
  expect(loading.at(-1)).toBe(false)
})

test('a step pressed while reloading lands after the reload', async () => {
  const { v, c } = make(cfr, 1.5)
  await c.load('a')
  await c.execute({ type: 'stepFrame', delta: 5 })
  void c.load('b')
  void c.execute({ type: 'stepFrame', delta: 1 })
  expect(await c.pauseAndSettle()).toBe(6)
  expect(v.shown).toBe(6)
})

test('play updates the displayed frame; pause stops on the frame on screen, verified', async () => {
  const { v, c } = make(cfr, 1.5)
  await c.load('u')
  const p = c.execute({ type: 'togglePlay' })
  expect(c.status.playing).toBe(true)
  await p
  await sleep(40)
  expect(c.displayedIndex).toBeGreaterThan(0)
  await c.execute({ type: 'togglePlay' })
  await c.pauseAndSettle()
  expect(c.status.playing).toBe(false)
  expect(c.displayedIndex).toBe(v.shown)
  expect(c.targetIndex).toBe(c.displayedIndex)
  expect(c.verified).toBe(true)
  expect(c.status.settled).toBe(true)
})

test('pauseAndSettle while playing returns the verified frame on screen; a step while playing pauses first', async () => {
  const { v, c } = make(cfr, 1.5)
  await c.load('u')
  await c.execute({ type: 'togglePlay' })
  await sleep(30)
  const i = await c.pauseAndSettle()
  expect([i, c.verified]).toEqual([v.shown, true])
  await c.execute({ type: 'togglePlay' })
  await sleep(30)
  await c.execute({ type: 'stepFrame', delta: 1 })
  await c.pauseAndSettle()
  expect(c.status.playing).toBe(false)
  expect(c.displayedIndex).toBe(v.shown)
})

test('playing to the end pauses on the last frame; play again starts over', async () => {
  const { v, c } = make(cfr, 1.5)
  await c.load('u')
  await c.execute({ type: 'stepFrame', delta: 85 })
  await c.execute({ type: 'togglePlay' })
  await sleep(60)
  await c.pauseAndSettle()
  expect([c.status.playing, c.displayedIndex, v.shown]).toEqual([false, 89, 89])
  await c.execute({ type: 'togglePlay' })
  await sleep(10)
  const i = await c.pauseAndSettle()
  expect(i).toBeLessThan(89)
})

test('setSpeed keeps playing; seekMs and gotoFrame resolve to frames', async () => {
  const sec = new Map([['f1', cfr[36]]])
  const { v, c } = make(cfr, 1.5, { frameSec: (id: string) => sec.get(id) ?? null })
  await c.load('u')
  await c.execute({ type: 'togglePlay' })
  await c.execute({ type: 'setSpeed', speed: 0.25 })
  expect([c.status.playing, c.status.speed, v.playbackRate]).toEqual([true, 0.25, 0.25])
  await c.pauseAndSettle()
  await c.execute({ type: 'seekMs', ms: 1200 })
  expect([c.displayedIndex, v.shown]).toEqual([36, 36])
  await c.execute({ type: 'seekMs', ms: 0 })
  await c.execute({ type: 'gotoFrame', id: 'f1' })
  expect(c.displayedIndex).toBe(36)
  await c.execute({ type: 'gotoFrame', id: 'missing' })
  expect(c.displayedIndex).toBe(36)
})

test('indexAtDisplayedMs inverts frameMs; formatMs', () => {
  for (const pts of [cfr, vfr]) for (let i = 0; i < pts.length; i++) expect(indexAtDisplayedMs(pts, frameMs(pts, i))).toBe(i)
  expect(indexAtDisplayedMs(cfr, 1250)).toBe(37)
  expect(indexAtDisplayedMs(cfr, -5)).toBe(0)
  expect(formatMs(0)).toBe('00:00.000')
  expect(formatMs(1233)).toBe('00:01.233')
  expect(formatMs(61_005)).toBe('01:01.005')
})

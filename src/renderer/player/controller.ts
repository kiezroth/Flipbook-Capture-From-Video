import type { PlaybackCommand } from '@shared/commands'
import { frameIndexAtMs, frameMs, nearestFrameIndex, seekTargetSec, stepByMs } from '@core/timing'

export type Speed = 0.1 | 0.25 | 0.5 | 1
export const SPEEDS: readonly Speed[] = [0.1, 0.25, 0.5, 1]

export interface PlayerStatus {
  /** Frame on screen, confirmed by requestVideoFrameCallback. */
  displayedIndex: number
  playing: boolean
  speed: Speed
  /** false after a seek still landed on the wrong frame once re-seeked: capturing is blocked. */
  verified: boolean
  /** A (re)load is in progress: the picture is not the displayed frame yet. */
  loading: boolean
  /** Paused, loaded, nothing pending: displayedIndex is final and verified says whether it is the target. */
  settled: boolean
}

/** The parts of HTMLVideoElement the controller uses (a fake implements it in the unit tests). */
export type VideoLike = Pick<
  HTMLVideoElement,
  | 'currentTime'
  | 'paused'
  | 'playbackRate'
  | 'defaultPlaybackRate'
  | 'muted'
  | 'readyState'
  | 'src'
  | 'play'
  | 'pause'
  | 'requestVideoFrameCallback'
  | 'cancelVideoFrameCallback'
  | 'addEventListener'
  | 'removeEventListener'
>

export interface PlayerOptions {
  /** gotoFrame: PTS (seconds) of a captured frame, null when unknown. */
  frameSec?: (id: string) => number | null
  /** How long to wait for rVFC after `seeked` before falling back (ms). */
  rvfcTimeoutMs?: number
  /** A seek that never completes (src removed, decoder stuck) is given up after this long (ms). */
  seekTimeoutMs?: number
}

const HAVE_METADATA = 1
const HAVE_CURRENT_DATA = 2

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 16)
  })

/**
 * Frame-accurate player on top of a <video> element. The ffprobe PTS table is the only time source (spec 7, 14):
 *
 * - Calibration: once per load, offsetSec = pts[0] − mediaTime of the first frame (rVFC after seeking to the first
 *   frame's mid-point). A frame's player time is then pts[i] − offsetSec.
 * - Seeking to frame i sets currentTime = seekTargetSec(pts, i, offsetSec) (between frame i and i+1) and verifies
 *   with rVFC: nearestFrameIndex(pts, mediaTime + offsetSec) must be i. A mismatch re-seeks once; a second mismatch
 *   sets verified = false (capture is blocked) and shows the frame really on screen.
 * - Every step is computed from targetIndex, and seeks coalesce: while one seek runs, new presses only move the
 *   target; the loop then seeks straight to the newest target.
 * - Playing: each rVFC callback updates displayedIndex. Pausing stops at the frame on screen and re-seeks to it, so
 *   the paused picture is a verified frame.
 *
 * Paused-seek fallback: Chromium presents the sought frame, and fires rVFC, even while paused. Should rVFC not come
 * within rvfcTimeoutMs after `seeked`, the controller waits one animation frame and trusts currentTime instead
 * (the frame whose PTS is the largest one not after currentTime + offsetSec).
 *
 * All seeking work (load/calibration, settling, the pause hand-over, starting playback) runs one job at a time.
 */
export class PlayerController {
  private readonly pts: number[]
  private readonly opts: PlayerOptions
  private offsetSec = 0
  private calibrated = false
  private _displayed = 0
  private _target = 0
  private _playing = false
  private _speed: Speed = 1
  private _verified = false
  private _loading = false
  private needsVerify = true
  /** Bumped by every load: jobs of an older load stop. */
  private gen = 0
  private queue: Promise<unknown> = Promise.resolve()
  private settleJob: Promise<void> | null = null
  private pausing: Promise<void> | null = null
  private loadJob: Promise<void> | null = null
  private abortSeek: (() => void) | null = null
  private playHandle: number | null = null
  private draining = false
  private disposed = false
  private readonly listeners = new Set<(s: PlayerStatus) => void>()
  private readonly onPauseEvent = (): void => {
    // paused by the element itself: end of video, or the preload releasing the file for a save
    if (this._playing) this.beginPause()
  }

  constructor(
    private readonly video: VideoLike,
    pts: number[],
    opts: PlayerOptions = {}
  ) {
    if (pts.length === 0) throw new Error('PlayerController needs a non-empty PTS table')
    this.pts = pts
    this.opts = opts
    video.muted = true
    video.addEventListener('pause', this.onPauseEvent)
  }

  get displayedIndex(): number {
    return this._displayed
  }

  get targetIndex(): number {
    return this._target
  }

  get verified(): boolean {
    return this._verified
  }

  get status(): PlayerStatus {
    return {
      displayedIndex: this._displayed,
      playing: this._playing,
      speed: this._speed,
      verified: this._verified,
      loading: this._loading,
      settled: this.idle()
    }
  }

  onChange(cb: (s: PlayerStatus) => void): () => void {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }

  /** Points the element at url (first load, or a reload of the same video), calibrates and returns to targetIndex. */
  load(url: string): Promise<void> {
    const gen = ++this.gen
    this.abortSeek?.()
    this.stopPlayLoop()
    this._playing = false
    this._loading = true
    this._verified = false
    this.video.src = url
    this.video.defaultPlaybackRate = this._speed
    this.video.playbackRate = this._speed
    this.emit()
    const job = this.enqueue(async () => {
      if (gen !== this.gen) return
      await this.waitForData()
      if (gen !== this.gen) return
      await this.measureOffset(gen)
    })
      .then(() => (gen === this.gen ? this.settle() : undefined))
      .catch(() => {
        if (gen === this.gen) this._verified = false
      })
      .finally(() => {
        if (gen !== this.gen) return
        this._loading = false
        this.loadJob = null
        this.emit()
      })
    this.loadJob = job
    return job
  }

  /** Measures offsetSec (pts[0] − mediaTime of the first frame), then returns to targetIndex. */
  calibrate(): Promise<void> {
    const gen = this.gen
    return this.enqueue(() => this.measureOffset(gen)).then(() => this.settle())
  }

  async execute(cmd: PlaybackCommand): Promise<void> {
    switch (cmd.type) {
      case 'togglePlay':
        if (this._playing) {
          this.beginPause()
          await this.pausing
          return this.settle()
        }
        return this.play()
      case 'setSpeed':
        this._speed = cmd.speed
        this.video.defaultPlaybackRate = cmd.speed
        this.video.playbackRate = cmd.speed
        this.emit()
        return
      case 'stepFrame':
        return this.seekBy((i) => i + cmd.delta)
      case 'stepMs':
        return this.seekBy((i) => stepByMs(this.pts, i, cmd.deltaMs))
      case 'seekMs':
        return this.seekBy(() => indexAtDisplayedMs(this.pts, cmd.ms))
      case 'gotoFrame': {
        const sec = this.opts.frameSec?.(cmd.id) ?? null
        if (sec === null) return
        return this.seekBy(() => nearestFrameIndex(this.pts, sec))
      }
    }
  }

  /** Pauses (at the frame on screen), waits for every pending seek and returns the verified displayed frame. */
  async pauseAndSettle(): Promise<number> {
    for (let round = 0; round < 10 && !this.disposed; round++) {
      if (this._playing) this.beginPause()
      await this.pausing
      await this.loadJob
      await this.settle()
      if (this.idle()) break
    }
    return this._displayed
  }

  dispose(): void {
    this.disposed = true
    this.gen++
    this.abortSeek?.()
    this.stopPlayLoop()
    this._playing = false
    this.video.removeEventListener('pause', this.onPauseEvent)
    this.video.pause()
    this.listeners.clear()
  }

  // ------------------------------------------------------------------------------------------------------- internals

  private idle(): boolean {
    return (
      !this._playing &&
      !this._loading &&
      this.pausing === null &&
      this.settleJob === null &&
      !this.needsVerify &&
      this._target === this._displayed
    )
  }

  private emit(): void {
    const s = this.status
    for (const cb of this.listeners) cb(s)
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const p = this.queue.then(job)
    this.queue = p.catch(() => undefined)
    return p
  }

  private clamp(i: number): number {
    return Math.max(0, Math.min(this.pts.length - 1, i))
  }

  /** Moves the target (from targetIndex, after a pause if playing) and settles. */
  private async seekBy(next: (from: number) => number): Promise<void> {
    if (this._playing) this.beginPause()
    if (this.pausing) await this.pausing
    if (this.disposed) return
    this._target = this.clamp(next(this._target))
    this.emit()
    return this.settle()
  }

  private settle(): Promise<void> {
    if (!this.settleJob) {
      const job = this.enqueue(() => this.settleLoop())
      this.settleJob = job
      // the loop clears settleJob itself (synchronously with its final check); a throw clears it here
      job.catch(() => {
        if (this.settleJob === job) this.settleJob = null
        this.emit()
      })
    }
    return this.settleJob
  }

  private async settleLoop(): Promise<void> {
    const gen = this.gen
    for (;;) {
      const target = this._target
      if (gen !== this.gen || this.disposed || !this.calibrated || this._playing || (target === this._displayed && !this.needsVerify)) {
        this.settleJob = null
        this.emit()
        return
      }
      let shown = await this.seekIndex(target)
      if (gen !== this.gen) continue
      if (shown !== null) this.show(shown)
      if (this._target !== target) continue // superseded: go straight to the newest target
      if (shown !== target) {
        shown = await this.seekIndex(target) // re-seek once
        if (gen !== this.gen) continue
        if (shown !== null) this.show(shown)
        if (this._target !== target) continue
      }
      this.needsVerify = false
      this._verified = shown === target
      // On a mismatch, later steps continue from the frame really on screen.
      if (shown !== null && shown !== target) this._target = shown
      if (shown === null) this._target = this._displayed
      this.emit()
    }
  }

  private async play(): Promise<void> {
    if (this._playing) return
    this._playing = true
    this.emit()
    return this.enqueue(async () => {
      if (!this._playing || this.disposed) return
      if (this._displayed >= this.pts.length - 1) {
        // at the end: start over from the first frame
        const shown = await this.seekIndex(0)
        if (shown !== null) this.show(shown)
        this._target = this._displayed
        if (!this._playing) return
      }
      this.video.playbackRate = this._speed
      this.startPlayLoop()
      try {
        await this.video.play()
      } catch {
        if (this._playing) {
          this._playing = false
          this.stopPlayLoop()
          this.emit()
        }
      }
    })
  }

  /** Stops playback; the queued hand-over waits for a frame already on its way, then targets the frame on screen. */
  private beginPause(): void {
    if (!this._playing) return
    this._playing = false
    this.video.pause()
    this.draining = true
    const p = this.enqueue(async () => {
      await nextFrame()
      await nextFrame()
      this.draining = false
      this.stopPlayLoop()
      this._target = this._displayed
      this.needsVerify = true
    }).finally(() => {
      if (this.pausing === p) this.pausing = null
    })
    this.pausing = p
    this.emit()
    void this.settle()
  }

  private startPlayLoop(): void {
    this.stopPlayLoop()
    const tick = (_now: number, meta: VideoFrameCallbackMetadata): void => {
      this.playHandle = null
      if (!this._playing && !this.draining) return
      const i = nearestFrameIndex(this.pts, meta.mediaTime + this.offsetSec)
      this._target = i
      this.show(i)
      this.playHandle = this.video.requestVideoFrameCallback(tick)
    }
    this.playHandle = this.video.requestVideoFrameCallback(tick)
  }

  private stopPlayLoop(): void {
    if (this.playHandle !== null) this.video.cancelVideoFrameCallback(this.playHandle)
    this.playHandle = null
    this.draining = false
  }

  private show(i: number): void {
    if (i === this._displayed) return
    this._displayed = i
    this.emit()
  }

  private waitForData(): Promise<void> {
    const v = this.video
    if (v.readyState >= HAVE_CURRENT_DATA) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const done = (): void => {
        v.removeEventListener('loadeddata', ok)
        v.removeEventListener('error', fail)
        if (this.abortSeek === fail) this.abortSeek = null
      }
      const ok = (): void => {
        done()
        resolve()
      }
      const fail = (): void => {
        done()
        reject(new Error('video did not load'))
      }
      v.addEventListener('loadeddata', ok)
      v.addEventListener('error', fail)
      // not 'emptied': the src change that started this load fires it after this listener is added
      this.abortSeek = fail
    })
  }

  private async measureOffset(gen: number): Promise<void> {
    const p = this.pts
    // Mid-point of the first frame on a timeline that starts at 0. A timeline that starts later still shows the
    // first frame here (a seek before the first frame shows the first frame).
    const guess = p.length > 1 ? (p[1] - p[0]) / 2 : 0
    const mediaTime = await this.seekRaw(guess, p[0])
    if (gen !== this.gen) return
    if (mediaTime === null) throw new Error('calibration seek failed')
    this.offsetSec = p[0] - mediaTime
    this.calibrated = true
    this.needsVerify = true
  }

  /** Seeks to frame i; resolves with the index of the frame rVFC reports on screen, null if the seek failed. */
  private async seekIndex(i: number): Promise<number | null> {
    const mediaTime = await this.seekRaw(seekTargetSec(this.pts, i, this.offsetSec), this.offsetSec)
    return mediaTime === null ? null : nearestFrameIndex(this.pts, mediaTime + this.offsetSec)
  }

  /**
   * Sets currentTime = t and resolves with the mediaTime of the frame presented for it: the rVFC value once `seeked`
   * has fired (see the fallback in the class comment). null when the seek cannot complete (no media, src removed,
   * timeout). `offsetEstimate` maps currentTime to the PTS grid in the fallback.
   */
  private seekRaw(t: number, offsetEstimate: number): Promise<number | null> {
    const v = this.video
    if (v.readyState < HAVE_METADATA) return Promise.resolve(null)
    const rvfcTimeout = this.opts.rvfcTimeoutMs ?? 1000
    return new Promise((resolve) => {
      let media: number | null = null
      let seeked = false
      let finished = false
      let fallback: ReturnType<typeof setTimeout> | null = null
      const finish = (m: number | null): void => {
        if (finished) return
        finished = true
        v.cancelVideoFrameCallback(handle)
        v.removeEventListener('seeked', onSeeked)
        v.removeEventListener('emptied', abort)
        clearTimeout(hard)
        if (fallback) clearTimeout(fallback)
        if (this.abortSeek === abort) this.abortSeek = null
        resolve(m)
      }
      const abort = (): void => finish(null)
      const handle = v.requestVideoFrameCallback((_now, meta) => {
        media = meta.mediaTime
        if (seeked) finish(media)
      })
      const onSeeked = (): void => {
        seeked = true
        if (media !== null) return finish(media)
        fallback = setTimeout(() => {
          void nextFrame().then(() => {
            const i = frameIndexAtMs(this.pts, (v.currentTime + offsetEstimate - this.pts[0]) * 1000)
            finish(this.pts[i] - offsetEstimate)
          })
        }, rvfcTimeout)
      }
      const hard = setTimeout(abort, this.opts.seekTimeoutMs ?? 5000)
      v.addEventListener('seeked', onSeeked)
      v.addEventListener('emptied', abort)
      this.abortSeek = abort
      v.currentTime = t
    })
  }
}

/** Largest frame whose displayed ms (frameMs) is not after ms; the first frame for ms before it. */
export function indexAtDisplayedMs(pts: number[], ms: number): number {
  let i = frameIndexAtMs(pts, ms + 0.5)
  while (i > 0 && frameMs(pts, i) > ms) i--
  return i
}

/** `mm:ss.mmm` of a millisecond value. */
export function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const m = Math.floor(total / 60000)
  const s = Math.floor((total % 60000) / 1000)
  const r = total % 1000
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`
}

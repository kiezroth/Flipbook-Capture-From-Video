import type { PlaybackCommand, Speed } from '@shared/commands'
import { frameIndexAtMs, frameMs, nearestFrameIndex, seekTargetSec, stepByMs } from '@core/timing'

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
/** Animation frames to wait for a re-presentation before accepting that the sought frame is already on screen. */
const SAME_FRAME_WAIT_FRAMES = 3

/** Where a seek landed. `trusted` is false for the currentTime fallback, which cannot see a mismatch. */
interface Landing {
  mediaTime: number
  trusted: boolean
}

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
 * - A persistent rVFC watcher records every presented frame (mediaTime). Playing: each callback updates
 *   displayedIndex. Pausing stops at the frame on screen and re-seeks to it, so the paused picture is a verified frame.
 *
 * Paused seeks: Chromium presents the sought frame, and fires rVFC, even while paused, except when the seek lands on
 * the frame already on screen (observed in Electron 45: no re-presentation). So after `seeked` without a new
 * presentation, the controller waits a few animation frames; if the frame last presented is the one the seek asks
 * for, that is the answer. Otherwise it keeps waiting up to rvfcTimeoutMs for a presentation. If none comes, the
 * frame on screen is still the last presented one, and that is the answer (a mismatch, so the safe outcome is a
 * re-seek and, failing that, a blocked capture). Only when rVFC has not reported any frame since the load (rVFC not
 * working) does it fall back to `seeked` + one animation frame and take currentTime: the frame whose PTS is the
 * largest one not after currentTime + offsetSec. That answer only places the time display; it can never verify a
 * frame (it maps the seek target straight back to itself), so verified stays false, and an offset calibrated from it
 * is never trusted for verification either.
 *
 * All seeking work (load/calibration, settling, the pause hand-over, starting playback) runs one job at a time.
 */
export class PlayerController {
  private readonly pts: number[]
  private readonly opts: PlayerOptions
  private offsetSec = 0
  private calibrated = false
  /** false when the offset came from the currentTime fallback: nothing can be verified against it. */
  private offsetTrusted = false
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
  private watchHandle: number | null = null
  /** Number of frames presented so far, and the mediaTime of the last one (null: nothing since the last load). */
  private presented = 0
  private lastMedia: number | null = null
  private presentHook: (() => void) | null = null
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
    this.watchHandle = video.requestVideoFrameCallback(this.onFrame)
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
    this.draining = false
    this._playing = false
    this.lastMedia = null
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
    this._playing = false
    if (this.watchHandle !== null) this.video.cancelVideoFrameCallback(this.watchHandle)
    this.watchHandle = null
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
      let r = await this.seekIndex(target)
      if (gen !== this.gen) continue
      if (r !== null) this.show(r.index)
      if (this._target !== target) continue // superseded: go straight to the newest target
      if (r === null || r.index !== target) {
        r = await this.seekIndex(target) // re-seek once
        if (gen !== this.gen) continue
        if (r !== null) this.show(r.index)
        if (this._target !== target) continue
      }
      this.needsVerify = false
      this._verified = r !== null && r.trusted && this.offsetTrusted && r.index === target
      // On a mismatch, later steps continue from the frame really on screen.
      if (r !== null && r.index !== target) this._target = r.index
      if (r === null) this._target = this._displayed
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
        const r = await this.seekIndex(0)
        if (r !== null) this.show(r.index)
        this._target = this._displayed
        if (!this._playing) return
      }
      this.video.playbackRate = this._speed
      try {
        await this.video.play()
      } catch {
        if (this._playing) {
          this._playing = false
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
      this._target = this._displayed
      this.needsVerify = true
    }).finally(() => {
      if (this.pausing === p) this.pausing = null
    })
    this.pausing = p
    this.emit()
    void this.settle()
  }

  /**
   * Persistent rVFC watcher: records each presented frame. While playing (or draining a pause) it is the display.
   * While paused with no seek running, a presented frame that differs from displayedIndex (a late presentation after
   * a seek was resolved) is shown, verified drops, and the target is sought again.
   */
  private readonly onFrame = (_now: number, meta: VideoFrameCallbackMetadata): void => {
    if (this.disposed) return
    this.watchHandle = this.video.requestVideoFrameCallback(this.onFrame)
    this.presented++
    this.lastMedia = meta.mediaTime
    if (this.calibrated && !this._loading) {
      const i = nearestFrameIndex(this.pts, meta.mediaTime + this.offsetSec)
      if (this._playing || this.draining) {
        this._target = i
        this.show(i)
      } else if (this.presentHook === null && i !== this._displayed) {
        this._verified = false
        this.needsVerify = true
        this.show(i)
        void this.settle()
      }
    }
    this.presentHook?.()
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
    // Calibration is the first seek after a load: a frame presented since then is the first frame.
    const landing = await this.seekRaw(guess, p[0], () => true)
    if (gen !== this.gen) return
    if (landing === null) throw new Error('calibration seek failed')
    this.offsetSec = p[0] - landing.mediaTime
    this.offsetTrusted = landing.trusted
    this.calibrated = true
    this.needsVerify = true
  }

  /** Seeks to frame i; resolves with the index of the frame rVFC reports on screen, null if the seek failed. */
  private async seekIndex(i: number): Promise<{ index: number; trusted: boolean } | null> {
    const landing = await this.seekRaw(
      seekTargetSec(this.pts, i, this.offsetSec),
      this.offsetSec,
      (m) => nearestFrameIndex(this.pts, m + this.offsetSec) === i
    )
    if (landing === null) return null
    return { index: nearestFrameIndex(this.pts, landing.mediaTime + this.offsetSec), trusted: landing.trusted }
  }

  /**
   * Sets currentTime = t and resolves with the mediaTime of the frame presented for it (see "Paused seeks" in the
   * class comment); `trusted` is false only for the currentTime fallback. `isSought(lastMedia)` says whether the frame last presented is the one this seek asks for;
   * `offsetEstimate` maps currentTime to the PTS grid in the fallback. null when the seek cannot complete (no media,
   * src removed, timeout).
   */
  private seekRaw(t: number, offsetEstimate: number, isSought: (lastMedia: number) => boolean): Promise<Landing | null> {
    const v = this.video
    if (v.readyState < HAVE_METADATA) return Promise.resolve(null)
    const rvfcTimeout = this.opts.rvfcTimeoutMs ?? 1000
    const before = this.presented
    return new Promise((resolve) => {
      let seeked = false
      let finished = false
      let fallback: ReturnType<typeof setTimeout> | null = null
      const finish = (m: Landing | null): void => {
        if (finished) return
        finished = true
        v.removeEventListener('seeked', onSeeked)
        v.removeEventListener('emptied', abort)
        clearTimeout(hard)
        if (fallback) clearTimeout(fallback)
        if (this.abortSeek === abort) this.abortSeek = null
        if (this.presentHook === check) this.presentHook = null
        resolve(m)
      }
      const abort = (): void => finish(null)
      const check = (): void => {
        if (seeked && this.presented > before && this.lastMedia !== null) finish({ mediaTime: this.lastMedia, trusted: true })
      }
      const onSeeked = async (): Promise<void> => {
        seeked = true
        check()
        const started = Date.now()
        for (let k = 0; k < SAME_FRAME_WAIT_FRAMES && !finished; k++) await nextFrame()
        if (finished) return
        if (this.lastMedia !== null && isSought(this.lastMedia)) return finish({ mediaTime: this.lastMedia, trusted: true })
        fallback = setTimeout(
          () => {
            // nothing new presented: the last presented frame is still on screen
            if (this.lastMedia !== null) return finish({ mediaTime: this.lastMedia, trusted: true })
            void nextFrame().then(() => {
              const i = frameIndexAtMs(this.pts, (v.currentTime + offsetEstimate - this.pts[0]) * 1000)
              finish({ mediaTime: this.pts[i] - offsetEstimate, trusted: false })
            })
          },
          Math.max(0, rvfcTimeout - (Date.now() - started))
        )
      }
      const hard = setTimeout(abort, this.opts.seekTimeoutMs ?? 5000)
      this.presentHook = check
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

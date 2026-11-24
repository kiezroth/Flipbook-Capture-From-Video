import type { NumberedFrame } from './ordering'

const EPS = 1e-6

/** Milliseconds of frame i relative to the first frame (exact, unrounded). */
function relMs(pts: number[], i: number): number {
  return (pts[i] - pts[0]) * 1000
}

export function frameMs(pts: number[], i: number): number {
  return Math.round(relMs(pts, i))
}

/** Largest i with relMs(i) <= ms (+epsilon), clamped to [0, n-1]. Binary search. */
export function frameIndexAtMs(pts: number[], ms: number): number {
  let lo = 0
  let hi = pts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (relMs(pts, mid) <= ms + EPS) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Index of the frame whose PTS (absolute seconds) is closest to sec. Binary search. */
export function nearestFrameIndex(pts: number[], sec: number): number {
  let lo = 0
  let hi = pts.length - 1
  // first index with pts >= sec
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pts[mid] >= sec) hi = mid
    else lo = mid + 1
  }
  if (lo > 0 && sec - pts[lo - 1] <= pts[lo] - sec) return lo - 1
  return lo
}

export function stepByMs(pts: number[], current: number, deltaMs: number): number {
  return frameIndexAtMs(pts, relMs(pts, current) + deltaMs)
}

/** Returns a frame index. Snaps to a 100ms grid unless free. */
export function snapTimelineMs(pts: number[], ms: number, free: boolean): number {
  if (free) return nearestFrameIndex(pts, pts[0] + ms / 1000)
  return frameIndexAtMs(pts, Math.round(ms / 100) * 100)
}

/** Seek time halfway between frame i and i+1, minus offset; last frame: pts + 1ms - offset. */
export function seekTargetSec(pts: number[], i: number, offsetSec: number): number {
  const t = i + 1 < pts.length ? (pts[i] + pts[i + 1]) / 2 : pts[i] + 0.001
  return t - offsetSec
}

export function exportTimes(
  frames: NumberedFrame[],
  relative: boolean
): { ms: number; deltaMs: number | null; sourceMs: number }[] {
  const base = frames.length > 0 ? frames[0].ms : 0
  return frames.map((fr, i) => ({
    ms: relative ? fr.ms - base : fr.ms,
    deltaMs: i === 0 ? null : fr.ms - frames[i - 1].ms,
    sourceMs: fr.ms
  }))
}

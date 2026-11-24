import { describe, expect, test } from 'vitest'

import { numberFrames } from '@core/ordering'
import {
  exportTimes,
  frameIndexAtMs,
  frameMs,
  nearestFrameIndex,
  seekTargetSec,
  snapTimelineMs,
  stepByMs
} from '@core/timing'
import type { FrameRecord } from '@core/types'

const f = (id: string, ptsSec: number, seq: number, baseName: string | null = null): FrameRecord => ({
  id,
  ptsSec,
  ms: Math.round(ptsSec * 1000),
  seq,
  baseName,
  region: null,
  crop: null
})

// PTS starts at 1.5s
const cfr = Array.from({ length: 90 }, (_, i) => 1.5 + i / 30)

describe('timing', () => {
  test('frame ms is relative to first frame', () => {
    expect(frameMs(cfr, 0)).toBe(0)
    expect(frameMs(cfr, 1)).toBe(33)
    expect(frameMs(cfr, 36)).toBe(1200)
  })

  test('100ms steps from any frame', () => {
    expect(stepByMs(cfr, 0, 100)).toBe(3)
    expect(stepByMs(cfr, 1, 100)).toBe(4)
    expect(stepByMs(cfr, 2, -100)).toBe(0)
    expect(stepByMs(cfr, 89, 100)).toBe(89)
    expect(stepByMs(cfr, 0, 1000)).toBe(30)
  })

  test('timeline snaps to 100ms unless free', () => {
    expect(snapTimelineMs(cfr, 1249, false)).toBe(36) // 1200ms
    expect(snapTimelineMs(cfr, 1249, true)).toBe(37) // nearest is 1233ms
  })

  test('seek target is mid-frame minus offset', () => {
    expect(seekTargetSec(cfr, 3, 1.5)).toBeCloseTo(0.1 + 1 / 60, 6)
  })

  test('seek target for the last frame', () => {
    expect(seekTargetSec(cfr, 89, 1.5)).toBeCloseTo(cfr[89] + 0.001 - 1.5, 6)
  })

  test('VFR lookup', () => {
    const vfr = [0, 0.033, 0.08, 0.1, 0.161]
    expect(frameIndexAtMs(vfr, 99)).toBe(2)
    expect(frameIndexAtMs(vfr, 100)).toBe(3)
  })

  test('frameIndexAtMs clamps to the table', () => {
    expect(frameIndexAtMs(cfr, -50)).toBe(0)
    expect(frameIndexAtMs(cfr, 1e9)).toBe(89)
  })

  test('nearestFrameIndex picks the closest pts', () => {
    const vfr = [0, 0.033, 0.08, 0.1, 0.161]
    expect(nearestFrameIndex(vfr, -1)).toBe(0)
    expect(nearestFrameIndex(vfr, 0.05)).toBe(1)
    expect(nearestFrameIndex(vfr, 0.07)).toBe(2)
    expect(nearestFrameIndex(vfr, 0.12)).toBe(3)
    expect(nearestFrameIndex(vfr, 5)).toBe(4)
  })

  test('export times: relative, delta, same-frame zero', () => {
    const n = numberFrames([f('a', 2.0, 1), f('b', 2.42, 2), f('c', 2.42, 3)])
    expect(exportTimes(n, true)).toEqual([
      { ms: 0, deltaMs: null, sourceMs: 2000 },
      { ms: 420, deltaMs: 420, sourceMs: 2420 },
      { ms: 420, deltaMs: 0, sourceMs: 2420 }
    ])
    expect(exportTimes(n, false)[1].ms).toBe(2420)
  })
})

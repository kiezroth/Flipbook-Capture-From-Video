import { describe, expect, test, vi } from 'vitest'

vi.mock('../../src/main/ffmpeg/paths', () => ({
  ffmpegPaths: () => ({ ffmpeg: 'no-such-ffmpeg', ffprobe: 'no-such-ffprobe-binary' })
}))

import { probeVideo } from '../../src/main/ffmpeg/probe'

describe('probe with unlaunchable ffprobe', () => {
  test('reports the tool problem, not "not a video"', async () => {
    const err = await probeVideo({ kind: 'file', path: __filename }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/Không chạy được ffprobe/)
    expect((err as Error).message).not.toMatch(/không phải video/i)
  })
})

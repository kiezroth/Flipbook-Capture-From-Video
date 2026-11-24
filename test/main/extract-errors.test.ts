import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, expect, test, vi } from 'vitest'

import { extractFrame, FrameMismatchError } from '../../src/main/ffmpeg/extract'

// ffmpeg is replaced by a stub: these cases (a non-zero exit) cannot be produced reliably with a real file
vi.mock('node:child_process', async (orig) => {
  const m = await orig<typeof import('node:child_process')>()
  return { ...m, execFile: vi.fn() }
})

type Callback = (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void
const stubFfmpeg = (err: NodeJS.ErrnoException | null, stderr: string): void => {
  vi.mocked(execFile).mockImplementation(((_file: string, _args: string[], _opts: unknown, cb: Callback) => {
    cb(err, '', stderr)
    return {} as never
  }) as never)
}
const exitError = (code: number): NodeJS.ErrnoException => Object.assign(new Error(`Command failed (exit ${code})`), { code: code as never })

const dir = mkdtempSync(join(tmpdir(), 'fc-extract-err-'))
afterEach(() => vi.mocked(execFile).mockReset())
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('non-zero exit without any frame (no pts_time) is a frame mismatch with no frame', async () => {
  stubFfmpeg(exitError(1), 'Output file is empty, nothing was encoded\nConversion failed!')
  const out = join(dir, 'a.png')
  const err = await extractFrame({ kind: 'file', path: 'x.mp4' }, 1.5, 0, null, out).catch((e: unknown) => e)
  expect(err).toBeInstanceOf(FrameMismatchError)
  expect(err).toMatchObject({ expectedSec: 1.5, gotSec: null })
  expect(existsSync(out)).toBe(false)
})

test('non-zero exit after a frame was decoded stays an ffmpeg error', async () => {
  stubFfmpeg(exitError(1), '[Parsed_showinfo_1 @ 0] n:   0 pts:  45 pts_time:1.5 \nError writing output: No space left on device')
  const err = await extractFrame({ kind: 'file', path: 'x.mp4' }, 1.5, 0, null, join(dir, 'b.png')).catch((e: unknown) => e)
  expect(err).not.toBeInstanceOf(FrameMismatchError)
  expect((err as Error).message).toMatch(/No space left/)
})

test('ffmpeg that cannot be launched stays a launch error', async () => {
  stubFfmpeg(Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }), '')
  const err = await extractFrame({ kind: 'file', path: 'x.mp4' }, 1.5, 0, null, join(dir, 'c.png')).catch((e: unknown) => e)
  expect(err).not.toBeInstanceOf(FrameMismatchError)
  expect((err as Error).message).toMatch(/Không chạy được ffmpeg/)
})

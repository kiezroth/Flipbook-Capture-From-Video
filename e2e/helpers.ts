import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron, expect, type ElectronApplication, type Page } from '@playwright/test'

const MAIN = resolve(__dirname, '..', 'out', 'main', 'index.js')

/**
 * Starts the built app (npm run e2e builds first) in E2E mode with a throwaway userData dir,
 * so runs never touch real recovery data. `env` adds/overrides FC_E2E_* variables.
 */
export async function launch(env: Record<string, string> = {}): Promise<{ app: ElectronApplication; win: Page }> {
  const userData = mkdtempSync(join(tmpdir(), 'fc-e2e-user-'))
  const app = await _electron.launch({
    args: [MAIN],
    env: { ...(process.env as Record<string, string>), FC_E2E: '1', FC_E2E_USER_DATA: userData, ...env }
  })
  app.process().once('exit', () => rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  return { app, win }
}

/** Imports a video through the session (no file dialog). */
export async function importVideo(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(async (_e, p) => {
    await (globalThis as unknown as { __fc: { session: { importVideo(p: string): Promise<void> } } }).__fc.session.importVideo(p)
  }, path)
}

/** `mm:ss.mmm` */
export function fmt(ms: number): string {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}

/**
 * Index of the frame the <video> element shows, decoded from the bit band of an unrotated fixture (as decodeIndex):
 * the element is drawn to a canvas in the renderer (fbvideo: is CORS-enabled, so the canvas is readable).
 * Waits until the player is settled (paused, nothing pending), the state in which the time display is final.
 */
export async function readDisplayed(win: Page): Promise<number> {
  await win.locator('[data-testid="player"][data-settled="true"]').waitFor()
  return win.evaluate(() => {
    const v = document.querySelector('video')!
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(v, 0, 0)
    let index = 0
    for (let b = 0; b < 8; b++) {
      const px = ctx.getImageData(Math.floor(((b + 0.5) * c.width) / 8), Math.floor(c.height / 8), 1, 1).data
      if (0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2] >= 128) index |= 1 << b
    }
    return index
  })
}

/** Drags on the video's selection layer from one point to another, given as fractions of the picture box. */
export async function dragOnVideo(win: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const b = (await win.getByTestId('selection-layer').boundingBox())!
  await win.mouse.move(b.x + b.width * from.x, b.y + b.height * from.y)
  await win.mouse.down()
  await win.mouse.move(b.x + b.width * to.x, b.y + b.height * to.y, { steps: 5 })
  await win.mouse.up()
}

/**
 * PNG bytes of the i-th captured frame in capture order (the frames' `seq`, oldest first) among the frames of the
 * current project, read from the session's workspace frames dir. Waits until that frame exists.
 */
export async function capturedPng(app: ElectronApplication, i: number): Promise<Buffer> {
  const where = async (): Promise<{ dir: string; id: string } | null> =>
    app.evaluate((_e, n) => {
      const s = (globalThis as any).__fc.session
      const frames = [...(s.doc?.state.project.frames ?? [])].sort((a: any, b: any) => a.seq - b.seq)
      const dir = s.media().framesDir as string | null
      return dir && frames[n] ? { dir, id: frames[n].id as string } : null
    }, i)
  await expect.poll(where).not.toBeNull()
  const { dir, id } = (await where())!
  return readFileSync(join(dir, `${id}.png`))
}

/** [width, height] from a PNG's IHDR chunk. */
export function pngSize(png: Buffer): [number, number] {
  return [png.readUInt32BE(16), png.readUInt32BE(20)]
}

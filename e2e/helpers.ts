import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron, type ElectronApplication, type Page } from '@playwright/test'

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

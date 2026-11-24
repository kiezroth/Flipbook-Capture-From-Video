import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { openFbproj } from '../src/core/fbproj'
import { FIXTURES } from '../test/helpers/fixtures'
import { launch } from './helpers'

const tmp = mkdtempSync(join(tmpdir(), 'fc-e2e-project-'))

test('import video, title shows dirty marker, Ctrl+S saves', async () => {
  const { app, win } = await launch({ FC_E2E_SAVE_PATH: join(tmp, 'clip.fbproj') })
  try {
    await expect.poll(() => win.title()).toBe('Untitled — Flipbook Capture')
    await app.evaluate(async (_e, p) => (globalThis as any).__fc.session.importVideo(p), FIXTURES.cfr30)
    await expect(win.locator('video')).toHaveJSProperty('readyState', 4)
    await expect.poll(() => win.title()).toBe('Untitled* — Flipbook Capture') // Import makes the project dirty
    const srcBefore = await win.locator('video').getAttribute('src')
    await win.keyboard.press('Control+S')
    await expect.poll(() => win.title()).toBe('clip — Flipbook Capture')
    expect(existsSync(join(tmp, 'clip.fbproj'))).toBe(true)
    // after the save the video is reloaded from inside the .fbproj
    await expect(win.locator('video')).not.toHaveAttribute('src', srcBefore!)
    await expect(win.locator('video')).toHaveJSProperty('readyState', 4)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe('clip — Flipbook Capture')
  } finally {
    await app.close()
  }
})

test('save over the playing .fbproj releases the player and reloads it', async () => {
  const path = join(tmp, 'clip.fbproj') // written by the previous test
  const { app, win } = await launch()
  try {
    await app.evaluate(async (_e, p) => (globalThis as any).__fc.session.open(p), path)
    await expect(win.locator('video')).toHaveJSProperty('readyState', 4)
    await expect.poll(() => win.title()).toBe('clip — Flipbook Capture')

    const r = await app.evaluate(async () =>
      (globalThis as any).__fc.session.execute({ type: 'captureFrame', frameIndex: 36, useSelection: false })
    )
    expect(r.ok).toBe(true)
    await expect.poll(() => win.title()).toBe('clip* — Flipbook Capture')

    // the captured PNG is served to the renderer over fbwork:
    const size = await win.evaluate(
      (id) =>
        new Promise<[number, number]>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve([img.naturalWidth, img.naturalHeight])
          img.onerror = () => reject(new Error('fbwork image failed'))
          img.src = `fbwork://frames/${id}.png`
        }),
      r.frameId as string
    )
    expect(size).toEqual([640, 360])

    const srcBefore = await win.locator('video').getAttribute('src')
    await win.keyboard.press('Control+S')
    await expect.poll(() => win.title()).toBe('clip — Flipbook Capture')
    await expect(win.locator('video')).not.toHaveAttribute('src', srcBefore!)
    await expect(win.locator('video')).toHaveJSProperty('readyState', 4)
    const reader = await openFbproj(path)
    expect(reader.project.frames).toHaveLength(1)
    await reader.close()
  } finally {
    await app.close()
  }
})

test('menu without a video; failures in close and undo become toasts and the window stays open', async () => {
  const { app, win } = await launch()
  try {
    const enabled = await app.evaluate(({ Menu }) => {
      const m = Menu.getApplicationMenu()!
      return Object.fromEntries(['connectClaude', 'save', 'import', 'undo'].map((id) => [id, m.getMenuItemById(id)!.enabled]))
    })
    expect(enabled).toEqual({ connectClaude: true, save: false, import: true, undo: false })

    await app.evaluate(({ BrowserWindow }) => {
      const s = (globalThis as any).__fc.session
      s.confirmClose = () => Promise.reject(new Error('boom-close'))
      s.undo = () => Promise.reject(new Error('boom-undo'))
      BrowserWindow.getAllWindows()[0].close()
    })
    await expect(win.getByTestId('toast')).toContainText('boom-close')
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    await win.evaluate(() => window.fc.undo())
    await expect(win.getByTestId('toast')).toContainText('boom-undo')
  } finally {
    await app.evaluate(() => {
      const s = (globalThis as any).__fc.session
      delete s.confirmClose
      delete s.undo
    })
    await app.close()
  }
})

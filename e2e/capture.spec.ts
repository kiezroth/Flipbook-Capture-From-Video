import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import type { RendererState } from '../src/shared/ipc'
import { decodeIndex } from '../test/helpers/decodeIndex'
import { FIXTURES } from '../test/helpers/fixtures'
import { capturedPng, dragOnVideo, importVideo as importInto, launch, pngSize, readDisplayed } from './helpers'

const tmp = mkdtempSync(join(tmpdir(), 'fc-e2e-capture-'))
let app: ElectronApplication
let win: Page

const state = (): Promise<RendererState> => win.evaluate(() => window.fc.getState())
/** Imports a video (frames of the previous one are dropped) and waits for the player to settle on it. */
const importVideo = async (path: string): Promise<void> => {
  await importInto(app, path)
  await expect(win.locator('[data-testid="player"][data-settled="true"]')).toBeVisible()
  await expect(win.getByTestId('strip-item')).toHaveCount(0)
}
const stepTo = async (frame: number): Promise<void> => {
  const now = await readDisplayed(win)
  const key = frame >= now ? '.' : ','
  for (let i = 0; i < Math.abs(frame - now); i++) await win.keyboard.press(key)
  await expect.poll(() => readDisplayed(win)).toBe(frame)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ;({ app, win } = await launch({ FC_E2E_SAVE_PATH: join(tmp, 'cap.fbproj') }))
})

test.afterAll(async () => {
  await app?.close()
})

test('T captures exactly the displayed frame, also while playing', async () => {
  await importVideo(FIXTURES.offset_bframes)
  for (let i = 0; i < 37; i++) await win.keyboard.press('.')
  await win.keyboard.press('t')
  await expect(win.getByTestId('strip-item')).toHaveCount(1)
  expect(await decodeIndex(await capturedPng(app, 0))).toBe(37)
  await expect(win.getByTestId('strip-item').first()).toContainText('1233ms')
  await expect(win.getByTestId('strip-item').first()).toHaveAttribute('aria-selected', 'true') // the new frame is selected
  await win.keyboard.press(' ')
  await win.waitForTimeout(400)
  await win.keyboard.press('t') // while playing: pauses, then captures the frame that stays on screen
  const shown = await readDisplayed(win)
  expect(shown).toBeGreaterThan(37)
  expect(await decodeIndex(await capturedPng(app, 1))).toBe(shown)
  await expect(win.getByTestId('strip-item')).toHaveCount(2)
  await expect(win.getByTestId('strip-item').nth(1)).toHaveAttribute('aria-selected', 'true')
})

test('Ctrl+T without selection shows hint; with selection captures region', async () => {
  await importVideo(FIXTURES.cfr30)
  await stepTo(5)
  await win.keyboard.press('t')
  await expect(win.getByTestId('strip-item')).toHaveCount(1)
  await win.keyboard.press('Control+t')
  await expect(win.getByTestId('toast')).toContainText('vẽ vùng')
  await dragOnVideo(win, { x: 0, y: 0 }, { x: 0.5, y: 0.5 })
  await expect.poll(async () => (await state()).project!.selection).toEqual({ x: 0, y: 0, w: 320, h: 180 })
  await win.keyboard.press('Control+t') // same frame, other region: allowed
  expect(pngSize(await capturedPng(app, 0))).toEqual([640, 360])
  expect(pngSize(await capturedPng(app, 1))).toEqual([320, 180])
  await expect(win.getByTestId('strip-item')).toHaveCount(2)
})

test('rotated video: region drawn on screen matches captured region', async () => {
  await importVideo(FIXTURES.rotated)
  await dragOnVideo(win, { x: 0, y: 0 }, { x: 1, y: 0.5 })
  await expect.poll(async () => (await state()).project!.selection).toEqual({ x: 0, y: 0, w: 360, h: 320 })
  await win.keyboard.press('Control+t')
  expect(pngSize(await capturedPng(app, 0))).toEqual([360, 320])
})

test('duplicate capture is skipped with a notice', async () => {
  await importVideo(FIXTURES.cfr30)
  await stepTo(3)
  await win.keyboard.press('t')
  await expect(win.getByTestId('strip-item')).toHaveCount(1)
  await win.keyboard.press('t')
  await expect(win.getByTestId('toast')).toContainText('đã được chụp')
  await win.waitForTimeout(300)
  await expect(win.getByTestId('strip-item')).toHaveCount(1)
  expect((await state()).project!.frames).toHaveLength(1)
})

test('rename, crop, delete, undo, redo, goto', async () => {
  await importVideo(FIXTURES.cfr30)
  await stepTo(10)
  await win.keyboard.press('t')
  const item = win.getByTestId('strip-item')
  await expect(item).toHaveCount(1)
  await expect(win.getByTestId('viewer-label')).toHaveAttribute('aria-label', '1 0ms') // no name line yet

  // rename
  await win.getByRole('button', { name: 'Đặt tên' }).click()
  await expect(win.getByTestId('name-input')).toBeFocused()
  await win.getByTestId('name-input').fill('slash')
  await win.keyboard.press('Enter')
  await expect(item).toContainText('slash-1')
  await expect(win.getByTestId('viewer-label')).toHaveAttribute('aria-label', '1 slash-1 0ms')
  expect((await state()).project!.frames[0].baseName).toBe('slash')

  // crop: drag the bottom-left corner to the middle of the image, apply with Enter
  await win.getByRole('button', { name: 'Crop', exact: true }).click()
  const handle = (await win.getByTestId('crop-handle-sw').boundingBox())!
  const rect = (await win.getByTestId('crop-rect').boundingBox())!
  await win.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await win.mouse.down()
  await win.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 5 })
  await win.mouse.up()
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('crop-rect')).toHaveCount(0)
  await expect.poll(async () => (await state()).project!.frames[0].crop).not.toBeNull()
  const crop = (await state()).project!.frames[0].crop!
  expect(Math.abs(crop.x - 320)).toBeLessThanOrEqual(2)
  expect(crop.y).toBe(0)
  expect(Math.abs(crop.x + crop.w - 640)).toBeLessThanOrEqual(0)
  expect(Math.abs(crop.h - 180)).toBeLessThanOrEqual(2)
  // the viewer shows the cropped image, label still in its top-right corner
  const img = (await win.getByTestId('viewer-image').boundingBox())!
  expect(Math.abs(img.width / img.height - crop.w / crop.h)).toBeLessThan(0.02)
  const label = (await win.getByTestId('viewer-label').boundingBox())!
  expect(Math.abs(label.x + label.width - (img.x + img.width))).toBeLessThan(1.5)
  expect(Math.abs(label.y - img.y)).toBeLessThan(1.5)
  expect(label.width).toBeLessThan(img.width / 2)

  // crop again, then "Bỏ crop" removes it
  await win.getByRole('button', { name: 'Crop', exact: true }).click()
  await expect(win.getByTestId('crop-rect')).toBeVisible()
  await win.getByRole('button', { name: 'Bỏ crop' }).click()
  await expect.poll(async () => (await state()).project!.frames[0].crop).toBeNull()
  // Esc cancels a crop edit
  await win.getByRole('button', { name: 'Crop', exact: true }).click()
  await expect(win.getByTestId('crop-rect')).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('crop-rect')).toHaveCount(0)
  expect((await state()).project!.frames[0].crop).toBeNull()

  // delete, undo, redo
  await win.keyboard.press('Delete')
  await expect(item).toHaveCount(0)
  await win.keyboard.press('Control+z')
  await expect(item).toHaveCount(1)
  await win.keyboard.press('Control+y')
  await expect(item).toHaveCount(0)
  await win.keyboard.press('Control+z')
  await expect(item).toHaveCount(1)

  // the viewer's Xóa button deletes too
  await item.first().click()
  await win.getByRole('button', { name: 'Xóa' }).click()
  await expect(item).toHaveCount(0)
  await win.keyboard.press('Control+z')
  await expect(item).toHaveCount(1)

  // goto
  await item.first().click()
  await expect(item.first()).toHaveAttribute('aria-selected', 'true')
  await stepTo(50)
  await win.getByRole('button', { name: 'Tới ms này' }).click()
  await expect.poll(() => readDisplayed(win)).toBe(10)
  await expect(win.getByTestId('time')).toHaveText('00:00.333')
})

test('typing T in the name field does not capture', async () => {
  const item = win.getByTestId('strip-item')
  await expect(item).toHaveCount(1)
  await item.first().click()
  await stepTo(20) // a frame not captured yet, so a capture would add an item
  await win.getByRole('button', { name: 'Đặt tên' }).click()
  await expect(win.getByTestId('name-input')).toBeFocused()
  await win.keyboard.type('tt')
  await win.keyboard.press('Control+t')
  await win.keyboard.press('Delete')
  await win.waitForTimeout(500)
  await expect(item).toHaveCount(1)
  await win.keyboard.press('Escape') // cancels the rename
  await expect(win.getByTestId('name-input')).toHaveCount(0)
  expect((await state()).project!.frames[0].baseName).toBe('slash')
  // an empty name goes back to the number
  await win.getByRole('button', { name: 'Đặt tên' }).click()
  await win.getByTestId('name-input').fill('')
  await win.keyboard.press('Enter')
  await expect.poll(async () => (await state()).project!.frames[0].baseName).toBeNull()
  await expect(item.first()).not.toContainText('slash')
})

test('strip is sorted by ms and numbered; clicking an item shows it in the viewer', async () => {
  const item = win.getByTestId('strip-item')
  await stepTo(30)
  await win.keyboard.press('t')
  await stepTo(2)
  await win.keyboard.press('t')
  await expect(item).toHaveCount(3)
  await expect(item.nth(0)).toContainText('67ms')
  await expect(item.nth(1)).toContainText('333ms')
  await expect(item.nth(2)).toContainText('1000ms')
  await expect(item.nth(0)).toHaveAttribute('aria-selected', 'true') // the last capture (frame 2) sorts first
  await item.nth(2).click()
  await expect(item.nth(2)).toHaveAttribute('aria-selected', 'true')
  await expect(win.getByTestId('timeline-selected')).toHaveCount(1)
  // relative ms (export default): the first frame is 0
  await expect(win.getByTestId('viewer-label')).toHaveAttribute('aria-label', '3 933ms')
})

test('status bar: shortcuts left, project name with * right; no capture or export buttons', async () => {
  await expect(win.getByTestId('status-shortcuts')).toHaveText('T: chụp · Ctrl+T: chụp vùng · ←/→ ±100ms · , . từng frame')
  await expect(win.getByTestId('status-project')).toHaveText('Untitled *')
  await win.keyboard.press('Control+s')
  await expect(win.getByTestId('status-project')).toHaveText('cap.fbproj')
  await expect(win.getByRole('button', { name: /chụp|xuất|export|capture/i })).toHaveCount(0)
})

test('the strip scrolls to the selected frame', async () => {
  const item = win.getByTestId('strip-item')
  for (let i = 0; i < 16; i++) {
    const r = await app.evaluate(
      async (_e, n) => (globalThis as any).__fc.session.execute({ type: 'captureFrame', frameIndex: n, useSelection: false }),
      50 + i * 2 // cfr30 has 90 frames
    )
    expect(r.ok).toBe(true)
  }
  await expect(item).toHaveCount(19)
  const strip = win.getByRole('listbox', { name: 'Frame đã chụp' })
  await strip.evaluate((el) => (el.scrollLeft = 0))
  expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await win.getByTestId('timeline-frame').last().click() // selects the last frame
  await expect(item.last()).toHaveAttribute('aria-selected', 'true')
  await expect(item.last()).toBeInViewport()
  expect(await strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
})

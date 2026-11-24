import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { FIXTURES } from '../test/helpers/fixtures'
import { captureEvery, importVideo as importInto, launch, pngSize } from './helpers'

const outDir = mkdtempSync(join(tmpdir(), 'fc-e2e-export-'))
let app: ElectronApplication
let win: Page

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ;({ app, win } = await launch({ FC_E2E_OUT_DIR: outDir }))
})

test.afterAll(async () => {
  await app?.close()
})

const settings = () => win.evaluate(async () => (await window.fc.getState()).project!.exportSettings)
const exportButton = () => win.getByRole('button', { name: 'Xuất' })

test('no frames: Ctrl+E only shows a toast', async () => {
  await importInto(app, FIXTURES.cfr30)
  await expect(win.locator('[data-testid="player"][data-settled="true"]')).toBeVisible()
  await win.keyboard.press('Control+e')
  await expect(win.getByTestId('toast')).toContainText('Chưa có frame nào để xuất')
  await expect(win.getByTestId('export-dialog')).toHaveCount(0)
})

test('export 10 frames with defaults', async () => {
  await captureEvery(win, 3, 10)
  await win.keyboard.press('Control+e')
  await expect(win.getByTestId('export-preview')).toHaveText('1 trang · 4 cột')
  await expect(win.getByTestId('export-warning')).toHaveCount(0)
  await win.getByLabel('Cỡ chữ').fill('11')
  await expect(win.getByTestId('export-warning')).toContainText('Claude có thể không đọc rõ')
  await win.getByLabel('Cỡ chữ').fill('14')
  await expect(win.getByTestId('export-warning')).toHaveCount(0)
  await exportButton().click()
  await expect(win.getByTestId('toast')).toContainText(join(outDir, 'flipbook_p1.png'))
  await expect(win.getByTestId('export-dialog')).toHaveCount(0)
  const log = JSON.parse(readFileSync(join(outDir, 'flipbook_log.json'), 'utf8'))
  expect(log.frames.map((f: { sourceMs: number }) => f.sourceMs)).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900])
  expect(existsSync(join(outDir, 'flipbook_p1.png'))).toBe(true)
  expect(existsSync(join(outDir, 'flipbook_log.txt'))).toBe(true)
  expect(pngSize(readFileSync(join(outDir, 'flipbook_p1.png')))).toEqual([4 * 256 + 3 * 4, 3 * 256 + 2 * 4])
})

test('cell wider than max edge blocks export', async () => {
  await win.keyboard.press('Control+e')
  await win.getByLabel('Rộng').fill('1600')
  await expect(exportButton()).toBeDisabled()
  await expect(win.getByTestId('export-error')).toBeVisible()
  await win.getByLabel('Rộng').fill('256')
  await expect(exportButton()).toBeEnabled()
  await expect(win.getByTestId('export-error')).toHaveCount(0)
  // an empty or malformed number blocks export instead of reaching the layout
  for (const bad of ['', 'abc']) {
    await win.getByLabel('Khoảng cách').fill(bad)
    await expect(exportButton()).toBeDisabled()
    await expect(win.getByTestId('export-preview')).toHaveText('')
  }
  await win.getByLabel('Khoảng cách').fill('4')
  await win.getByLabel('Số cột tự động').uncheck()
  await win.getByLabel('Số cột', { exact: true }).fill('50')
  await expect(exportButton()).toBeDisabled()
  await expect(win.getByTestId('export-error')).toContainText('Tối đa 6 cột')
})

test('modal: Esc closes without saving, player keys are inactive while open', async () => {
  await expect(win.getByTestId('export-dialog')).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('export-dialog')).toHaveCount(0)
  expect((await settings()).columns).toBe('auto')
  await win.keyboard.press('Control+e')
  const before = await win.getByTestId('time').textContent()
  await win.locator('.dialog-backdrop').click({ position: { x: 2, y: 2 } })
  await win.keyboard.press('.')
  await win.keyboard.press('ArrowRight')
  await win.waitForTimeout(300)
  expect(await win.getByTestId('time').textContent()).toBe(before)
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('export-dialog')).toHaveCount(0)
})

test('aspect lock follows the video, not the crop', async () => {
  await win.keyboard.press('Control+e')
  await win.getByLabel('Giữ theo tỉ lệ video').check()
  await expect(win.getByLabel('Cao')).toBeDisabled()
  await win.getByLabel('Rộng').fill('320')
  await expect(win.getByLabel('Cao')).toHaveValue('180') // 640x360 video
  await win.keyboard.press('Escape')
})

test('Enter during IME composition does not export; real Enter does', async () => {
  await win.keyboard.press('Control+e')
  await win.getByLabel('Tên file').fill('ime')
  await win.getByLabel('Tên file').dispatchEvent('keydown', { key: 'Enter', isComposing: true })
  await win.waitForTimeout(300)
  await expect(win.getByTestId('export-dialog')).toBeVisible()
  expect(existsSync(join(outDir, 'ime_p1.png'))).toBe(false)
  await win.getByLabel('Tên file').press('Enter')
  await expect(win.getByTestId('export-dialog')).toHaveCount(0)
  expect(existsSync(join(outDir, 'ime_p1.png'))).toBe(true)
})

test('rename field ignores IME Enter', async () => {
  await win.getByTestId('strip-item').first().click()
  await win.getByRole('button', { name: 'Đặt tên' }).click()
  const input = win.getByTestId('name-input')
  await input.fill('abc')
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
  await expect(input).toBeVisible()
  await input.press('Escape')
  await expect(input).toHaveCount(0)
})

test('settings are saved after export; a failed export keeps the dialog open', async () => {
  await win.keyboard.press('Control+e')
  await win.getByLabel('Số cột tự động').uncheck()
  await win.getByLabel('Số cột', { exact: true }).fill('5')
  await win.getByLabel('Tên file').fill('custom')
  await exportButton().click()
  await expect(win.getByTestId('export-dialog')).toHaveCount(0)
  expect(await settings()).toMatchObject({ columns: 5, fileName: 'custom', fontSize: 14 })
  expect(existsSync(join(outDir, 'custom_p1.png'))).toBe(true)

  await win.keyboard.press('Control+e')
  await expect(win.getByLabel('Số cột tự động')).not.toBeChecked()
  await expect(win.getByLabel('Số cột', { exact: true })).toHaveValue('5')
  await expect(win.getByLabel('Tên file')).toHaveValue('custom')
  // a folder that cannot be created: the export fails, the dialog stays open and nothing is saved
  await win.getByLabel('Thư mục').fill(join(outDir, 'custom_log.json', 'sub'))
  await exportButton().click()
  await expect(win.getByTestId('toast')).toHaveAttribute('class', /error/)
  await expect(win.getByTestId('export-dialog')).toBeVisible()
  expect((await settings()).outDir).toBeNull()
})

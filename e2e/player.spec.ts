import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

import { frameMs, nearestFrameIndex, snapTimelineMs, stepByMs } from '../src/core/timing'
import { readPtsTable } from '../src/main/ffmpeg/probe'
import type { RendererState } from '../src/shared/ipc'
import { FIXTURES } from '../test/helpers/fixtures'
import { fmt, importVideo as importInto, launch, readDisplayed } from './helpers'

type Name = keyof typeof FIXTURES

const tmp = mkdtempSync(join(tmpdir(), 'fc-e2e-player-'))
const PTS = {} as Record<Name, number[]>
let app: ElectronApplication
let win: Page

const ptsOf = (name: Name): number[] => PTS[name]
const state = (): Promise<RendererState> => win.evaluate(() => window.fc.getState())
const importVideo = async (path: string): Promise<void> => {
  await importInto(app, path)
  await expect(win.locator('[data-testid="player"][data-settled="true"]')).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  for (const name of ['cfr30', 'offset_bframes', 'vfr', 'rotated'] as const) PTS[name] = await readPtsTable({ kind: 'file', path: FIXTURES[name] })
  ;({ app, win } = await launch({ FC_E2E_SAVE_PATH: join(tmp, 'player.fbproj') }))
})

test.afterAll(async () => {
  await app?.close()
})

test.afterEach(async () => {
  await expect(win.getByTestId('mismatch')).toHaveCount(0)
})

for (const name of ['cfr30', 'offset_bframes', 'vfr'] as const) {
  test(`${name}: frame steps land exactly`, async () => {
    await importVideo(FIXTURES[name])
    await expect(win.getByTestId('time')).toHaveText('00:00.000')
    expect(await readDisplayed(win)).toBe(0) // also with a first PTS of 1.5s and B-frames
    for (let i = 0; i < 10; i++) await win.keyboard.press('.') // pressed in a row, no waiting
    await expect.poll(() => readDisplayed(win)).toBe(10)
    await expect(win.getByTestId('time')).toHaveText(fmt(frameMs(ptsOf(name), 10)))
    await expect(win.getByTestId('viewing')).toHaveText(`Đang xem ${frameMs(ptsOf(name), 10)}ms`)
    await win.keyboard.press('ArrowRight') // +100ms
    await expect.poll(() => readDisplayed(win)).toBe(stepByMs(ptsOf(name), 10, 100))
    await expect(win.getByTestId('time')).toHaveText(fmt(frameMs(ptsOf(name), stepByMs(ptsOf(name), 10, 100))))
    for (let i = 0; i < 3; i++) await win.keyboard.press(',')
    await win.keyboard.press('Shift+ArrowRight') // +1s
    const expected = stepByMs(ptsOf(name), stepByMs(ptsOf(name), 10, 100) - 3, 1000)
    await expect.poll(() => readDisplayed(win)).toBe(expected)
    await expect(win.getByTestId('time')).toHaveText(fmt(frameMs(ptsOf(name), expected)))
  })
}

test('holding "." keeps stepping, holding Space toggles once', async () => {
  await importVideo(FIXTURES.cfr30)
  for (let i = 0; i < 6; i++) await win.keyboard.down('.') // the 2nd..6th are auto-repeats
  await win.keyboard.up('.')
  await expect.poll(() => readDisplayed(win)).toBe(6)
  await win.keyboard.down(' ')
  await win.keyboard.down(' ')
  await win.keyboard.up(' ')
  await expect(win.getByRole('button', { name: 'Dừng' })).toBeVisible()
  await win.keyboard.press(' ')
  await expect(win.getByRole('button', { name: 'Phát' })).toBeVisible()
})

test('play at 0.1x then pause shows a verified frame matching the clock', async () => {
  await importVideo(FIXTURES.cfr30)
  const cfrPts = ptsOf('cfr30')
  await win.getByRole('button', { name: '0.1x', exact: true }).click()
  await win.keyboard.press(' ')
  await win.waitForTimeout(1500)
  await win.keyboard.press(' ')
  const shown = await readDisplayed(win)
  expect(shown).toBeGreaterThan(0)
  await expect(win.getByTestId('time')).toHaveText(fmt(frameMs(cfrPts, shown)))
  await win.getByRole('button', { name: '1x', exact: true }).click()
})

test('timeline click snaps to 100ms; alt-drag snaps to frame', async () => {
  await importVideo(FIXTURES.cfr30)
  const pts = ptsOf('cfr30')
  const s = await state()
  const span = Math.max(s.video!.info.durationMs, frameMs(pts, pts.length - 1))
  const box = (await win.getByTestId('timeline').boundingBox())!
  const y = box.y + box.height / 2
  const at = (f: number): number => box.x + box.width * f

  await win.mouse.click(at(0.41), y) // 41% of 3000ms = 1230ms → 1200ms (frame 36)
  expect(snapTimelineMs(pts, 0.41 * span, false)).toBe(36)
  await expect(win.getByTestId('time')).toHaveText('00:01.200')
  await expect.poll(() => readDisplayed(win)).toBe(36)

  // Alt-drag: free position, nearest frame
  const target = frameMs(pts, 46) / span // frame 46 (1533ms) sits between the 1500 and 1600 grid lines
  await win.keyboard.down('Alt')
  await win.mouse.move(at(0.2), y)
  await win.mouse.down()
  await win.mouse.move(at(target), y, { steps: 8 })
  await win.mouse.up()
  await win.keyboard.up('Alt')
  const xUsed = Math.round(at(target)) // Playwright dispatches integer CSS pixels
  const expected = nearestFrameIndex(pts, pts[0] + (((xUsed - box.x) / box.width) * span) / 1000)
  expect(expected).toBe(46)
  await expect.poll(() => readDisplayed(win)).toBe(46)
  await expect(win.getByTestId('time')).toHaveText(fmt(frameMs(pts, 46)))

  // the same place without Alt snaps to the grid
  await win.mouse.click(at(target), y)
  await expect(win.getByTestId('time')).toHaveText('00:01.500')
  await expect.poll(() => readDisplayed(win)).toBe(45)
})

test('captured frames are green marks; clicking one selects it without seeking; Delete and Edit > Xóa frame delete it', async () => {
  await importVideo(FIXTURES.cfr30)
  const capture = (frameIndex: number) =>
    app.evaluate(
      async (_e, i) => (globalThis as any).__fc.session.execute({ type: 'captureFrame', frameIndex: i, useSelection: false }),
      frameIndex
    )
  expect((await capture(15)).ok).toBe(true)
  expect((await capture(60)).ok).toBe(true)
  await expect(win.getByTestId('timeline-frame')).toHaveCount(2)
  await expect(win.getByTestId('timeline-selected')).toHaveCount(0)

  const shownBefore = await readDisplayed(win)
  const timeBefore = await win.getByTestId('time').textContent()
  await win.getByTestId('timeline-frame').first().click()
  await expect(win.getByTestId('timeline-selected')).toHaveCount(1)
  await win.waitForTimeout(200)
  await expect(win.getByTestId('time')).toHaveText(timeBefore!) // selecting does not seek
  expect(await readDisplayed(win)).toBe(shownBefore)

  await win.keyboard.press('Delete')
  await expect(win.getByTestId('timeline-frame')).toHaveCount(1)
  await expect(win.getByTestId('timeline-selected')).toHaveCount(0)
  expect((await state()).project!.frames.map((f) => f.ms)).toEqual([frameMs(ptsOf('cfr30'), 60)])

  await win.getByTestId('timeline-frame').first().click()
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('deleteFrame')!.click())
  await expect(win.getByTestId('timeline-frame')).toHaveCount(0)
})

test('dragging on the video sets the selection in video pixels (rotated too)', async () => {
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
    const b = (await win.getByTestId('selection-layer').boundingBox())!
    await win.mouse.move(b.x + b.width * from.x, b.y + b.height * from.y)
    await win.mouse.down()
    await win.mouse.move(b.x + b.width * to.x, b.y + b.height * to.y, { steps: 5 })
    await win.mouse.up()
  }
  await importVideo(FIXTURES.cfr30)
  await drag({ x: 0, y: 0 }, { x: 0.5, y: 0.5 })
  await expect.poll(async () => (await state()).project!.selection).toEqual({ x: 0, y: 0, w: 320, h: 180 })
  await expect(win.getByTestId('selection-rect')).toBeVisible()

  await importVideo(FIXTURES.rotated)
  expect((await state()).video!.info).toMatchObject({ width: 360, height: 640 })
  await drag({ x: 0, y: 0 }, { x: 1, y: 0.5 })
  await expect.poll(async () => (await state()).project!.selection).toEqual({ x: 0, y: 0, w: 360, h: 320 })
  // the layer covers the picture (contain-fitted, portrait)
  const b = (await win.getByTestId('selection-layer').boundingBox())!
  expect(Math.abs(b.width / b.height - 360 / 640)).toBeLessThan(0.01)
})

test('speed buttons: active one highlighted, playback keeps going, View menu follows both ways', async () => {
  await importVideo(FIXTURES.cfr30)
  const checked = () =>
    app.evaluate(({ Menu }) =>
      [0.1, 0.25, 0.5, 1].filter((s) => Menu.getApplicationMenu()!.getMenuItemById(`speed-${s}`)!.checked)
    )
  await win.keyboard.press(' ')
  await win.getByRole('button', { name: '0.5x', exact: true }).click()
  await expect(win.getByRole('button', { name: '0.5x', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(win.getByRole('button', { name: '1x', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(checked).toEqual([0.5])
  await expect(win.locator('video')).toHaveJSProperty('playbackRate', 0.5)
  await expect(win.locator('video')).toHaveJSProperty('paused', false) // changing speed does not stop playback
  await expect(win.locator('video')).toHaveJSProperty('muted', true)

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('speed-0.25')!.click())
  await expect(win.getByRole('button', { name: '0.25x', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(win.locator('video')).toHaveJSProperty('playbackRate', 0.25)
  await expect.poll(checked).toEqual([0.25])
  await win.keyboard.press(' ')
  await win.getByRole('button', { name: '1x', exact: true }).click()
  await expect.poll(checked).toEqual([1])
})

test('saving (also over the playing .fbproj) reloads the video at the same displayed frame', async () => {
  await importVideo(FIXTURES.offset_bframes)
  const pts = ptsOf('offset_bframes')
  for (let i = 0; i < 37; i++) await win.keyboard.press('.')
  await expect.poll(() => readDisplayed(win)).toBe(37)

  for (const round of [1, 2]) {
    if (round === 2) {
      // make it dirty again; this save renames over the file the video plays from
      const r = await app.evaluate(async () =>
        (globalThis as any).__fc.session.execute({ type: 'setSelection', rect: { x: 1, y: 1, w: 10, h: 10 } })
      )
      expect(r.ok).toBe(true)
      await expect.poll(() => win.title()).toBe('player* — Flipbook Capture')
    }
    const srcBefore = await win.locator('video').getAttribute('src')
    await win.keyboard.press('Control+S')
    await expect.poll(() => win.title()).toBe('player — Flipbook Capture')
    await expect(win.locator('video')).not.toHaveAttribute('src', srcBefore!)
    await expect.poll(() => readDisplayed(win)).toBe(37)
    await expect(win.getByTestId('time')).toHaveText(fmt(frameMs(pts, 37)))
    await win.keyboard.press('.')
    await expect.poll(() => readDisplayed(win)).toBe(38)
    await win.keyboard.press(',')
    await expect.poll(() => readDisplayed(win)).toBe(37)
  }
})

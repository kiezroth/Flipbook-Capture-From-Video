import { expect, test } from 'vitest'

import type { VideoInfo } from '../../src/core/types'
import { DEFAULT_EXPORT } from '../../src/core/types'
import { aspectLockedHeight, layoutPreview, parseForm, toForm } from '../../src/renderer/dialogs/exportForm'
import { isCompositionEnter } from '../../src/renderer/ime'

test('aspect lock', () => {
  expect(aspectLockedHeight(256, { width: 640, height: 360 } as VideoInfo)).toBe(144)
  expect(aspectLockedHeight(100, { width: 360, height: 640 } as VideoInfo)).toBe(178) // rounds 177.8
})

test('defaults round-trip through the form', () => {
  const r = parseForm(toForm(DEFAULT_EXPORT, null))
  expect(r.errors).toEqual({})
  expect(r.settings).toEqual(DEFAULT_EXPORT)
})

test('empty and malformed numbers are field errors, never NaN settings', () => {
  const f = toForm(DEFAULT_EXPORT, null)
  for (const bad of ['', ' ', 'abc', '1.5', '-3', '0']) {
    const r = parseForm({ ...f, cellW: bad })
    expect(r.settings).toBeNull()
    expect(r.errors.cellW).toBeTruthy()
  }
  expect(parseForm({ ...f, gap: '0' }).settings?.gap).toBe(0)
  expect(parseForm({ ...f, columnsAuto: false, columns: '' }).errors.columns).toBeTruthy()
  expect(parseForm({ ...f, columnsAuto: false, columns: '3' }).settings?.columns).toBe(3)
})

test('blank folder and name mean defaults; bad file names are rejected', () => {
  const f = toForm(DEFAULT_EXPORT, null)
  expect(parseForm({ ...f, fileName: '  ', outDir: ' ' }).settings).toMatchObject({ fileName: null, outDir: null })
  expect(parseForm({ ...f, fileName: ' my book ', outDir: 'D:\\out' }).settings).toMatchObject({ fileName: 'my book', outDir: 'D:\\out' })
  expect(parseForm({ ...f, fileName: 'a/b' }).errors.fileName).toBeTruthy()
})

test('layout preview and blocking errors', () => {
  expect(layoutPreview(10, DEFAULT_EXPORT)).toEqual({ ok: true, pages: 1, cols: 4 })
  expect(layoutPreview(100, DEFAULT_EXPORT)).toMatchObject({ ok: true, pages: 3 })
  expect(layoutPreview(10, { ...DEFAULT_EXPORT, cellW: 1600 })).toMatchObject({ ok: false })
  expect(layoutPreview(10, { ...DEFAULT_EXPORT, columns: 20 })).toMatchObject({ ok: false })
  expect(layoutPreview(0, DEFAULT_EXPORT)).toMatchObject({ ok: false })
})

test('Enter during IME composition is ignored', () => {
  expect(isCompositionEnter({ key: 'Enter', nativeEvent: { isComposing: true } })).toBe(true)
  expect(isCompositionEnter({ key: 'Enter', nativeEvent: { isComposing: false } })).toBe(false)
  expect(isCompositionEnter({ key: 'a', nativeEvent: { isComposing: true } })).toBe(false)
})

test('opening the form re-locks the cell height to the current video when the aspect is kept', () => {
  const s = { ...DEFAULT_EXPORT, cellW: 256, cellH: 144, keepVideoAspect: true } // saved for a 16:9 video
  const portrait = { width: 360, height: 640 } as VideoInfo // then a portrait video was imported
  expect(toForm(s, portrait).cellH).toBe('455')
  expect(toForm(s, { width: 640, height: 360 } as VideoInfo).cellH).toBe('144')
  expect(toForm({ ...s, keepVideoAspect: false }, portrait).cellH).toBe('144') // not locked: kept as saved
  expect(toForm(s, null).cellH).toBe('144') // no video: nothing to lock to
})

test('cell size and max long edge are capped at 8192 (a bigger page canvas can crash the app)', () => {
  const f = toForm(DEFAULT_EXPORT, null)
  for (const key of ['cellW', 'cellH', 'maxLongEdge'] as const) {
    expect(parseForm({ ...f, [key]: '8192' }).errors[key]).toBeUndefined()
    expect(parseForm({ ...f, [key]: '8193' }).errors[key]).toBe('Nhập từ 1 đến 8192.')
    expect(parseForm({ ...f, [key]: '16384' }).settings).toBeNull()
  }
})

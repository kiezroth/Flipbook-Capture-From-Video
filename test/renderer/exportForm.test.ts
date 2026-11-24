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
  const r = parseForm(toForm(DEFAULT_EXPORT))
  expect(r.errors).toEqual({})
  expect(r.settings).toEqual(DEFAULT_EXPORT)
})

test('empty and malformed numbers are field errors, never NaN settings', () => {
  const f = toForm(DEFAULT_EXPORT)
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
  const f = toForm(DEFAULT_EXPORT)
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

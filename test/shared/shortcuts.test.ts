import { expect, test } from 'vitest'

import { shortcutFor, type KeyInfo } from '../../src/shared/shortcuts'

const k = (key: string, o: Partial<KeyInfo> = {}): ReturnType<typeof shortcutFor> =>
  shortcutFor({ key, ctrlKey: true, shiftKey: false, altKey: false, inEditable: false, ...o })

test('file and edit shortcuts', () => {
  expect(k('n')).toBe('new')
  expect(k('o')).toBe('open')
  expect(k('s')).toBe('save')
  expect(k('S', { shiftKey: true })).toBe('saveAs')
  expect(k('i')).toBe('import')
  expect(k('e')).toBe('export')
  expect(k('z')).toBe('undo')
  expect(k('y')).toBe('redo')
})

test('no shortcut without Ctrl, with Alt, or for other keys', () => {
  expect(k('s', { ctrlKey: false })).toBeNull()
  expect(k('s', { altKey: true })).toBeNull()
  expect(k('t')).toBeNull() // Ctrl+T is the renderer's region capture
  expect(k('n', { shiftKey: true })).toBeNull()
})

test('text fields keep their own undo, but Ctrl+S still saves', () => {
  expect(k('z', { inEditable: true })).toBeNull()
  expect(k('y', { inEditable: true })).toBeNull()
  expect(k('s', { inEditable: true })).toBe('save')
})

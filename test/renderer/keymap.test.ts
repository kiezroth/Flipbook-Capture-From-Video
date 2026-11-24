import { expect, test } from 'vitest'

import { keyToAction } from '../../src/renderer/keymap'

type Opts = Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; inEditable: boolean; modalOpen: boolean }>
const k = (key: string, o: Opts = {}) =>
  keyToAction({ key, ctrlKey: false, shiftKey: false, altKey: false, inEditable: false, modalOpen: false, ...o })

test('keys', () => {
  expect(k('ArrowRight')).toEqual({ kind: 'playback', cmd: { type: 'stepMs', deltaMs: 100 } })
  expect(k('ArrowLeft', { shiftKey: true })).toEqual({ kind: 'playback', cmd: { type: 'stepMs', deltaMs: -1000 } })
  expect(k('.')).toEqual({ kind: 'playback', cmd: { type: 'stepFrame', delta: 1 } })
  expect(k('t')).toEqual({ kind: 'capture', useSelection: false })
  expect(k('T', { shiftKey: true })).toEqual({ kind: 'capture', useSelection: false })
  expect(k('t', { ctrlKey: true })).toEqual({ kind: 'capture', useSelection: true })
  expect(k(' ')).toEqual({ kind: 'playback', cmd: { type: 'togglePlay' } })
})

test('typing in a field or dialog never triggers shortcuts', () => {
  expect(k('t', { inEditable: true })).toBeNull()
  expect(k('ArrowRight', { modalOpen: true })).toBeNull()
})

test('the remaining player keys', () => {
  expect(k('ArrowLeft')).toEqual({ kind: 'playback', cmd: { type: 'stepMs', deltaMs: -100 } })
  expect(k('ArrowRight', { shiftKey: true })).toEqual({ kind: 'playback', cmd: { type: 'stepMs', deltaMs: 1000 } })
  expect(k(',')).toEqual({ kind: 'playback', cmd: { type: 'stepFrame', delta: -1 } })
  expect(k('T', { ctrlKey: true, shiftKey: true })).toEqual({ kind: 'capture', useSelection: true })
  expect(k('Delete')).toEqual({ kind: 'deleteSelectedFrame' })
})

test('app shortcuts belong to the preload, other modifiers and unknown keys do nothing', () => {
  for (const key of ['n', 'o', 's', 'i', 'e', 'z', 'y']) expect(k(key, { ctrlKey: true })).toBeNull()
  expect(k('S', { ctrlKey: true, shiftKey: true })).toBeNull()
  expect(k('ArrowRight', { ctrlKey: true })).toBeNull()
  expect(k('.', { ctrlKey: true })).toBeNull()
  expect(k('t', { altKey: true })).toBeNull()
  expect(k('ArrowLeft', { altKey: true })).toBeNull()
  expect(k('x')).toBeNull()
  expect(k('Delete', { inEditable: true })).toBeNull()
  expect(k(' ', { modalOpen: true })).toBeNull()
})

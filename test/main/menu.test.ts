import { expect, test } from 'vitest'

import { menuEnabledState } from '../../src/main/menu'

test('without a video only New, Open, Import Video, Exit and Kết nối với Claude are enabled', () => {
  const s = menuEnabledState({ hasVideo: false, canUndo: false, canRedo: false })
  expect(Object.keys(s).filter((id) => s[id])).toEqual(['connectClaude'])
  for (const id of ['save', 'saveAs', 'export', 'undo', 'redo', 'deleteFrame', 'speed-0.1', 'speed-1']) expect(s[id]).toBe(false)
  // New/Open/Import/Exit are never touched (always enabled)
  for (const id of ['new', 'open', 'import', 'exit']) expect(s[id]).toBeUndefined()
})

test('with a video, undo/redo follow the history', () => {
  const s = menuEnabledState({ hasVideo: true, canUndo: true, canRedo: false })
  expect(s).toMatchObject({ save: true, saveAs: true, export: true, deleteFrame: true, 'speed-0.25': true, connectClaude: true })
  expect(s.undo).toBe(true)
  expect(s.redo).toBe(false)
})

import { expect, test } from 'vitest'
import { labelBox, labelLines } from '../../src/core/labels'

test('label lines', () => {
  const all = { showIndex: true, showName: true, showMs: true }
  expect(labelLines({ index: 2, baseName: 'slash', displayName: 'slash-2', ms: 420 }, all)).toEqual([
    { text: '2', bold: true },
    { text: 'slash-2', bold: false },
    { text: '420ms', bold: false }
  ])
  expect(labelLines({ index: 2, baseName: null, displayName: '2', ms: 420 }, all).map((l) => l.text)).toEqual([
    '2',
    '420ms'
  ])
  expect(
    labelLines({ index: 2, baseName: null, displayName: '2', ms: 0 }, { ...all, showIndex: false, showMs: true }).map(
      (l) => l.text
    )
  ).toEqual(['0ms'])
})
test('label box size', () => {
  const b = labelBox(
    [
      { text: '2', bold: true },
      { text: '420ms', bold: false }
    ],
    14,
    (l) => l.text.length * 8
  )
  expect(b).toEqual({ width: 48, height: 2 * 18 + 8, padding: 4, lineHeight: 18 })
})

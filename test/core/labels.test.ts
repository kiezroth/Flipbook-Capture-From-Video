import { expect, test } from 'vitest'
import { ellipsizeText, fitLabelLines, labelBox, labelLines } from '../../src/core/labels'

test('label lines', () => {
  const all = { showIndex: true, showName: true, showMs: true }
  expect(labelLines({ index: 2, baseName: 'slash', displayName: 'slash-2', ms: 420 }, all)).toEqual([
    { text: '2', bold: true },
    { text: 'slash-2', bold: false, fitSuffix: '-2' },
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

test('name line may be shortened, keeping its -<index> suffix', () => {
  const all = { showIndex: true, showName: true, showMs: true }
  expect(labelLines({ index: 2, baseName: 'slash', displayName: 'slash-2', ms: 420 }, all)[1]).toEqual({
    text: 'slash-2',
    bold: false,
    fitSuffix: '-2'
  })
})

test('fitLabelLines ellipsizes only shortenable lines to the cell width', () => {
  const measure = (l: { text: string }): number => Array.from(l.text).length * 8 // 8px per character
  const lines = [
    { text: '123456789012345', bold: true },
    { text: `${'a'.repeat(30)}-7`, bold: false, fitSuffix: '-7' },
    { text: '420ms', bold: false }
  ]
  // cell 100px wide: text area 100 - 2*4 = 92px → at most 11 characters
  const fitted = fitLabelLines(lines, 100, measure)
  expect(fitted[0].text).toBe('123456789012345') // index line intact
  expect(fitted[1].text).toBe(`${'a'.repeat(8)}…-7`)
  expect(measure(fitted[1])).toBeLessThanOrEqual(92)
  expect(fitted[2].text).toBe('420ms')
  // short enough: unchanged (same objects)
  expect(fitLabelLines(lines, 1000, measure)).toEqual(lines)
  // not even the suffix fits: ellipsis alone
  expect(fitLabelLines([{ text: 'abcdef-77', bold: false, fitSuffix: '-77' }], 30, measure)[0].text).toBe('…')
})

test('ellipsizeText never splits a surrogate pair', () => {
  const measure = (t: string): number => Array.from(t).length * 10
  expect(ellipsizeText('😀😀😀😀😀😀', '', 40, measure)).toBe('😀😀😀…')
  expect(ellipsizeText('fits', '', 40, measure)).toBe('fits')
})

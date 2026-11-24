import { expect, test } from 'vitest'

import { fitRect } from '../../src/core/fit'

const cell = { x: 10, y: 20, w: 100, h: 100 }

test('contain: whole image, centred, aspect kept', () => {
  expect(fitRect(640, 360, cell, 'contain')).toEqual({ src: { x: 0, y: 0, w: 640, h: 360 }, dst: { x: 10, y: 20 + 21.875, w: 100, h: 56.25 } })
})

test('cover: centred source crop with the cell aspect, fills the cell', () => {
  expect(fitRect(640, 360, cell, 'cover')).toEqual({ src: { x: 140, y: 0, w: 360, h: 360 }, dst: cell })
})

test('stretch: whole image into the whole cell', () => {
  expect(fitRect(640, 360, cell, 'stretch')).toEqual({ src: { x: 0, y: 0, w: 640, h: 360 }, dst: cell })
})

test('empty image: nothing to draw', () => {
  expect(fitRect(0, 360, cell, 'contain')).toBeNull()
})

import { beforeAll, expect, test } from 'vitest'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { cropImage, drawFitted, resizeToMax } from '../../src/core/image'

const solid = (w: number, h: number, color = '#808080'): Buffer => {
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
  return c.toBuffer('image/png')
}

let png640x360: Buffer
let png3000x1000: Buffer
beforeAll(() => {
  png640x360 = solid(640, 360)
  png3000x1000 = solid(3000, 1000)
})

test('crop applied before fitting', async () => {
  const c = await cropImage(png640x360, { x: 0, y: 0, w: 320, h: 180 })
  expect([c.width, c.height]).toEqual([320, 180])
  const full = await cropImage(png640x360, null)
  expect([full.width, full.height]).toEqual([640, 360])
})

test('resizeToMax', async () => {
  const b = await resizeToMax(png3000x1000, 1568)
  const i = await loadImage(b)
  expect([i.width, i.height]).toEqual([1568, 523])
  expect(await resizeToMax(png640x360, 1568)).toEqual(png640x360)
})

test('drawFitted contain / cover / stretch', async () => {
  const img = await loadImage(png640x360) // 16:9, gray
  const alpha = (fit: 'contain' | 'cover' | 'stretch', x: number, y: number): number => {
    const c = createCanvas(100, 100)
    const ctx = c.getContext('2d')
    drawFitted(ctx, img, { x: 0, y: 0, w: 100, h: 100 }, fit)
    return ctx.getImageData(x, y, 1, 1).data[0]
  }
  // contain: 100x56 centred, black bars top and bottom
  expect(alpha('contain', 50, 2)).toBe(0)
  expect(alpha('contain', 50, 50)).toBeGreaterThan(100)
  // cover and stretch fill the whole cell
  expect(alpha('cover', 50, 2)).toBeGreaterThan(100)
  expect(alpha('stretch', 2, 2)).toBeGreaterThan(100)
})

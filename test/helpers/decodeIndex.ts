import { createCanvas, loadImage } from '@napi-rs/canvas'

/**
 * Reads the frame index encoded in the top band of a fixture frame: 8 cells, cell b centered at
 * x=(b+0.5)*W/8, y=H/8, white (luma >= 128) means bit b (weight 2^b) is set.
 *
 * rotation 90: the PNG was extracted from a video whose display rotation is 90 and was therefore
 * autorotated 90 degrees counter-clockwise by ffmpeg (the bit band is on the left edge); it is
 * turned back 90 degrees clockwise before decoding.
 */
export async function decodeIndex(png: Buffer, rotation: 0 | 90 = 0): Promise<number> {
  const img = await loadImage(png)
  const w = rotation === 90 ? img.height : img.width
  const h = rotation === 90 ? img.width : img.height
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (rotation === 90) {
    ctx.translate(w, 0)
    ctx.rotate(Math.PI / 2) // clockwise
  }
  ctx.drawImage(img, 0, 0)
  let index = 0
  for (let b = 0; b < 8; b++) {
    const px = ctx.getImageData(Math.floor(((b + 0.5) * w) / 8), Math.floor(h / 8), 1, 1).data
    const luma = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]
    if (luma >= 128) index |= 1 << b
  }
  return index
}

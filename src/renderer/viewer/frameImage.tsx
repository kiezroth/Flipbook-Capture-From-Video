import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

import type { Rect } from '@core/types'

/** Captured PNGs never change (crop is stored as a rectangle and ids are UUIDs), so one decoded image per id. */
const cache = new Map<string, Promise<HTMLImageElement>>()

export const frameUrl = (id: string): string => `fbwork://frames/${id}.png`

function loadFrame(id: string): Promise<HTMLImageElement> {
  let p = cache.get(id)
  if (!p) {
    const img = new Image()
    img.src = frameUrl(id)
    p = img.decode().then(() => img)
    p.catch(() => cache.delete(id)) // a later render may retry
    cache.set(id, p)
  }
  return p
}

/** The captured (uncropped) image of a frame, null while it loads or if it failed to load. */
export function useFrameImage(id: string): HTMLImageElement | null {
  const [img, setImg] = useState<{ id: string; img: HTMLImageElement } | null>(null)
  useEffect(() => {
    let live = true
    loadFrame(id).then(
      (i) => live && setImg({ id, img: i }),
      () => live && setImg(null)
    )
    return () => {
      live = false
    }
  }, [id])
  return img && img.id === id ? img.img : null
}

interface CanvasProps {
  image: HTMLImageElement
  /** Part of the image to draw (captured-image pixels); null = the whole image. */
  crop: Rect | null
  /** Upper bound for the canvas's pixel size (thumbnails); the picture is never scaled up. */
  maxW?: number
  maxH?: number
  className?: string
  style?: CSSProperties
}

/** Draws the (cropped) image into a canvas; CSS sizes it. */
export function FrameCanvas({ image, crop, maxW = Infinity, maxH = Infinity, className, style }: CanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const src = crop ?? { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight }
  useLayoutEffect(() => {
    const c = ref.current!
    const scale = Math.min(1, maxW / src.w, maxH / src.h)
    c.width = Math.max(1, Math.round(src.w * scale))
    c.height = Math.max(1, Math.round(src.h * scale))
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, src.x, src.y, src.w, src.h, 0, 0, c.width, c.height)
  }, [image, src.x, src.y, src.w, src.h, maxW, maxH])
  return <canvas ref={ref} className={className} style={style} />
}

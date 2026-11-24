import { useLayoutEffect, useRef } from 'react'

import { labelBox, type LabelLine } from '@core/labels'

interface Props {
  lines: LabelLine[]
  /** Export font size, in export-cell pixels. */
  fontSize: number
  /** Displayed size per export-cell pixel (displayed image width / export cell width). */
  scale: number
}

const fontFor = (l: LabelLine, size: number): string => (l.bold ? `bold ${size}px Arial` : `${size}px Arial`)

/**
 * The export label (spec section 10) drawn the way export draws it: same lines and box (`labelBox`, Arial, bold index
 * line, black at 0.6, 4px padding, right-aligned text), laid out in export-cell pixels and then scaled to the viewer.
 * The parent positions it; it sits in the top-right corner of the displayed image.
 */
export function LabelOverlay({ lines, fontSize, scale }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const c = ref.current
    if (!c) return
    const measure = c.getContext('2d')!
    const box = labelBox(lines, fontSize, (l) => {
      measure.font = fontFor(l, fontSize)
      return measure.measureText(l.text).width
    })
    const width = Math.ceil(box.width) // as export: the box is a whole number of cell pixels wide
    const px = scale * window.devicePixelRatio
    c.width = Math.max(1, Math.ceil(width * px))
    c.height = Math.max(1, Math.ceil(box.height * px))
    c.style.width = `${width * scale}px`
    c.style.height = `${box.height * scale}px`
    const ctx = c.getContext('2d')!
    ctx.setTransform(px, 0, 0, px, 0, 0)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(0, 0, width, box.height)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    lines.forEach((l, i) => {
      ctx.font = fontFor(l, fontSize)
      ctx.fillText(l.text, width - box.padding, box.padding + (i + 0.5) * box.lineHeight)
    })
  }, [lines, fontSize, scale])

  if (lines.length === 0 || scale <= 0) return null
  return <canvas ref={ref} className="viewer-label" data-testid="viewer-label" role="img" aria-label={lines.map((l) => l.text).join(' ')} />
}

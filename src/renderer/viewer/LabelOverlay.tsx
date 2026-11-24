import { useLayoutEffect, useMemo, useRef } from 'react'

import { fitLabelLines, labelBox, type LabelLine } from '@core/labels'

interface Props {
  lines: LabelLine[]
  /** Export font size, in export-cell pixels. */
  fontSize: number
  /** Export cell width, in export-cell pixels: a name too long for it is shortened as export shortens it. */
  cellW: number
  /** Displayed size per export-cell pixel (displayed cell width / export cell width). */
  scale: number
}

const fontFor = (l: LabelLine, size: number): string => (l.bold ? `bold ${size}px Arial` : `${size}px Arial`)

let measureCtx: CanvasRenderingContext2D | null = null
function measurer(fontSize: number): (l: LabelLine) => number {
  measureCtx ??= document.createElement('canvas').getContext('2d')!
  const ctx = measureCtx
  return (l) => {
    ctx.font = fontFor(l, fontSize)
    return ctx.measureText(l.text).width
  }
}

/**
 * The export label (spec section 10) drawn the way export draws it: same lines, shortening and box (`fitLabelLines`,
 * `labelBox`, Arial, bold index line, black at 0.6, 4px padding, right-aligned text), laid out in export-cell pixels
 * and then scaled to the viewer. It sits in the top-right corner of the cell preview, which clips it like the cell.
 */
export function LabelOverlay({ lines, fontSize, cellW, scale }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const fitted = useMemo(() => fitLabelLines(lines, cellW, measurer(fontSize)), [lines, cellW, fontSize])
  useLayoutEffect(() => {
    const c = ref.current
    if (!c) return
    const box = labelBox(fitted, fontSize, measurer(fontSize))
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
    fitted.forEach((l, i) => {
      ctx.font = fontFor(l, fontSize)
      ctx.fillText(l.text, width - box.padding, box.padding + (i + 0.5) * box.lineHeight)
    })
  }, [fitted, fontSize, scale])

  if (fitted.length === 0 || scale <= 0) return null
  return <canvas ref={ref} className="viewer-label" data-testid="viewer-label" role="img" aria-label={fitted.map((l) => l.text).join(' ')} />
}

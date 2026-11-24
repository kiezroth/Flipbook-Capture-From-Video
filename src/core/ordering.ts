import type { FrameRecord } from './types'

export interface NumberedFrame extends FrameRecord {
  /** 1-based position after sorting. */
  index: number
  displayName: string
}

/** Sort by PTS, then by capture order. Returns a new array. */
export function sortFrames(f: FrameRecord[]): FrameRecord[] {
  return [...f].sort((a, b) => a.ptsSec - b.ptsSec || a.seq - b.seq)
}

export function displayName(baseName: string | null, index: number): string {
  return baseName ? `${baseName}-${index}` : String(index)
}

export function numberFrames(f: FrameRecord[]): NumberedFrame[] {
  return sortFrames(f).map((fr, i) => ({
    ...fr,
    index: i + 1,
    displayName: displayName(fr.baseName, i + 1)
  }))
}

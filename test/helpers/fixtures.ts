import { resolve } from 'node:path'

const dir = resolve(__dirname, '..', 'fixtures', 'gen')

export const FIXTURES = {
  cfr30: resolve(dir, 'cfr30.mp4'),
  vfr: resolve(dir, 'vfr.mp4'),
  offset_bframes: resolve(dir, 'offset_bframes.mp4'),
  rotated: resolve(dir, 'rotated.mp4'),
  trimmed: resolve(dir, 'trimmed.mp4'),
  hevc: resolve(dir, 'hevc.mkv')
} as const satisfies Record<string, string>

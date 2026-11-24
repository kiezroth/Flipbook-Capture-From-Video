import { describe, expect, test } from 'vitest'

import { claudeAddCommand } from '../../src/main/connect'

describe('claudeAddCommand', () => {
  test('command quotes paths with spaces and repeats --root', () => {
    expect(
      claudeAddCommand({
        exePath: 'C:\Program Files\Flipbook Capture\Flipbook Capture.exe',
        serverPath: 'C:\Program Files\Flipbook Capture\resources\mcp\server.cjs',
        roots: ['D:\Clips', 'D:\Video hiệu ứng']
      })
    ).toBe(
      'claude mcp add flipbook-capture -e ELECTRON_RUN_AS_NODE=1 -- "C:\Program Files\Flipbook Capture\Flipbook Capture.exe" "C:\Program Files\Flipbook Capture\resources\mcp\server.cjs" --root "D:\Clips" --root "D:\Video hiệu ứng"'
    )
  })
})

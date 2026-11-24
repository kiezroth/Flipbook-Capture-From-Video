import { describe, expect, test } from 'vitest'

import { claudeAddCommand } from '../../src/shared/connect'

const exePath = 'C:\\Program Files\\Flipbook Capture\\Flipbook Capture.exe'
const serverPath = 'C:\\Program Files\\Flipbook Capture\\resources\\mcp\\server.cjs'
const head =
  'claude mcp add flipbook-capture -e ELECTRON_RUN_AS_NODE=1 -- "C:\\Program Files\\Flipbook Capture\\Flipbook Capture.exe" "C:\\Program Files\\Flipbook Capture\\resources\\mcp\\server.cjs"'

describe('claudeAddCommand', () => {
  test('command quotes paths with spaces and repeats --root', () => {
    expect(claudeAddCommand({ exePath, serverPath, roots: ['D:\\Clips', 'D:\\Video hiệu ứng'] })).toBe(
      `${head} --root "D:\\Clips" --root "D:\\Video hiệu ứng"`
    )
  })

  test('a trailing backslash is doubled so it cannot escape the closing quote', () => {
    expect(claudeAddCommand({ exePath, serverPath, roots: ['D:\\'] })).toBe(`${head} --root "D:\\\\"`)
  })

  test('a path ending in + is left unchanged', () => {
    expect(claudeAddCommand({ exePath, serverPath, roots: ['D:\\C++'] })).toBe(`${head} --root "D:\\C++"`)
  })
})

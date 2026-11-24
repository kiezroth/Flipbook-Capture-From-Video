import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, test } from 'vitest'

import { DEFAULT_EXPORT, type ProjectFile } from '../../src/core/types'
import { Workspace, type SessionMeta } from '../../src/main/workspace'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fc-ws-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const project = (): ProjectFile => ({
  formatVersion: 1,
  video: null,
  frames: [],
  nextSeq: 1,
  selection: null,
  exportSettings: { ...DEFAULT_EXPORT }
})
const meta = (dirty: boolean): SessionMeta => ({ videoOrigin: null, savedPath: null, dirty })

test('create makes a uuid dir with frames/', async () => {
  const ws = await Workspace.create(root)
  expect(existsSync(ws.framesDir)).toBe(true)
  expect(ws.framesDir).toBe(join(ws.dir, 'frames'))
  expect(readdirSync(root)).toHaveLength(1)
})

test('write leaves no temp files and is recoverable when dirty', async () => {
  const ws = await Workspace.create(root)
  await ws.write(project(), meta(true))
  await ws.write(project(), meta(true))
  expect(readdirSync(ws.dir).sort()).toEqual(['frames', 'project.json', 'session.json'])
  const found = await Workspace.findRecoverable(root)
  expect(found).toHaveLength(1)
  expect(found[0].dir).toBe(ws.dir)
  expect(found[0].meta.dirty).toBe(true)
})

test('clean sessions are not offered', async () => {
  const ws = await Workspace.create(root)
  await ws.write(project(), meta(false))
  expect(await Workspace.findRecoverable(root)).toEqual([])
})

test('corrupt dirs are skipped; missing root gives empty', async () => {
  const ws = await Workspace.create(root)
  await ws.write(project(), meta(true))
  const bad = join(root, 'bad')
  mkdirSync(bad)
  writeFileSync(join(bad, 'session.json'), '{nope')
  mkdirSync(join(root, 'empty'))
  expect(await Workspace.findRecoverable(root)).toHaveLength(1)
  expect(await Workspace.findRecoverable(join(root, 'missing'))).toEqual([])
})

test('adopt wraps an existing dir', async () => {
  const ws = await Workspace.create(root)
  const again = Workspace.adopt(ws.dir)
  expect(again.dir).toBe(ws.dir)
  expect(again.framesDir).toBe(ws.framesDir)
})

test('disposed workspace is not offered for recovery', async () => {
  const ws = await Workspace.create(root)
  await ws.write(project(), meta(true))
  await ws.dispose()
  expect(existsSync(ws.dir)).toBe(false)
  expect(await Workspace.findRecoverable(root)).toEqual([])
})

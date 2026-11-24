import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ProjectFile } from '../core/types'

export interface SessionMeta {
  videoOrigin: { kind: 'file'; path: string } | { kind: 'fbproj'; path: string } | null
  savedPath: string | null
  dirty: boolean
}

/** Writes via a temp file in the same directory, then renames over the target. */
async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(tmp, data, 'utf8')
    await rename(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}

/** Per-session scratch directory: project.json, session.json and frames/<id>.png. */
export class Workspace {
  readonly framesDir: string

  private constructor(readonly dir: string) {
    this.framesDir = join(dir, 'frames')
  }

  static async create(root: string): Promise<Workspace> {
    const dir = join(root, randomUUID())
    await mkdir(join(dir, 'frames'), { recursive: true })
    return new Workspace(dir)
  }

  static adopt(dir: string): Workspace {
    return new Workspace(dir)
  }

  /** Sessions whose last write was dirty. Unreadable or corrupt session dirs are skipped. */
  static async findRecoverable(root: string): Promise<{ dir: string; meta: SessionMeta; project: ProjectFile }[]> {
    let names: string[]
    try {
      names = await readdir(root)
    } catch {
      return []
    }
    const found: { dir: string; meta: SessionMeta; project: ProjectFile }[] = []
    for (const name of names) {
      const dir = join(root, name)
      try {
        const meta = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8')) as SessionMeta
        if (meta.dirty !== true) continue
        const project = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8')) as ProjectFile
        if (project.formatVersion !== 1 || !Array.isArray(project.frames)) continue
        found.push({ dir, meta, project })
      } catch {
        // not a session dir, or half-written/corrupt: ignore
      }
    }
    return found
  }

  async write(project: ProjectFile, meta: SessionMeta): Promise<void> {
    await writeAtomic(join(this.dir, 'project.json'), JSON.stringify(project))
    await writeAtomic(join(this.dir, 'session.json'), JSON.stringify(meta))
  }

  async dispose(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true })
  }
}

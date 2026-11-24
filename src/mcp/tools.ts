import { realpathSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { ExportLog } from '../core/exportLog'
import { openFbproj } from '../core/fbproj'
import { cropImage, resizeToMax } from '../core/image'
import { numberFrames } from '../core/ordering'

const OUTSIDE = 'Đường dẫn nằm ngoài thư mục gốc được phép.'
const MAX_DEPTH = 6
const DEFAULT_MAX_SIZE = 1568

/** Collects `--root <dir>` / `--root=<dir>` values as absolute paths. */
export function parseRoots(argv: string[]): string[] {
  const roots: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--root') {
      const v = argv[++i]
      if (v) roots.push(resolve(v))
    } else if (a.startsWith('--root=')) {
      const v = a.slice('--root='.length)
      if (v) roots.push(resolve(v))
    }
  }
  return roots
}

const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)

function isInside(root: string, p: string): boolean {
  const r = norm(root)
  const q = norm(p)
  if (q === r) return true
  return q.startsWith(r.endsWith(sep) ? r : r + sep)
}

function realRoots(roots: string[]): string[] {
  const out: string[] = []
  for (const r of roots) {
    try {
      out.push(realpathSync(r))
    } catch {
      // a root that does not exist grants nothing
    }
  }
  return out
}

/**
 * Returns the real (symlink-resolved) path of `p` if it lies inside one of the roots.
 * Only absolute paths are accepted; `..` is normalized and prefix siblings (`clips-other`) are rejected.
 */
export function resolveInsideRoots(roots: string[], p: string): string {
  if (!isAbsolute(p)) throw new Error('Đường dẫn phải là đường dẫn tuyệt đối.')
  const abs = resolve(p)
  const real = realRoots(roots)
  // Lexical check first so a path outside the roots never reveals whether it exists.
  if (![...roots.map((r) => resolve(r)), ...real].some((r) => isInside(r, abs))) throw new Error(OUTSIDE)
  let target: string
  try {
    target = realpathSync(abs)
  } catch {
    throw new Error(`Không tìm thấy: ${abs}`)
  }
  if (!real.some((r) => isInside(r, target))) throw new Error(OUTSIDE)
  return target
}

/** Recursive scan (no symlinks followed, no node_modules, no dot-dirs, bounded depth). */
async function scan(roots: string[], match: (name: string) => boolean): Promise<string[]> {
  const found = new Set<string>()
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable directory
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.') || depth >= MAX_DEPTH) continue
        await walk(join(dir, e.name), depth + 1)
      } else if (e.isFile() && match(e.name)) {
        found.add(join(dir, e.name))
      }
    }
  }
  for (const r of realRoots(roots)) await walk(r, 0)
  return [...found].sort()
}

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
type Result = { content: Content[]; isError?: boolean }

const json = (v: unknown): Content => ({ type: 'text', text: JSON.stringify(v, null, 2) })
const image = (png: Buffer): Content => ({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' })

async function safe(fn: () => Promise<Content[]>): Promise<Result> {
  try {
    return { content: await fn() }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }
  }
}

export function createServer(roots: string[]): McpServer {
  const server = new McpServer({ name: 'flipbook-capture', version: '0.1.0' })
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

  server.registerTool(
    'list_projects',
    { description: 'List .fbproj projects under the allowed root folders.', annotations: readOnly },
    () =>
      safe(async () => {
        const out: { path: string; name: string; frameCount: number; video: string | null }[] = []
        for (const path of await scan(roots, (n) => n.toLowerCase().endsWith('.fbproj'))) {
          try {
            const r = await openFbproj(path)
            try {
              out.push({
                path,
                name: basename(path).replace(/\.fbproj$/i, ''),
                frameCount: r.project.frames.length,
                video: r.project.video?.fileName ?? null
              })
            } finally {
              await r.close()
            }
          } catch {
            // not a valid project: skip
          }
        }
        return [json(out)]
      })
  )

  server.registerTool(
    'list_exports',
    { description: 'List exported flipbooks (*_log.json) under the allowed root folders.', annotations: readOnly },
    () =>
      safe(async () => {
        const out: unknown[] = []
        for (const logPath of await scan(roots, (n) => n.toLowerCase().endsWith('_log.json'))) {
          try {
            const log = JSON.parse(await readFile(logPath, 'utf8')) as ExportLog
            if (!Array.isArray(log.pages) || !Array.isArray(log.frames)) continue
            out.push({
              logPath,
              project: log.project,
              frameCount: log.frameCount,
              pageCount: log.pageCount,
              pages: log.pages.map((p) => p.file)
            })
          } catch {
            // unreadable or not JSON: skip
          }
        }
        return [json(out)]
      })
  )

  server.registerTool(
    'get_project',
    {
      description: 'Read a project: video info and the numbered frame list (index, name, ms, region, crop).',
      inputSchema: { path: z.string().describe('Absolute path of a .fbproj under the allowed roots') },
      annotations: readOnly
    },
    ({ path }) =>
      safe(async () => {
        const reader = await openFbproj(resolveInsideRoots(roots, path))
        try {
          const frames = numberFrames(reader.project.frames).map((f) => ({
            index: f.index,
            name: f.displayName,
            ms: f.ms,
            region: f.region,
            crop: f.crop
          }))
          return [json({ video: reader.project.video, frames })]
        } finally {
          await reader.close()
        }
      })
  )

  server.registerTool(
    'get_flipbook',
    {
      description: 'Read an exported flipbook: the JSON log as text, then each page as a PNG image in page order.',
      inputSchema: { log_path: z.string().describe('Absolute path of a *_log.json under the allowed roots') },
      annotations: readOnly
    },
    ({ log_path }) =>
      safe(async () => {
        const logFile = resolveInsideRoots(roots, log_path)
        const log = JSON.parse(await readFile(logFile, 'utf8')) as ExportLog
        // a log is untrusted data: every page it references must itself be inside the roots
        const pageFiles = log.pages.map((p) => resolveInsideRoots(roots, resolve(dirname(logFile), p.file)))
        const images = await Promise.all(pageFiles.map((f) => readFile(f)))
        return [json(log), ...images.map(image)]
      })
  )

  server.registerTool(
    'get_frame',
    {
      description: 'Fetch one frame (1-based index in the numbered order) with its crop applied, as a PNG.',
      inputSchema: {
        project_path: z.string().describe('Absolute path of a .fbproj under the allowed roots'),
        index: z.number().int().describe('1-based frame index'),
        max_size: z.number().int().min(1).max(8192).default(DEFAULT_MAX_SIZE).describe('Longest edge in pixels')
      },
      annotations: readOnly
    },
    ({ project_path, index, max_size }) =>
      safe(async () => {
        const reader = await openFbproj(resolveInsideRoots(roots, project_path))
        try {
          const frames = numberFrames(reader.project.frames)
          const f = frames[index - 1]
          if (!f) throw new Error(`Chỉ số frame ${index} ngoài khoảng; dự án có ${frames.length} frame (đánh số từ 1).`)
          const src = await reader.readFrame(f.id)
          let png = src
          if (f.crop) {
            const c = await cropImage(src, f.crop)
            png = (c as unknown as { toBuffer(m: 'image/png'): Buffer }).toBuffer('image/png')
          }
          return [image(await resizeToMax(png, max_size))]
        } finally {
          await reader.close()
        }
      })
  )

  return server
}

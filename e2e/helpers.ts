import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron, type ElectronApplication, type Page } from '@playwright/test'

const MAIN = resolve(__dirname, '..', 'out', 'main', 'index.js')

/**
 * Starts the built app (npm run e2e builds first) in E2E mode with a throwaway userData dir,
 * so runs never touch real recovery data. `env` adds/overrides FC_E2E_* variables.
 */
export async function launch(env: Record<string, string> = {}): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await _electron.launch({
    args: [MAIN],
    env: {
      ...(process.env as Record<string, string>),
      FC_E2E: '1',
      FC_E2E_USER_DATA: mkdtempSync(join(tmpdir(), 'fc-e2e-user-')),
      ...env
    }
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  return { app, win }
}

/** Imports a video through the session (no file dialog). */
export async function importVideo(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(async (_e, p) => {
    await (globalThis as unknown as { __fc: { session: { importVideo(p: string): Promise<void> } } }).__fc.session.importVideo(p)
  }, path)
}

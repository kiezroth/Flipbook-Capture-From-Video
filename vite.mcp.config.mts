import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

// Single self-contained CommonJS bundle; only the native canvas addon stays external.
export default defineConfig({
  build: {
    ssr: resolve(root, 'src/mcp/server.ts'),
    outDir: resolve(root, 'out/mcp'),
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      external: ['@napi-rs/canvas'],
      output: { format: 'cjs', entryFileNames: 'server.cjs', codeSplitting: false }
    }
  },
  ssr: { noExternal: true, external: ['@napi-rs/canvas'] }
})

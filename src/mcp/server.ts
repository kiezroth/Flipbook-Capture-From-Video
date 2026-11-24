import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { createServer, parseRoots } from './tools'

// stdout is the protocol channel: diagnostics go to stderr only.
async function main(): Promise<void> {
  const roots = parseRoots(process.argv.slice(2))
  if (roots.length === 0) {
    process.stderr.write('Usage: flipbook-capture-mcp --root <dir> [--root <dir> ...]\nAt least one --root is required.\n')
    process.exit(2)
  }
  await createServer(roots).connect(new StdioServerTransport())
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`)
  process.exit(1)
})

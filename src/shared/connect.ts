// Pure on purpose: the renderer imports this too, to show the command live as the folder list is edited.
export interface ClaudeAddArgs {
  exePath: string
  serverPath: string
  roots: string[]
}

/** Double quotes for the Windows command line; backslashes before the closing quote are doubled so `D:\` stays intact. */
const quote = (s: string): string => `"${s.replace(/\\+$/, (b) => b + b)}"`

/** The `claude mcp add` command that registers the packaged exe (in Node mode) as the read-only MCP server. */
export function claudeAddCommand(a: ClaudeAddArgs): string {
  const roots = a.roots.map((r) => `--root ${quote(r)}`)
  return ['claude mcp add flipbook-capture -e ELECTRON_RUN_AS_NODE=1 --', quote(a.exePath), quote(a.serverPath), ...roots].join(' ')
}

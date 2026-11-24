import { useStore } from './store'

export const SHORTCUTS_TEXT = 'T: chụp · Ctrl+T: chụp vùng · ←/→ ±100ms · , . từng frame'

/** Status bar (spec section 5): shortcuts on the left; the project's file name (or "Untitled"), `*` when unsaved. */
export function StatusBar() {
  const filePath = useStore((s) => s.app?.filePath ?? null)
  const projectName = useStore((s) => s.app?.projectName ?? 'Untitled')
  const dirty = useStore((s) => s.app?.dirty ?? false)
  const name = filePath ? filePath.split(/[\\/]/).pop()! : projectName
  return (
    <footer className="statusbar">
      <span data-testid="status-shortcuts">{SHORTCUTS_TEXT}</span>
      <span data-testid="status-project">{dirty ? `${name} *` : name}</span>
    </footer>
  )
}

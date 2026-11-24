/** Menu items that have a keyboard shortcut; the ids match the application menu item ids. */
export type MenuCommandId = 'new' | 'open' | 'save' | 'saveAs' | 'import' | 'export' | 'undo' | 'redo'

export interface KeyInfo {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  /** Focus is in a text field: Ctrl+Z/Y stay with the field's own text undo. */
  inEditable: boolean
}

/**
 * File/Edit shortcuts (spec section 5). They are read from renderer keydown events and forwarded to main, instead
 * of menu accelerators, so one code path serves real and synthetic (test) key presses.
 */
export function shortcutFor(e: KeyInfo): MenuCommandId | null {
  if (!e.ctrlKey || e.altKey) return null
  const k = e.key.toLowerCase()
  if (e.shiftKey) return k === 's' ? 'saveAs' : null
  switch (k) {
    case 'n':
      return 'new'
    case 'o':
      return 'open'
    case 's':
      return 'save'
    case 'i':
      return 'import'
    case 'e':
      return 'export'
    case 'z':
      return e.inEditable ? null : 'undo'
    case 'y':
      return e.inEditable ? null : 'redo'
    default:
      return null
  }
}

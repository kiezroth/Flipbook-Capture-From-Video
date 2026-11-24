import { Menu, type MenuItemConstructorOptions } from 'electron'

import type { MenuCommandId } from '../shared/shortcuts'

export type Speed = 0.1 | 0.25 | 0.5 | 1

export interface MenuHandlers {
  newProject(): void
  open(): void
  save(): void
  saveAs(): void
  importVideo(): void
  exportFlipbook(): void
  exit(): void
  undo(): void
  redo(): void
  deleteFrame(): void
  setSpeed(speed: Speed): void
  connectClaude(): void
}

/** Items usable only once a video is loaded: per spec, after New only New, Open, Import Video and Exit work. */
const NEEDS_VIDEO = ['save', 'saveAs', 'export', 'deleteFrame', 'speed-0.1', 'speed-0.25', 'speed-0.5', 'speed-1', 'connectClaude']
const SPEEDS: Speed[] = [0.1, 0.25, 0.5, 1]

/**
 * Accelerators are shown but not registered: the renderer forwards the shortcut keys (shared/shortcuts.ts) and main
 * runs the menu item via runMenuCommand, so a key never fires twice and synthetic test keys work too.
 */
export function buildMenu(h: MenuHandlers): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { id: 'new', label: 'New', accelerator: 'CmdOrCtrl+N', registerAccelerator: false, click: () => h.newProject() },
        { id: 'open', label: 'Open', accelerator: 'CmdOrCtrl+O', registerAccelerator: false, click: () => h.open() },
        { id: 'save', label: 'Save', accelerator: 'CmdOrCtrl+S', registerAccelerator: false, click: () => h.save() },
        { id: 'saveAs', label: 'Save As', accelerator: 'CmdOrCtrl+Shift+S', registerAccelerator: false, click: () => h.saveAs() },
        { type: 'separator' },
        { id: 'import', label: 'Import Video', accelerator: 'CmdOrCtrl+I', registerAccelerator: false, click: () => h.importVideo() },
        { id: 'export', label: 'Export Flipbook', accelerator: 'CmdOrCtrl+E', registerAccelerator: false, click: () => h.exportFlipbook() },
        { type: 'separator' },
        { id: 'exit', label: 'Exit', click: () => h.exit() }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { id: 'undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: () => h.undo() },
        { id: 'redo', label: 'Redo', accelerator: 'CmdOrCtrl+Y', registerAccelerator: false, click: () => h.redo() },
        { type: 'separator' },
        // Delete is handled by the renderer keymap (typing in a field is not hijacked).
        { id: 'deleteFrame', label: 'Xóa frame', accelerator: 'Delete', registerAccelerator: false, click: () => h.deleteFrame() }
      ]
    },
    {
      label: 'View',
      submenu: SPEEDS.map(
        (speed): MenuItemConstructorOptions => ({
          id: `speed-${speed}`,
          label: `${speed}x`,
          type: 'radio',
          checked: speed === 1,
          click: () => h.setSpeed(speed)
        })
      )
    },
    {
      label: 'Help',
      submenu: [{ id: 'connectClaude', label: 'Kết nối với Claude', click: () => h.connectClaude() }]
    }
  ]
  const menu = Menu.buildFromTemplate(template)
  updateMenu(menu, { hasVideo: false, canUndo: false, canRedo: false })
  return menu
}

export function updateMenu(menu: Menu, s: { hasVideo: boolean; canUndo: boolean; canRedo: boolean }): void {
  for (const id of NEEDS_VIDEO) {
    const item = menu.getMenuItemById(id)
    if (item) item.enabled = s.hasVideo
  }
  const undo = menu.getMenuItemById('undo')
  if (undo) undo.enabled = s.hasVideo && s.canUndo
  const redo = menu.getMenuItemById('redo')
  if (redo) redo.enabled = s.hasVideo && s.canRedo
}

/** Runs a menu item for a forwarded shortcut, only when the item is currently enabled. */
export function runMenuCommand(menu: Menu, id: MenuCommandId): void {
  const item = menu.getMenuItemById(id)
  if (item?.enabled) item.click()
}

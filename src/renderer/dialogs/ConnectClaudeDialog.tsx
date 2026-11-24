import { useEffect, useState } from 'react'

import type { ConnectInfo } from '@shared/ipc'
import { claudeAddCommand } from '@shared/connect'
import { useStore } from '../store'

/** Help > Kết nối với Claude: the `claude mcp add` command for the read-only MCP server, with editable root folders. */
export function ConnectClaudeDialog() {
  const open = useStore((s) => s.connectOpen)
  return open ? <Form /> : null
}

function Form() {
  const closeConnect = useStore((s) => s.closeConnect)
  const [info, setInfo] = useState<ConnectInfo | null>(null)
  const [roots, setRoots] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    void window.fc.getConnectInfo().then((i) => {
      if (!alive) return
      setInfo(i)
      setRoots(i.roots)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      closeConnect()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeConnect])

  const usable = roots.map((r) => r.trim()).filter((r) => r !== '')
  const command = info && usable.length > 0 ? claudeAddCommand({ exePath: info.exePath, serverPath: info.serverPath, roots: usable }) : ''

  const setRoot = (i: number, v: string): void => setRoots((r) => r.map((x, j) => (j === i ? v : x)))
  const addRoot = async (): Promise<void> => {
    const dir = await window.fc.pickRootDir()
    if (dir) setRoots((r) => (r.includes(dir) ? r : [...r, dir]))
  }
  const copy = async (): Promise<void> => {
    const toast = useStore.getState().showToast
    try {
      await navigator.clipboard.writeText(command)
      toast({ kind: 'info', text: 'Đã chép lệnh' })
    } catch (e) {
      toast({ kind: 'error', text: `Không chép được: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog connect" role="dialog" aria-modal="true" aria-label="Kết nối với Claude" data-testid="connect-dialog">
        <h2>Kết nối với Claude</h2>
        <p>
          Claude Code có thể đọc các dự án và flipbook của bạn (chỉ đọc, không ghi file). Chọn các thư mục Claude được phép xem, rồi chép lệnh bên dưới và dán vào Terminal.
        </p>

        <fieldset>
          <legend>Thư mục Claude được đọc</legend>
          {roots.map((r, i) => (
            <div className="row" key={i}>
              <input type="text" className="wide" value={r} aria-label={`Thư mục ${i + 1}`} onChange={(e) => setRoot(i, e.target.value)} />
              <button type="button" onClick={() => setRoots((x) => x.filter((_, j) => j !== i))}>
                Xóa
              </button>
            </div>
          ))}
          <div className="row">
            <button type="button" onClick={() => void addRoot()}>
              Thêm thư mục…
            </button>
          </div>
        </fieldset>

        {usable.length === 0 && info && (
          <div className="error" role="alert">
            Cần ít nhất một thư mục.
          </div>
        )}
        <textarea className="command" data-testid="connect-command" readOnly rows={5} value={command} />

        <div className="actions">
          <button type="button" onClick={closeConnect}>
            Đóng
          </button>
          <button type="button" className="active" disabled={command === ''} onClick={() => void copy()}>
            Chép
          </button>
        </div>
      </div>
    </div>
  )
}

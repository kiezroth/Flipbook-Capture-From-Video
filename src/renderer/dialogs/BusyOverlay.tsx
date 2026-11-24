import { useStore } from '../store'

/**
 * Covers the window while main reports a long operation (RendererState.busy): label, progress bar (indeterminate when
 * progress is -1) and Hủy when it can be cancelled. aria-modal makes the player keys stand down meanwhile.
 */
export function BusyOverlay() {
  const busy = useStore((s) => s.app?.busy ?? null)
  if (!busy) return null
  const known = busy.progress >= 0
  const pct = Math.round(Math.max(0, Math.min(1, busy.progress)) * 100)
  return (
    <div className="busy-overlay" data-testid="busy" role="dialog" aria-modal="true" aria-label={busy.label}>
      <div className="busy-box">
        <div className="busy-label">{busy.label}</div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? pct : undefined}>
          <div className={known ? 'progress-bar' : 'progress-bar indeterminate'} style={known ? { width: `${pct}%` } : undefined} />
        </div>
        <div className="busy-footer">
          <span>{known ? `${pct}%` : ''}</span>
          {busy.cancellable && (
            <button type="button" onClick={() => window.fc.cancelBusy()}>
              Hủy
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

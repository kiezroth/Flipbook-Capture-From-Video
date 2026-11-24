import { useEffect, useState } from 'react'

import { windowTitle, type RendererState, type Toast } from '@shared/ipc'

// Placeholder shell (Task 10): just enough to play the project video. Tasks 11-13 replace it.
export function App() {
  const [state, setState] = useState<RendererState | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  useEffect(() => {
    let live = true
    const offState = window.fc.onState(setState)
    const offToast = window.fc.onToast(setToast)
    void window.fc.getState().then((s) => live && setState(s))
    return () => {
      live = false
      offState()
      offToast()
    }
  }, [])

  return (
    <div className="app">
      <header>{state ? windowTitle(state) : ''}</header>
      {state?.video && (
        <video src={state.video.url} muted preload="auto" crossOrigin="anonymous" onError={() => window.fc.reportVideoError()} />
      )}
      {state?.busy && <div data-testid="busy">{state.busy.label}</div>}
      {toast && <div data-testid="toast">{toast.text}</div>}
    </div>
  )
}

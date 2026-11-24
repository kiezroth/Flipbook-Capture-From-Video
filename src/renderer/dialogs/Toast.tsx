import { useEffect } from 'react'

import { useStore } from '../store'

const SHOW_MS = { info: 3000, error: 6000 } as const

/** The latest notice (store.showToast); disappears after a few seconds or on click. */
export function Toast() {
  const toast = useStore((s) => s.toast)
  const toastId = useStore((s) => s.toastId)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => {
      if (useStore.getState().toastId === toastId) useStore.getState().showToast(null)
    }, SHOW_MS[toast.kind])
    return () => clearTimeout(timer)
  }, [toast, toastId])

  if (!toast) return null
  return (
    <div
      className={`toast ${toast.kind}`}
      data-testid="toast"
      role={toast.kind === 'error' ? 'alert' : 'status'}
      onClick={() => useStore.getState().showToast(null)}
    >
      {toast.text}
    </div>
  )
}

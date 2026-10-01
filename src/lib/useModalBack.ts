import { useEffect, useRef } from 'react'

/** Makes the browser/Android Back button close an open dialog before leaving its page. */
export function useModalBack(
  isOpen: boolean,
  onClose: () => void,
  hasUnsavedChanges = false,
  discardMessage = 'Discard your unsaved changes and close this dialog?'
) {
  const closeRef = useRef(onClose)
  const dirtyRef = useRef(hasUnsavedChanges)
  const messageRef = useRef(discardMessage)
  useEffect(() => {
    closeRef.current = onClose
    dirtyRef.current = hasUnsavedChanges
    messageRef.current = discardMessage
  }, [onClose, hasUnsavedChanges, discardMessage])

  useEffect(() => {
    if (!isOpen) return
    const token = `rr-dialog-${crypto.randomUUID()}`
    let closedByBack = false
    let cancelled = false
    let installed = false
    const handlePopState = (event: PopStateEvent) => {
      event.stopImmediatePropagation()
      if (dirtyRef.current && !window.confirm(messageRef.current)) {
        window.history.pushState({ ...(window.history.state || {}), rrDialog: token }, '', window.location.href)
        return
      }
      closedByBack = true
      closeRef.current()
    }
    // Deferring setup avoids leaving a stale entry during React StrictMode's
    // development-only setup/cleanup replay.
    queueMicrotask(() => {
      if (cancelled) return
      window.history.pushState({ ...(window.history.state || {}), rrDialog: token }, '', window.location.href)
      window.addEventListener('popstate', handlePopState)
      installed = true
    })
    return () => {
      cancelled = true
      if (installed) {
        window.removeEventListener('popstate', handlePopState)
        if (!closedByBack && window.history.state?.rrDialog === token) window.history.back()
      }
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !hasUnsavedChanges) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [isOpen, hasUnsavedChanges])
}

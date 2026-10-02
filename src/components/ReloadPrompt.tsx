import React from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw, X, ArrowDownToLine } from 'lucide-react'

export default function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered')
      
      // Force the PWA to check for updates every time the window comes into focus
      if (r) {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            r.update()
          }
        })
      }
    },
    onRegisterError() {
      console.error('Service worker registration failed')
    }
  })

  const close = () => {
    setNeedRefresh(false)
  }

  const handleUpdate = () => {
    // Tell the service worker to take over, then forcefully reload the window
    updateServiceWorker(true).then(() => {
      window.location.reload()
    })
  }

  if (!needRefresh) return null

  return (
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[100] w-11/12 max-w-sm p-4 bg-emerald-500/90 backdrop-blur-xl border border-emerald-400/50 rounded-3xl shadow-[0_10px_40px_rgba(16,185,129,0.3)] animate-in slide-in-from-bottom-8 duration-500">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center">
          <div className="p-2 bg-white/20 rounded-full mr-3">
            <ArrowDownToLine className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-black text-white text-sm uppercase tracking-wide">Update Available</h3>
            <p className="text-xs text-emerald-100 mt-0.5">A new version of RR Capital is ready.</p>
          </div>
        </div>
        <button onClick={close} className="p-1.5 text-emerald-200 hover:text-white bg-black/10 hover:bg-black/20 rounded-full transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      
      <button 
        onClick={handleUpdate} 
        className="w-full flex items-center justify-center py-3 bg-white text-emerald-900 rounded-xl font-black transition-all hover:scale-[1.02] shadow-lg"
      >
        <RefreshCw className="w-4 h-4 mr-2" /> Update Now
      </button>
    </div>
  )
}

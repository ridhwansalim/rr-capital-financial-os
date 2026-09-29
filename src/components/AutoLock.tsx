import { useState, useEffect, useCallback } from "react"
import { Lock } from "lucide-react"

export default function AutoLock() {
  const [isLocked, setIsLocked] = useState(false)
  const [pin, setPin] = useState("")
  const [error, setError] = useState(false)
  
  const [savedPin, setSavedPin] = useState(localStorage.getItem('device_pin'))
  const [isSettingPin, setIsSettingPin] = useState(!savedPin)

  // 1. Read user preferences from device storage (Defaults: Enabled, 3 minutes)
  const [isEnabled, setIsEnabled] = useState(localStorage.getItem('autolock_enabled') !== 'false')
  const [timeoutMs, setTimeoutMs] = useState(parseInt(localStorage.getItem('autolock_timeout') || '180000'))

  // 2. Listen for real-time changes from the Profile settings page
  useEffect(() => {
    const handleSettingsUpdate = () => {
      setIsEnabled(localStorage.getItem('autolock_enabled') !== 'false')
      setTimeoutMs(parseInt(localStorage.getItem('autolock_timeout') || '180000'))
    }
    window.addEventListener('settings-updated', handleSettingsUpdate)
    return () => window.removeEventListener('settings-updated', handleSettingsUpdate)
  }, [])

  const lockApp = useCallback(() => {
    // Only lock if they have a PIN AND the feature is turned on
    if (localStorage.getItem('device_pin') && isEnabled) {
      setIsLocked(true)
    }
  }, [isEnabled])

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>

    const resetTimer = () => {
      clearTimeout(timeoutId)
      // Only run the timer if the feature is enabled
      if (!isLocked && isEnabled) {
        timeoutId = setTimeout(lockApp, timeoutMs)
      }
    }

    const events = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click']
    events.forEach(event => window.addEventListener(event, resetTimer))
    
    resetTimer()

    return () => {
      clearTimeout(timeoutId)
      events.forEach(event => window.removeEventListener(event, resetTimer))
    }
  }, [isLocked, lockApp, isEnabled, timeoutMs])

  const handleKeypad = (num: string) => {
    if (pin.length < 4) {
      const newPin = pin + num
      setPin(newPin)
      setError(false)

      if (newPin.length === 4) {
        setTimeout(() => {
          if (isSettingPin) {
            localStorage.setItem('device_pin', newPin)
            setSavedPin(newPin)
            setIsSettingPin(false)
            setIsLocked(false)
            setPin("")
          } else {
            if (newPin === savedPin) {
              setIsLocked(false)
              setPin("")
            } else {
              setError(true)
              setPin("") 
            }
          }
        }, 200)
      }
    }
  }

  // 3. If they toggled it OFF in settings, completely hide the shield and PIN setup
  if (!isEnabled) return null

  if (!isLocked && !isSettingPin) return null

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-900/40 backdrop-blur-md transition-all duration-300">
      <div className="bg-white p-8 rounded-3xl shadow-2xl flex flex-col items-center max-w-[300px] w-full border border-slate-200">
        <div className={`p-4 rounded-full mb-4 transition-colors ${error ? 'bg-red-100 text-red-500' : 'bg-slate-100 text-slate-900'}`}>
          <Lock className="w-8 h-8" />
        </div>
        
        <h2 className="text-xl font-bold text-slate-900 mb-1">
          {isSettingPin ? "Create Device PIN" : "App Locked"}
        </h2>
        <p className="text-sm text-slate-500 mb-6 text-center">
          {isSettingPin ? "Set a 4-digit PIN to secure your ledger on this device." : "Enter your 4-digit PIN to unlock."}
        </p>

        <div className="flex gap-3 mb-8">
          {[...Array(4)].map((_, i) => (
            <div 
              key={i} 
              className={`w-4 h-4 rounded-full transition-all ${
                i < pin.length ? 'bg-slate-900 scale-110' : 'bg-slate-200'
              } ${error ? 'bg-red-500 animate-pulse' : ''}`}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4 w-full">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button 
              key={num} 
              onClick={() => handleKeypad(num.toString())}
              className="h-14 bg-slate-50 rounded-xl text-xl font-semibold text-slate-900 hover:bg-slate-200 active:scale-95 transition-all"
            >
              {num}
            </button>
          ))}
          <div className="col-start-2">
            <button 
              onClick={() => handleKeypad("0")}
              className="w-full h-14 bg-slate-50 rounded-xl text-xl font-semibold text-slate-900 hover:bg-slate-200 active:scale-95 transition-all"
            >
              0
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
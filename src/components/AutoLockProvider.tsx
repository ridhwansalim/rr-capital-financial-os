import React, { useState, useEffect, useCallback } from 'react'
import { Lock, Delete, Fingerprint } from 'lucide-react'

// WebAuthn Helper to decode saved hardware keys
const base64ToArrayBuffer = (base64: string) => {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

export function AutoLockProvider({ children }: { children: React.ReactNode }) {
  const [isLocked, setIsLocked] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [error, setError] = useState(false)
  const [hasBiometrics, setHasBiometrics] = useState(false)

  const checkLockState = useCallback(() => {
    const isAutoLockEnabled = localStorage.getItem('financial_os_autolock') === 'true'
    const lockTimeMinutes = parseInt(localStorage.getItem('financial_os_lock_time') || '3', 10)
    const lastActive = localStorage.getItem('financial_os_last_active')
    const hasValidPin = /^\d{4}$/.test(localStorage.getItem('financial_os_pin') || '')

    if (isAutoLockEnabled && hasValidPin && lastActive) {
      const timePassed = Date.now() - parseInt(lastActive, 10)
      if (timePassed > (lockTimeMinutes * 60 * 1000)) {
        setIsLocked(true)
      }
    }
  }, [])

  useEffect(() => {
    const handleActivity = () => {
      if (!isLocked) localStorage.setItem('financial_os_last_active', Date.now().toString())
    }

    checkLockState()
    handleActivity()

    window.addEventListener('mousemove', handleActivity)
    window.addEventListener('keydown', handleActivity)
    window.addEventListener('touchstart', handleActivity)
    window.addEventListener('click', handleActivity)

    const interval = setInterval(checkLockState, 5000)

    // Check if we have registered biometric devices locally
    const devices = JSON.parse(localStorage.getItem('financial_os_devices') || '[]')
    const isBioEnabled = localStorage.getItem('financial_os_bio_enabled') === 'true'
    setHasBiometrics(isBioEnabled && devices.length > 0)

    return () => {
      window.removeEventListener('mousemove', handleActivity)
      window.removeEventListener('keydown', handleActivity)
      window.removeEventListener('touchstart', handleActivity)
      window.removeEventListener('click', handleActivity)
      clearInterval(interval)
    }
  }, [isLocked, checkLockState])

  const handlePinPress = (digit: string) => {
    if (pinInput.length < 4) {
      const newPin = pinInput + digit
      setPinInput(newPin)
      setError(false)
      
      if (newPin.length === 4) {
        const savedPin = localStorage.getItem('financial_os_pin') || ''
        if (/^\d{4}$/.test(savedPin) && newPin === savedPin) {
          setIsLocked(false)
          setPinInput('')
          localStorage.setItem('financial_os_last_active', Date.now().toString())
        } else {
          setError(true)
          setTimeout(() => setPinInput(''), 500)
        }
      }
    }
  }

  const handleDelete = () => {
    setPinInput(prev => prev.slice(0, -1))
    setError(false)
  }

  // Hardware WebAuthn Request
  const triggerBiometricUnlock = async () => {
    try {
      const savedDevices = JSON.parse(localStorage.getItem('financial_os_devices') || '[]')
      if (savedDevices.length === 0) return

      const challenge = window.crypto.getRandomValues(new Uint8Array(32))
      const allowCredentials = savedDevices.map((d: any) => ({
        id: base64ToArrayBuffer(d.id),
        type: 'public-key'
      }))

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials,
          userVerification: "required",
          timeout: 60000
        }
      })

      if (assertion) {
        setIsLocked(false)
        setPinInput('')
        localStorage.setItem('financial_os_last_active', Date.now().toString())
      }
    } catch (err: any) {
      console.warn("Biometric auth failed", err)
      setError(true)
      setTimeout(() => setError(false), 800)
    }
  }

  // Trigger FaceID immediately if locked and available
  useEffect(() => {
    if (isLocked && hasBiometrics) {
      triggerBiometricUnlock()
    }
  }, [isLocked, hasBiometrics])

  if (isLocked) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/80 backdrop-blur-3xl text-white transition-all">
        <div className="flex flex-col items-center animate-in zoom-in-95 duration-300 w-full max-w-sm px-6">
          <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6 border border-emerald-500/30">
            <Lock className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">App Locked</h2>
          <p className="text-slate-400 mb-8 text-sm">Enter PIN or use Biometrics</p>
          
          <div className="flex space-x-6 mb-10">
            {[...Array(4)].map((_, i) => (
              <div 
                key={i}
                className={`w-4 h-4 rounded-full transition-all duration-200 ${
                  i < pinInput.length ? 'bg-emerald-400 scale-125 shadow-[0_0_15px_rgba(52,211,153,0.5)]' : 'bg-white/10'
                } ${error ? 'bg-rose-500 animate-bounce' : ''}`}
              />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-6 w-full max-w-[260px]">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
              <button
                key={num} onClick={() => handlePinPress(num.toString())}
                className="w-16 h-16 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center text-2xl font-semibold transition-colors border border-white/5 mx-auto"
              >
                {num}
              </button>
            ))}
            
            {hasBiometrics ? (
              <button
                onClick={triggerBiometricUnlock}
                className="w-16 h-16 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 flex items-center justify-center transition-colors border border-emerald-500/30 mx-auto shadow-[0_0_15px_rgba(52,211,153,0.2)]"
              >
                <Fingerprint className="w-7 h-7" />
              </button>
            ) : <div />}
            
            <button
              onClick={() => handlePinPress('0')}
              className="w-16 h-16 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center text-2xl font-semibold transition-colors border border-white/5 mx-auto"
            >
              0
            </button>
            <button
              onClick={handleDelete}
              className="w-16 h-16 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center transition-colors border border-white/5 text-slate-400 hover:text-white mx-auto"
            >
              <Delete className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
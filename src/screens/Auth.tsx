import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { safeCaughtErrorMessage } from '../lib/safeErrorMessages'
import { Mail, Lock, Loader2, LogIn, AlertCircle, CheckCircle2 } from 'lucide-react'

type AuthMode = 'login' | 'invite' | 'recovery'

function getInitialAuthMode(): AuthMode {
  const query = new URLSearchParams(window.location.search)
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const mode = query.get('mode') || query.get('type') || fragment.get('type')

  if (mode === 'invite' || mode === 'recovery') return mode
  return 'login'
}

export default function Auth() {
  const [authMode, setAuthMode] = useState<AuthMode>(getInitialAuthMode)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setAuthMode('recovery')
        setMessage(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsLoading(true)
    setMessage(null)

    try {
      if (authMode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        window.location.replace('/')
        return
      }

      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!session) {
        throw new Error('This invite or recovery link is expired. Ask Ridhu to send a new invitation or request a new password reset.')
      }

      if (password !== passwordConfirmation) throw new Error('Passwords do not match.')

      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error

      setMessage({
        type: 'success',
        text: authMode === 'invite' ? 'Your account is ready. Opening RR Capital...' : 'Your password was updated. Opening RR Capital...'
      })
      window.setTimeout(() => window.location.replace('/'), 900)
    } catch (error) {
      setMessage({ type: 'error', text: safeCaughtErrorMessage(error, 'Authentication failed. Check your sign-in details or invite link and try again.') })
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasswordReset = async () => {
    if (!email.trim()) {
      setMessage({ type: 'error', text: 'Enter your email address first, then request a password reset.' })
      return
    }

    setIsLoading(true)
    setMessage(null)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin + '/auth?mode=recovery'
      })
      if (error) throw error
      setMessage({ type: 'success', text: 'If an account exists for that email, a password reset link will be sent.' })
    } catch (error) {
      setMessage({ type: 'error', text: safeCaughtErrorMessage(error, 'Unable to request a password reset. Check your email address and try again.') })
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleAuth = async () => {
    setIsLoading(true)
    setMessage(null)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/' }
      })
      if (error) throw error
    } catch (error) {
      setMessage({ type: 'error', text: safeCaughtErrorMessage(error, 'Google sign-in failed. Please try again.') })
      setIsLoading(false)
    }
  }

  const isSettingPassword = authMode !== 'login'
  const title = authMode === 'invite' ? 'Accept your invitation' : authMode === 'recovery' ? 'Reset your password' : 'Welcome back'

  return (
    <div className="app-auth-page relative flex min-h-screen items-center justify-center overflow-hidden bg-[#faf9f5] p-4 font-sans text-[#171714] sm:p-8">
      <div className="pointer-events-none absolute -left-28 -top-28 h-96 w-96 rounded-full bg-[#eaded0]/70 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-20 h-96 w-96 rounded-full bg-[#e8ece4]/80 blur-3xl" />

      <div className="app-auth-card relative z-10 grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-[#e7e1d8] bg-white shadow-[0_28px_90px_rgba(40,34,25,.12)] animate-in fade-in zoom-in-95 duration-500 md:grid-cols-[.9fr_1.1fr]">
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#211f1b] p-10 text-[#faf9f5] md:flex lg:p-14">
          <div className="absolute -right-24 top-20 h-72 w-72 rounded-full border border-white/10" /><div className="absolute -right-12 top-32 h-48 w-48 rounded-full border border-white/10" />
          <div className="relative"><img src="/rr-favicon.svg" alt="" className="h-12 w-12 rounded-xl bg-white p-1.5" /><p className="mt-8 text-xs font-semibold uppercase tracking-[.22em] text-[#e3a28a]">A calmer money workspace</p><h2 className="mt-4 max-w-sm font-serif text-4xl leading-tight">Your everyday finances, in one clear place.</h2><p className="mt-5 max-w-sm text-sm leading-6 text-white/65">Private records for your accounts, spending, commitments and the people you share them with.</p></div>
          <p className="relative text-xs text-white/45">RR Capital · Personal use</p>
        </aside>
        <div className="min-w-0 p-6 sm:p-10 lg:p-14">
        <div className="flex flex-col items-center mb-8">
          <img src="/rr-logo.svg" alt="RR Capital" className="h-16 mb-5 rounded-xl" />
          <h1 className="text-2xl font-normal tracking-tight text-[var(--ink)]" style={{ fontFamily: 'var(--font-display)' }}>{title}</h1>
          <p className="text-[#6c6a64] text-sm mt-2 text-center">
            {authMode === 'invite'
              ? 'Choose a password to finish setting up your invited account.'
              : authMode === 'recovery'
                ? 'Choose a new password for your account.'
                : 'Sign in to your personal finance workspace.'}
          </p>
        </div>

        {message && (
          <div className={'p-4 rounded-xl mb-6 flex items-start text-sm ' + (message.type === 'error' ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400' : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400')} role={message.type === 'error' ? 'alert' : 'status'}>
            {message.type === 'error' ? <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0" /> : <CheckCircle2 className="w-5 h-5 mr-3 flex-shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          {!isSettingPassword && (
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="Email Address"
                aria-label="Email address"
                value={email}
                onChange={event => setEmail(event.target.value)}
                className="w-full bg-[var(--surface-soft)] border border-[var(--line)] rounded-lg pl-10 pr-4 py-3 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--brand-primary)] transition-all"
              />
            </div>
          )}

          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="password"
              required
              minLength={isSettingPassword ? 12 : undefined}
              autoComplete={isSettingPassword ? 'new-password' : 'current-password'}
              placeholder={isSettingPassword ? 'New Password' : 'Password'}
              aria-label={isSettingPassword ? 'New password' : 'Password'}
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="w-full bg-[var(--surface-soft)] border border-[var(--line)] rounded-lg pl-10 pr-4 py-3 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--brand-primary)] transition-all"
              />
          </div>

          {isSettingPassword && <p className="-mt-2 text-xs text-slate-400">Use at least 12 characters.</p>}

          {isSettingPassword && (
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                placeholder="Confirm New Password"
                aria-label="Confirm new password"
                value={passwordConfirmation}
                onChange={event => setPasswordConfirmation(event.target.value)}
                className="w-full bg-[var(--surface-soft)] border border-[var(--line)] rounded-lg pl-10 pr-4 py-3 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--brand-primary)] transition-all"
              />
            </div>
          )}

          <button type="submit" disabled={isLoading} className="app-auth-primary w-full flex items-center justify-center py-3 rounded-lg bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-active)] text-white font-semibold transition-all shadow-md disabled:opacity-50 mt-2">
            {isLoading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <>{authMode === 'login' ? <LogIn className="w-4 h-4 mr-2" /> : null}{authMode === 'login' ? 'Sign in' : 'Set Password'}</>}
          </button>
        </form>

        {authMode === 'login' ? (
          <>
            <div className="mt-4 text-right">
              <button type="button" onClick={handlePasswordReset} disabled={isLoading} className="text-sm text-accent-400 font-semibold hover:underline disabled:opacity-50">
                Forgot password?
              </button>
            </div>

            <div className="mt-6 mb-6 flex items-center text-[#858178] text-xs uppercase tracking-wider">
              <div className="flex-1 border-t border-[#e7e1d8]" />
              <span className="px-4">Or continue with</span>
              <div className="flex-1 border-t border-[#e7e1d8]" />
            </div>

            <button type="button" onClick={handleGoogleAuth} disabled={isLoading} className="w-full flex items-center justify-center py-3 rounded-xl bg-white hover:bg-[#faf9f5] border border-[#e7e1d8] text-[#252523] font-semibold transition-all mb-6 disabled:opacity-50">
              <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Continue with Google
            </button>

            <p className="text-center text-sm text-[#6c6a64]">
              Access is invitation-only. Ask Ridhu to invite your email address.
            </p>
          </>
        ) : (
          <>
            <p className="text-center text-sm text-slate-400 mt-5">
              {authMode === 'invite' ? 'Only use this page after opening your RR Capital invitation email.' : 'Use the password reset link sent to your email.'}
            </p>
            <button
              type="button"
              onClick={() => { setAuthMode('login'); setPassword(''); setPasswordConfirmation(''); setMessage(null) }}
              className="w-full mt-4 text-sm text-accent-400 font-semibold hover:underline"
            >
              Back to sign in
            </button>
          </>
        )}
        </div>
      </div>
    </div>
  )
}

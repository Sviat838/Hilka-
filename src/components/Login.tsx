import { useState } from 'react'
import { supabase } from '../lib/supabase'
import analytics from '../lib/analytics'
import { HANDOFF_KEY } from '../lib/seed'

type Mode = 'signin' | 'signup' | 'forgot'

// The /demo "Make your own" CTA lands here as /?signup=1, so open straight on the
// create-account form (and tell them their edited demo tree is waiting).
const params = new URLSearchParams(window.location.search)
const WANTS_SIGNUP = params.get('signup') === '1'
const HAS_HANDOFF = (() => {
  try {
    return !!localStorage.getItem(HANDOFF_KEY)
  } catch {
    return false
  }
})()

// a coarse, non-PII reason code for a failed auth attempt
const errCode = (error: { code?: string; status?: number }): string | number | undefined =>
  error.code ?? error.status

const LABEL: Record<Mode, { idle: string; busy: string }> = {
  signin: { idle: 'Sign in', busy: 'Signing in…' },
  signup: { idle: 'Create account', busy: 'Creating account…' },
  forgot: { idle: 'Send reset link', busy: 'Sending…' },
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.574l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  )
}

export function Login() {
  const [mode, setMode] = useState<Mode>(WANTS_SIGNUP ? 'signup' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const go = (m: Mode) => {
    setMode(m)
    setError(null)
    setNotice(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
        analytics.track('Auth Failed', { action: 'sign_in', code: errCode(error) })
      }
      // on success the 'Signed In' event is sent from App's auth listener
    } else if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) {
        setError(error.message)
        analytics.track('Auth Failed', { action: 'sign_up', code: errCode(error) })
      } else {
        // With email confirmation ON (current default) signUp returns no session,
        // so only 'Signed Up' fires here; 'Signed In' comes later at first real
        // login. If confirmation is OFF, the immediate session also makes App's
        // auth listener emit 'Signed In' — a new signup counts as both, by design.
        analytics.track('Signed Up', { method: 'password', requires_confirmation: !data.session })
        if (!data.session) setNotice('Almost there — check your inbox to confirm your account.')
      }
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      })
      if (error) {
        setError(error.message)
        analytics.track('Auth Failed', { action: 'password_reset', code: errCode(error) })
      } else {
        analytics.track('Password Reset Requested')
        setNotice('If that email has an account, a password-reset link is on its way.')
      }
    }
    setBusy(false)
  }

  const withGoogle = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    // On success the browser redirects to Google; we only get here on failure.
    if (error) {
      setError(error.message)
      analytics.track('Auth Failed', { action: 'oauth', provider: 'google', code: errCode(error) })
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="app-name">Hilka</h1>
        <p className="app-tag">Log your thinking, step by step.</p>

        {mode === 'signup' && HAS_HANDOFF && (
          <p className="login-notice login-keep">
            Your demo tree is saved on this device — create an account to keep it.
          </p>
        )}

        {mode !== 'forgot' && (
          <>
            <button
              type="button"
              className="btn btn-google login-btn"
              onClick={withGoogle}
              disabled={busy}
            >
              <GoogleMark />
              <span>Continue with Google</span>
            </button>
            <div className="login-or">
              <span>or</span>
            </div>
          </>
        )}

        <form onSubmit={submit}>
          <label className="field">
            <span className="field-label">Email</span>
            <input
              className="field-input"
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          {mode !== 'forgot' && (
            <label className="field">
              <span className="field-label field-label-row">
                Password
                {mode === 'signin' && (
                  <button type="button" className="link-btn" onClick={() => go('forgot')}>
                    Forgot?
                  </button>
                )}
              </span>
              <input
                className="field-input"
                type="password"
                value={password}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                minLength={6}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}

          {error && <p className="login-error">{error}</p>}
          {notice && <p className="login-notice">{notice}</p>}

          <button className="btn btn-primary login-btn" type="submit" disabled={busy}>
            {busy ? LABEL[mode].busy : LABEL[mode].idle}
          </button>
        </form>

        <p className="login-switch">
          {mode === 'signin' && (
            <>
              New to Hilka?{' '}
              <button type="button" className="link-btn" onClick={() => go('signup')}>
                Create an account
              </button>
            </>
          )}
          {mode === 'signup' && (
            <>
              Already have an account?{' '}
              <button type="button" className="link-btn" onClick={() => go('signin')}>
                Sign in
              </button>
            </>
          )}
          {mode === 'forgot' && (
            <button type="button" className="link-btn" onClick={() => go('signin')}>
              ← Back to sign in
            </button>
          )}
        </p>

        {mode === 'signin' && (
          <p className="login-demo">
            <a href="/demo">Curious first? See a live example — no signup →</a>
          </p>
        )}
      </div>
    </div>
  )
}

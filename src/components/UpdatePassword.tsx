import { useState } from 'react'
import { supabase } from '../lib/supabase'
import analytics from '../lib/analytics'

/**
 * Shown when the user arrives via a password-reset link. Supabase establishes a
 * temporary recovery session (PASSWORD_RECOVERY event), and we let them set a new
 * password here before dropping them into the app.
 */
export function UpdatePassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }
    analytics.track('Password Changed')
    onDone()
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1 className="app-name">Hilka</h1>
        <p className="app-tag">Choose a new password.</p>
        <label className="field">
          <span className="field-label">New password</span>
          <input
            className="field-input"
            type="password"
            value={password}
            autoComplete="new-password"
            required
            minLength={6}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Confirm password</span>
          <input
            className="field-input"
            type="password"
            value={confirm}
            autoComplete="new-password"
            required
            minLength={6}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button className="btn btn-primary login-btn" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </div>
  )
}

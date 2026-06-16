import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import analytics from '../lib/analytics'
import { Login } from './Login'

/**
 * OAuth 2.1 consent screen for Supabase's OAuth server. When an AI assistant
 * starts the login flow, Supabase redirects the user's browser here (the path
 * configured as `authorization_url_path`) with an `authorization_id`. We confirm
 * the user is signed in, show what the assistant is asking for, and approve/deny.
 *
 * The MCP server itself never sees the password — Supabase handles auth; this
 * page only renders consent and calls supabase.auth.oauth.* with the user's
 * session. See business_analysis/plugin-architecture.md.
 */
interface ClientInfo {
  id: string
  name: string
  uri: string
  logo_uri: string
}
interface AuthorizationDetails {
  authorization_id: string
  client: ClientInfo
  user: { id: string; email: string }
  scope: string
}

const SCOPE_LABELS: Record<string, string> = {
  openid: 'Confirm who you are',
  email: 'See your email address',
  profile: 'See your basic profile',
  'chains:write': 'Create thought chains in your journal',
  'chains:read': 'Read your thought chains',
}

export function OAuthConsent({ session, ready }: { session: Session | null; ready: boolean }) {
  const authId = new URLSearchParams(window.location.search).get('authorization_id')
  const [details, setDetails] = useState<AuthorizationDetails | null>(null)
  const [phase, setPhase] = useState<'loading' | 'consent' | 'working' | 'error'>('loading')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!ready || !session || !authId) return
    let cancelled = false
    setPhase('loading')
    ;(async () => {
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authId)
      if (cancelled) return
      if (error) {
        setErr(error.message)
        setPhase('error')
        return
      }
      // Already consented → Supabase hands back a finished redirect URL.
      if (data && 'redirect_url' in data) {
        window.location.href = (data as { redirect_url: string }).redirect_url
        return
      }
      const d = data as unknown as AuthorizationDetails
      analytics.track('OAuth Consent Shown', { client: (d.client?.name ?? '').slice(0, 60) })
      setDetails(d)
      setPhase('consent')
    })()
    return () => {
      cancelled = true
    }
  }, [ready, session, authId])

  if (!authId) {
    return (
      <div className="login-page">
        <div className="center-note">
          This page connects an AI assistant — open it from your assistant’s “add connector” flow.
        </div>
      </div>
    )
  }
  if (!ready) {
    return (
      <div className="login-page">
        <div className="center-note">Loading…</div>
      </div>
    )
  }
  // Not signed in → reuse the normal login; once authenticated, App re-renders
  // here with a session and the consent flow continues.
  if (!session) return <Login />

  const decide = async (approve: boolean) => {
    setErr(null)
    setPhase('working')
    const fn = approve
      ? supabase.auth.oauth.approveAuthorization(authId, { skipBrowserRedirect: true })
      : supabase.auth.oauth.denyAuthorization(authId, { skipBrowserRedirect: true })
    const { data, error } = await fn
    if (error) {
      setErr(error.message)
      setPhase('error')
      return
    }
    analytics.track(approve ? 'OAuth Consent Approved' : 'OAuth Consent Denied', {
      client: (details?.client?.name ?? '').slice(0, 60),
    })
    if (data?.redirect_url) {
      window.location.href = data.redirect_url
    } else {
      setErr('No redirect from Supabase — please retry from your assistant.')
      setPhase('error')
    }
  }

  const scopes = (details?.scope ?? '').split(/\s+/).filter(Boolean)
  const working = phase === 'working'
  // The client name is attacker-influenced (anyone can register an OAuth client);
  // cap its length so a deceptive/over-long name can't dominate the consent card.
  // Still rendered as React-escaped text — never as HTML.
  const rawName = (details?.client?.name ?? '').trim()
  const clientName = rawName.length > 60 ? rawName.slice(0, 60) + '…' : rawName || 'An application'

  return (
    <div className="login-page">
      <div className="login-card consent-card">
        <h1 className="app-name">Hilka</h1>
        {phase === 'loading' && <p className="app-tag">Preparing your request…</p>}
        {phase === 'error' && <p className="login-error">{err}</p>}
        {details && (phase === 'consent' || phase === 'working' || phase === 'error') && (
          <>
            <p className="consent-lead">
              <strong>{clientName}</strong> wants to connect to your Hilka
              account and:
            </p>
            <ul className="consent-scopes">
              {scopes.length ? (
                scopes.map((s) => <li key={s}>{SCOPE_LABELS[s] ?? s}</li>)
              ) : (
                <li>Create thought chains in your journal</li>
              )}
            </ul>
            <p className="consent-acct">
              Signed in as {details.user?.email ?? session.user.email}
            </p>
            <div className="consent-actions">
              <button className="btn btn-ghost" disabled={working} onClick={() => void decide(false)}>
                Deny
              </button>
              <button className="btn btn-primary" disabled={working} onClick={() => void decide(true)}>
                {working ? 'Connecting…' : 'Allow'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

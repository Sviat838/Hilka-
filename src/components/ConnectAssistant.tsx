import { useEffect, useRef, useState } from 'react'
import analytics from '../lib/analytics'
import { MCP_URL } from '../lib/pat'
import { usePats, useCreatePat, useRevokePat, type PatRow } from '../hooks/usePats'
import { ConnectGuide } from './ConnectGuide'

/**
 * "Connect your AI assistant" — mint / list / revoke Personal Access Tokens and
 * show how to wire the Hilka MCP server into Claude, ChatGPT, Grok, etc. A freshly
 * minted token is shown exactly once (only its hash is stored).
 */
export function ConnectAssistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const modalRef = useRef<HTMLDivElement>(null)
  const { data: pats, isLoading } = usePats()
  const createPat = useCreatePat()
  const revokePat = useRevokePat()

  const [name, setName] = useState('')
  const [freshToken, setFreshToken] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // reset transient state each time the modal opens
  useEffect(() => {
    if (open) {
      setName('')
      setFreshToken(null)
      setErr(null)
    }
  }, [open])

  // Esc to close + focus the dialog on open
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    modalRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const generate = async () => {
    setErr(null)
    try {
      const token = await createPat.mutateAsync(name.trim() || 'My AI assistant')
      analytics.track('Access Token Created')
      setFreshToken(token)
      setName('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const revoke = async (p: PatRow) => {
    if (!confirm(`Revoke "${p.name || 'this token'}"? Any assistant using it will stop working.`)) return
    setErr(null)
    try {
      await revokePat.mutateAsync(p.id)
      analytics.track('Access Token Revoked')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const claudeCmd = `claude mcp add --transport http hilka ${MCP_URL} --header "Authorization: Bearer ${
    freshToken ?? '<your-token>'
  }"`

  return (
    <div
      className="ob-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={modalRef}
        className="ca-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Connect your AI assistant"
        tabIndex={-1}
      >
        <div className="ca-head">
          <div>
            <h2 className="ca-title">Connect your AI assistant</h2>
            <p className="ca-intro">
              Connect Claude, ChatGPT, or any MCP-capable assistant, then just ask it to “make me a
              Hilka chain about …”. Everything it creates goes to your account only.
            </p>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {err && <p className="ca-err">{err}</p>}

        {/* server URL + per-tool setup guide — the primary path: add it and log in (OAuth) */}
        <ConnectGuide />

        {/* token — fallback for clients that can't do a browser login */}
        <div className="ca-section">
          <span className="ca-section-label">Prefer a token? (only if your tool can’t log in)</span>
          {freshToken ? (
            <div className="ca-reveal">
              <p className="ca-warn">Copy this now — it won’t be shown again.</p>
              <div className="ca-code-row">
                <code className="ca-code ca-code-token">{freshToken}</code>
                <CopyButton value={freshToken} label="Copy token" />
              </div>
              <span className="ca-section-label" style={{ marginTop: 16 }}>Then connect</span>
              <p className="field-hint field-hint-muted">Claude Code (terminal):</p>
              <div className="ca-code-row">
                <code className="ca-code ca-code-cmd">{claudeCmd}</code>
                <CopyButton value={claudeCmd} label="Copy command" />
              </div>
              <p className="field-hint field-hint-muted">
                Claude Desktop · ChatGPT · Grok: add a custom MCP / connector with the URL above and a
                header <code>Authorization: Bearer {`<your-token>`}</code>.
              </p>
              <div className="ca-reveal-foot">
                <button className="btn btn-primary" onClick={() => setFreshToken(null)}>Done</button>
              </div>
            </div>
          ) : (
            <div className="ca-gen-row">
              <input
                className="field-input"
                placeholder="Name, e.g. “Claude on my laptop”"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void generate()
                }}
                maxLength={80}
              />
              <button
                className={'btn btn-primary' + (createPat.isPending ? ' btn-disabled' : '')}
                onClick={() => void generate()}
              >
                {createPat.isPending ? 'Generating…' : 'Generate'}
              </button>
            </div>
          )}
        </div>

        {/* existing tokens */}
        <div className="ca-section">
          <span className="ca-section-label">Your tokens</span>
          {isLoading ? (
            <p className="ca-empty">Loading…</p>
          ) : !pats || pats.length === 0 ? (
            <p className="ca-empty">No tokens yet.</p>
          ) : (
            <ul className="ca-token-list">
              {pats.map((p) => (
                <li key={p.id} className="ca-token-item">
                  <div className="ca-token-meta">
                    <span className="ca-token-name">{p.name || 'Untitled token'}</span>
                    <span className="ca-token-sub">
                      {p.last_used_at
                        ? `last used ${new Date(p.last_used_at).toLocaleDateString()}`
                        : 'never used'}
                    </span>
                  </div>
                  <button
                    className="btn btn-ghost ca-revoke"
                    onClick={() => void revoke(p)}
                    disabled={revokePat.isPending}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="btn btn-ghost ca-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        } catch {
          /* clipboard blocked — user can still select the text */
        }
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

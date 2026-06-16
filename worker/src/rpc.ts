/**
 * Shared Supabase-RPC plumbing for every Hilka tool.
 *
 * The security spine (see index.ts): the Worker never decides the user. It picks
 * one of two paths by the bearer-token SHAPE and lets Postgres resolve identity:
 *   - "hilka_pat_…"  → a Hilka Personal Access Token: SHA-256-hashed and sent to
 *                      the `<fn>_via_pat` RPC over the publishable (anon) key; the
 *                      SECURITY DEFINER function resolves the user from the hash.
 *   - anything else  → a Supabase OAuth/session JWT: forwarded as-is to the bare
 *                      `<fn>` RPC, which PostgREST verifies and which resolves the
 *                      user via auth.uid().
 * user_id is decided inside the database in both cases, never here.
 */
import type { Env } from './index'

export async function sha256hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Call a PostgREST RPC and return its parsed JSON, throwing the RAISE message on error. */
export async function callRpc(
  env: Env,
  fn: string,
  body: unknown,
  authToken: string,
): Promise<unknown> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    let message = text
    try {
      const j = JSON.parse(text) as { message?: string; error?: string; hint?: string }
      message = j.message || j.error || text
    } catch {
      /* keep raw text */
    }
    throw new Error(message || `Hilka rejected the request (HTTP ${res.status}).`)
  }
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Call a chain RPC, choosing the PAT vs JWT path by token shape. `baseFn` is the
 * OAuth/JWT function name (e.g. "get_chain"); the PAT path calls `${baseFn}_via_pat`
 * with `p_token_hash` prepended to `params`.
 */
export async function callChainRpc(
  env: Env,
  bearer: string,
  baseFn: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  if (bearer.startsWith('hilka_pat_')) {
    const tokenHash = await sha256hex(bearer)
    return callRpc(env, `${baseFn}_via_pat`, { p_token_hash: tokenHash, ...params }, env.SUPABASE_PUBLISHABLE_KEY)
  }
  return callRpc(env, baseFn, params, bearer)
}

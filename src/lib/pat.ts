/**
 * Personal Access Tokens for the "Connect your AI assistant" flow. The raw token
 * is generated and shown to the user once; only its SHA-256 (the same hex the
 * hilka-mcp Worker computes) is ever stored. See supabase/migrations/0006.
 */

/** The remote MCP server URL the user pastes into their assistant. Set
 *  VITE_HILKA_MCP_URL once the Worker is deployed; until then it's a placeholder. */
export const MCP_URL: string =
  (import.meta.env.VITE_HILKA_MCP_URL as string | undefined)?.trim() ||
  'https://hilka-mcp.sviatik2408.workers.dev/mcp'

/** A high-entropy token: `hilka_pat_` + 32 random bytes, base64url. */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  const b64url = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `hilka_pat_${b64url}`
}

/** Lowercase hex SHA-256 — must match the Worker's hash exactly. */
export async function sha256hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

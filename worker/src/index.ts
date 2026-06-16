/**
 * hilka-mcp — a remote MCP server that lets any Hilka user create a thought-chain
 * from their AI assistant (Claude, ChatGPT/Codex, Grok, …).
 *
 * It is a thin, stateless Streamable-HTTP MCP server (JSON-RPC 2.0 over POST /mcp).
 * It holds NO Supabase service_role key and NO JWT signing key. Auth is a Hilka
 * Personal Access Token the user pastes as `Authorization: Bearer <token>`; the
 * Worker only SHA-256-hashes it and forwards it to the `create_chain_via_pat`
 * Postgres function, which resolves the user and does the privileged insert under
 * RLS. The user identity is decided inside the database, never here — so this
 * Worker can never write into the wrong account.
 *
 * Stateless on purpose: each POST is answered with a single JSON response (the
 * spec permits application/json instead of an SSE stream), so there are no
 * sessions, no Durable Objects, and deployment is one `wrangler deploy`.
 */
import { CREATE_CHAIN_TOOL, createChain } from './createChain'
import { GET_CHAIN_TOOL, LIST_CHAINS_TOOL, getChain, listChains } from './readChains'
import { EDIT_CHAIN_TOOL, editChain } from './editChain'
import { SERVER_ICONS, serveFavicon } from './icon'

// Every tool: its public definition + the handler that runs it. The handler does
// the PAT-vs-JWT dispatch internally (via callChainRpc); index.ts stays the only
// file that knows about JSON-RPC, CORS, auth challenge and bearer extraction.
const TOOLS = [CREATE_CHAIN_TOOL, LIST_CHAINS_TOOL, GET_CHAIN_TOOL, EDIT_CHAIN_TOOL] as const
type ToolHandler = (env: Env, bearer: string, args: Record<string, unknown>) => Promise<string>
const HANDLERS: Record<string, ToolHandler> = {
  [CREATE_CHAIN_TOOL.name]: createChain,
  [LIST_CHAINS_TOOL.name]: listChains,
  [GET_CHAIN_TOOL.name]: getChain,
  [EDIT_CHAIN_TOOL.name]: editChain,
}

export interface Env {
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
}

// MCP protocol versions this server understands; echo the client's if we know it.
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
// `title` is the human display name; `icons` (MCP spec SEP-973) lets clients show
// the Hilka glyph instead of a generic globe. See ./icon.ts for the caveat that
// Claude.ai doesn't render connector icons yet (claude-ai-mcp#152).
const SERVER_INFO = {
  name: 'hilka-mcp',
  title: 'Hilka',
  version: '1.0.0',
  websiteUrl: 'https://hilka.pages.dev',
  icons: SERVER_ICONS,
}

type JsonRpcId = string | number | null
interface JsonRpcMessage {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version, mcp-session-id',
  'access-control-max-age': '86400',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  })
}

// RFC 9728 Protected Resource Metadata — points MCP clients at Supabase's OAuth
// 2.1 server as the authorization server, so they can log the user in.
function protectedResourceMetadata(origin: string, env: Env) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [`${env.SUPABASE_URL}/auth/v1`],
    bearer_methods_supported: ['header'],
  }
}

// 401 with WWW-Authenticate triggers the OAuth discovery/login flow in
// OAuth-capable clients. PAT users always send a header, so they skip this.
function challenge401(origin: string): Response {
  return new Response(JSON.stringify({ error: 'unauthorized', error_description: 'Authentication required' }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      ...CORS,
    },
  })
}

const ok = (id: JsonRpcId, result: unknown) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id: JsonRpcId, code: number, message: string) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
})
// A *tool* error is reported inside the result so the model can read and fix it,
// not as a protocol-level error (per the MCP spec).
const toolError = (text: string) => ({ content: [{ type: 'text', text }], isError: true })

function negotiateProtocol(requested: unknown): string {
  return typeof requested === 'string' && SUPPORTED_PROTOCOLS.includes(requested)
    ? requested
    : SUPPORTED_PROTOCOLS[0]
}

/** Handle one JSON-RPC message. Returns a response object, or null for notifications. */
async function handleMessage(
  msg: JsonRpcMessage,
  bearer: string,
  env: Env,
): Promise<object | null> {
  const { method, params } = msg
  const id = msg.id ?? null
  const isNotification = msg.id === undefined

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: negotiateProtocol(params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      })

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null // notifications get no response

    case 'ping':
      return ok(id, {})

    case 'tools/list':
      return ok(id, { tools: TOOLS })

    case 'tools/call': {
      if (isNotification) return null
      const name = (params as { name?: string })?.name
      const handler = name ? HANDLERS[name] : undefined
      if (!handler) {
        return ok(id, toolError(`Unknown tool: ${String(name)}`))
      }
      if (!bearer) {
        return ok(
          id,
          toolError(
            'No Hilka token. Connect with an "Authorization: Bearer <token>" header — ' +
              'generate a token in Hilka under Settings → Connect your AI assistant.',
          ),
        )
      }
      try {
        const args = ((params as { arguments?: Record<string, unknown> })?.arguments ?? {})
        const text = await handler(env, bearer, args)
        return ok(id, { content: [{ type: 'text', text }] })
      } catch (e) {
        return ok(id, toolError(e instanceof Error ? e.message : String(e)))
      }
    }

    default:
      if (isNotification) return null
      return rpcError(id, -32601, `Method not found: ${String(method)}`)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('hilka-mcp ok', { status: 200, headers: CORS })
    }
    // Brand favicon, for clients that fetch a domain favicon as the connector icon.
    const favicon = serveFavicon(url.pathname, CORS)
    if (favicon) return favicon
    // Public OAuth discovery document (must not require auth).
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return jsonResponse(protectedResourceMetadata(url.origin, env))
    }
    if (url.pathname !== '/mcp') {
      return new Response('Not found', { status: 404, headers: CORS })
    }
    // Stateless server: no server-initiated stream, so GET /mcp is not supported.
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS })
    }

    const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
    // Protected resource: no credential → 401 so OAuth clients start the login flow.
    if (!bearer) return challenge401(url.origin)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse(rpcError(null, -32700, 'Parse error'), 200)
    }

    // A JSON-RPC batch (array) or a single message.
    if (Array.isArray(body)) {
      const responses: object[] = []
      for (const m of body) {
        const r = await handleMessage(m as JsonRpcMessage, bearer, env)
        if (r) responses.push(r)
      }
      return responses.length ? jsonResponse(responses) : new Response(null, { status: 202, headers: CORS })
    }

    const r = await handleMessage(body as JsonRpcMessage, bearer, env)
    return r ? jsonResponse(r) : new Response(null, { status: 202, headers: CORS })
  },
}

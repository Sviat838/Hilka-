# hilka-mcp

A tiny remote **MCP server** that lets any Hilka user create a thought-chain from
their AI assistant (Claude, ChatGPT/Codex, Grok, …) in plain language:

> "make me a Hilka chain about whether to switch jobs"

It exposes four tools — `create_chain` (insert a whole tree), `list_chains` and
`get_chain` (read), and `edit_chain` (apply an atomic batch of edits) — over the
user's own Hilka journal. It is a stateless Cloudflare Worker — JSON-RPC 2.0 over
`POST /mcp` — with **no Supabase service-role key and no JWT signing key**. The
only secret in play is the user's **Personal Access Token (PAT)**, which they
generate in Hilka (Settings → *Connect your AI assistant*) and paste as an
`Authorization: Bearer` header. The Worker SHA-256-hashes it and forwards it to
the `*_via_pat` Postgres functions (migrations `0006`/`0007`/`0009`), which resolve
the user and do the privileged work under RLS. **The user identity is decided
inside the database, never in the Worker.**

Each tool has an internal SECURITY DEFINER `*_core(p_user_id, …)` plus two thin
entry points (`*_via_pat` for the PAT path, the bare name for the OAuth/JWT path).
Because SECURITY DEFINER bypasses RLS, every `*_core` is revoked from `anon`/
`authenticated` (migration `0008` patched a real hole here — see its header) and
`edit_chain_core`/`get_chain_core` re-check that every node an op touches is owned
by the caller and belongs to the chain being edited.

The read/edit flow: `list_chains` → `get_chain` (returns the real node ids + a
`version` token) → `edit_chain` (a batch of `updates`/`adds`/`moves`/`deletes`/
`links`/`unlinks`, applied in one transaction; pass the `version` back as
`expected_version` for optimistic concurrency).

## Develop / deploy

```sh
cd worker
npm install

# local
cp .dev.vars.example .dev.vars   # fill SUPABASE_PUBLISHABLE_KEY (same value as the SPA's VITE_SUPABASE_PUBLISHABLE_KEY)
npm run dev                      # http://localhost:8787/mcp

# production (manual)
npx wrangler login
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npm run deploy                   # → https://hilka-mcp.<your-subdomain>.workers.dev/mcp
```

After the first manual deploy, pushes to `main` that touch `worker/` auto-deploy via
[`.github/workflows/deploy-worker.yml`](../.github/workflows/deploy-worker.yml). That needs
the repo's `CLOUDFLARE_API_TOKEN` to include **Workers Scripts: Edit** (the Pages-only token
won't deploy a Worker).

`SUPABASE_URL` is a plain var in `wrangler.jsonc` (it's public). The publishable
key is also public (it ships in the SPA) but is kept out of git, so it's a secret.

## Smoke-test the protocol

```sh
# initialize
curl -s localhost:8787/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'

# list tools
curl -s localhost:8787/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# call it (needs a real PAT)
curl -s localhost:8787/mcp \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer hilka_pat_...' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_chain","arguments":{"title":"Test","nodes":[]}}}'

# read: list the chains, then read one (grab a chain_id from list_chains)
curl -s localhost:8787/mcp -H 'content-type: application/json' -H 'authorization: Bearer hilka_pat_...' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_chains","arguments":{}}}'
curl -s localhost:8787/mcp -H 'content-type: application/json' -H 'authorization: Bearer hilka_pat_...' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_chain","arguments":{"chain_id":"<root-uuid>"}}}'

# edit: mark a node done and add a child (ids/version come from get_chain)
curl -s localhost:8787/mcp -H 'content-type: application/json' -H 'authorization: Bearer hilka_pat_...' \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"edit_chain","arguments":{"chain_id":"<root-uuid>","updates":[{"id":"<node-uuid>","status":"done"}],"adds":[{"key":"x","parent":null,"title":"A new thought"}]}}}'
```

Or point the MCP Inspector at it: `npx @modelcontextprotocol/inspector` → URL
`http://localhost:8787/mcp`, header `Authorization: Bearer <pat>`.

## Supabase OAuth setup (one-time, owner)

OAuth login (no token to copy) uses Supabase's built-in OAuth 2.1 server, which the Worker
advertises via `/.well-known/oauth-protected-resource`. In the Supabase dashboard →
**Authentication → OAuth Server**: confirm the server is enabled, turn on **Dynamic Client
Registration** (so assistants self-register), and set the consent page path
(`authorization_url_path`) to **`/oauth/consent`** with the Hilka site as the base URL. The
consent screen ships in the SPA (`src/components/OAuthConsent.tsx`).

## Connect an assistant

**OAuth (default — no token):** add the server URL and log in when prompted.

- **Claude Code:** `claude mcp add --transport http hilka https://hilka-mcp.<subdomain>.workers.dev/mcp`
- **Claude Desktop / claude.ai / ChatGPT / Cursor:** add a custom connector/MCP server by URL (`…/mcp`); the client opens a browser to log in to Hilka and approve.

**Token (fallback** — for clients that can't do a browser login): generate a token in Hilka
→ *Connect your AI assistant*, then pass it as a header, e.g.
`claude mcp add --transport http hilka …/mcp --header "Authorization: Bearer <pat>"`.

The Worker picks the path by token shape: `hilka_pat_…` → PAT; anything else → Supabase
OAuth/session JWT. See `business_analysis/plugin-architecture.md`.

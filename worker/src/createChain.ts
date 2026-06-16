/**
 * The single tool this server exposes: create_chain. Its description carries the
 * tree-shaping "design intelligence" so even a bare client with no Hilka skill
 * (ChatGPT, Grok) produces a decent chain.
 *
 * Two auth paths, chosen by the bearer token shape:
 *   - "hilka_pat_…"  → a Hilka Personal Access Token: hashed, sent to the
 *                      create_chain_via_pat RPC over the publishable key.
 *   - anything else  → a Supabase OAuth/session JWT (from Supabase's OAuth 2.1
 *                      server): forwarded as-is to the create_chain RPC, which
 *                      resolves the user via auth.uid(). PostgREST verifies it.
 * In both cases user_id is decided inside Postgres, never here.
 */
import type { Env } from './index'
import { callChainRpc } from './rpc'

export const CREATE_CHAIN_TOOL = {
  name: 'create_chain',
  // MCP tool annotations (spec: tool `annotations` object) — drive client UX and
  // are required by the Anthropic Connectors Directory. create_chain writes a new
  // tree (not read-only) but only ever inserts; it never deletes user data.
  annotations: {
    title: 'Create thought-chain',
    readOnlyHint: false,
    destructiveHint: false,
  },
  description:
    'Create a new thought-chain in the user\'s Hilka decision journal. A chain is a TREE of ' +
    'one-idea-per-card "thoughts" that maps how the user reasons through something — the ' +
    'directions they are exploring and, crucially, the ones they decided against and why.\n\n' +
    'Use this whenever the user wants to create, add, build, map, or "materialize" a chain, ' +
    'thought chain, chain of thoughts, tree of thoughts, decision tree, or a map of their ' +
    'thinking/reasoning/decision — e.g. "create me a chain of thoughts for my startup idea", ' +
    '"map my decision about X", or "turn these thoughts into a tree" — even if they do not say ' +
    '"Hilka" (here "chain of thoughts" means a saved Hilka tree, not step-by-step reasoning).\n\n' +
    'Design rules:\n' +
    '- A chain is a tree. Keep depth ≤ 5 and prefer depth over wide levels. "Max width N" means ' +
    'the widest single LEVEL has ≤ N nodes (not children-per-node) — a level with 12 cards is an ' +
    'unreadable horizontal scroll, so push detail DOWN the tree, not across.\n' +
    '- One thought per card. If a card says "X and also Y", split it.\n' +
    '- Titles are short (2–7 words): a claim or a direction, not a sentence.\n' +
    '- Descriptions are 1–3 sentences of genuine, first-person reflection (may be empty when the ' +
    'title says it all). Plain, sincere, not corporate, no hype, no buzzwords.\n' +
    '- Include 1–2 honest "dropped" dead-ends — a rejected direction, set status="dropped", made a ' +
    'LEAF (a dropped node can never have children), each with a one-sentence trade-off reason in ' +
    'decline_reason ("Easy distribution but weak retention."). Dropped branches are the point of ' +
    'the journal, not clutter.\n' +
    '- status is the progress axis: "todo" (default) | "doing" | "done" | "dropped". Use doing/done ' +
    'only when the input clearly says a path is in progress or finished.\n' +
    '- Each node has an arbitrary unique "key"; "parent_key" is another node\'s key, or null for a ' +
    'child of the root. The root node itself is created from "title" + "root_description" — do NOT ' +
    'include the root in "nodes".',
  inputSchema: {
    type: 'object',
    required: ['title', 'nodes'],
    properties: {
      title: {
        type: 'string',
        description: 'The chain title — the root thought. Short, 2–7 words.',
      },
      root_description: {
        type: 'string',
        description: 'Root description: 1–3 sentences on what the user is actually trying to figure out. May be empty.',
      },
      nodes: {
        type: 'array',
        description: 'Every thought below the root. Omit the root itself.',
        items: {
          type: 'object',
          required: ['key', 'title'],
          properties: {
            key: { type: 'string', description: 'Your arbitrary unique label for this node, e.g. "a", "a1".' },
            parent_key: {
              type: ['string', 'null'],
              description: "The key of this node's parent, or null for a direct child of the root.",
            },
            title: { type: 'string', description: 'Short claim or direction, 2–7 words.' },
            description: { type: 'string', description: '1–3 sentences of reflection. May be empty.' },
            status: {
              type: 'string',
              enum: ['todo', 'doing', 'done', 'dropped'],
              description: 'Progress. Default "todo". A rejected dead-end is "dropped".',
            },
            decline_reason: {
              type: ['string', 'null'],
              description:
                'Required and non-blank IF AND ONLY IF status is "dropped": one calm sentence naming the trade-off that killed the branch. Otherwise null.',
            },
          },
        },
      },
    },
  },
} as const

interface ChainArgs {
  title?: unknown
  root_description?: unknown
  nodes?: unknown
}

function buildPayload(args: ChainArgs): { title: string; root_description: string; nodes: unknown[] } {
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (!title) throw new Error('A chain title is required.')
  return {
    title,
    root_description: typeof args.root_description === 'string' ? args.root_description : '',
    nodes: Array.isArray(args.nodes) ? args.nodes : [],
  }
}

function summary(title: string, data: { root_id?: string; node_count?: number }): string {
  const count = data.node_count ?? 0
  return (
    `Created your Hilka chain "${title}" with ${count} thought${count === 1 ? '' : 's'}. ` +
    'Open Hilka, pick it from your chains — the tree (canvas) view is the prettiest for a screenshot.' +
    (data.root_id ? ` (chain id: ${data.root_id})` : '')
  )
}

/** Dispatch on token shape (PAT vs Supabase OAuth/session JWT) is in callChainRpc. */
export async function createChain(env: Env, bearer: string, args: ChainArgs): Promise<string> {
  const payload = buildPayload(args)
  const data = (await callChainRpc(env, bearer, 'create_chain', { p_payload: payload })) as {
    root_id?: string
    node_count?: number
  }
  return summary(payload.title, data)
}

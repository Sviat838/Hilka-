/**
 * Read tools: list_chains and get_chain. An assistant must call these before it
 * can edit — get_chain is where it learns the real node ids (and the version token
 * for optimistic-locked edits). Both dispatch PAT vs JWT via callChainRpc.
 */
import type { Env } from './index'
import { callChainRpc } from './rpc'
import { renderChain, summarizeChains } from './ops'

export const LIST_CHAINS_TOOL = {
  name: 'list_chains',
  // MCP tool annotations (spec: tool `annotations` object) — read-only: it only
  // reads the user's chains and never mutates state.
  annotations: {
    title: 'List thought-chains',
    readOnlyHint: true,
  },
  description:
    "List the user's Hilka thought-chains (each chain is a tree; its id is `chain_id`). " +
    'Use this first to find the chain to read or edit. Returns each chain\'s title, thought ' +
    'count, dropped count, and chain_id. Then call get_chain with a chain_id to see the thoughts.',
  inputSchema: { type: 'object', properties: {} },
} as const

export async function listChains(env: Env, bearer: string, _args: unknown): Promise<string> {
  const data = await callChainRpc(env, bearer, 'list_chains')
  return summarizeChains(data)
}

export const GET_CHAIN_TOOL = {
  name: 'get_chain',
  // MCP tool annotations (spec: tool `annotations` object) — read-only: it only
  // reads one chain in full and never mutates state.
  annotations: {
    title: 'Read a thought-chain',
    readOnlyHint: true,
  },
  description:
    'Read one Hilka chain in full: every thought with its real `id`, parent, title, description, ' +
    'status (todo/doing/done/dropped), drop reason, depth and order, plus cross-links and a ' +
    '`version` token. ALWAYS call this before edit_chain — you must edit by the exact ids it ' +
    'returns, and pass its `version` back as edit_chain.expected_version so a concurrent change ' +
    "can't be clobbered.",
  inputSchema: {
    type: 'object',
    required: ['chain_id'],
    properties: {
      chain_id: { type: 'string', description: 'The chain to read — a chain_id from list_chains.' },
    },
  },
} as const

export async function getChain(env: Env, bearer: string, args: unknown): Promise<string> {
  const chainId = String((args as { chain_id?: unknown })?.chain_id ?? '').trim()
  if (!chainId) throw new Error('get_chain needs a chain_id — get one from list_chains.')
  const data = await callChainRpc(env, bearer, 'get_chain', { p_chain_id: chainId })
  return renderChain(data)
}

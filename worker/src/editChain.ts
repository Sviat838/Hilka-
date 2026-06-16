/**
 * The edit_chain tool: one ATOMIC batch of changes to an existing chain. Its
 * description carries the "edit intelligence" (drop don't delete, read before
 * write, reopen behavior, depth over width) so even a bare client edits safely.
 * All validation that needs the live tree (ownership, leaf-only delete, temp-key
 * resolution, reopen semantics) is done in the edit_chain_core RPC; the Worker
 * only shapes the args and renders the result.
 */
import type { Env } from './index'
import { callChainRpc } from './rpc'
import { normalizeEditArgs, summarizeEdit } from './ops'

const STATUS_ENUM = ['todo', 'doing', 'done', 'dropped'] as const

export const EDIT_CHAIN_TOOL = {
  name: 'edit_chain',
  // MCP tool annotations (spec: tool `annotations` object). edit_chain writes
  // (not read-only). It is non-destructive: it appends/updates and prefers
  // "dropping" thoughts over deleting them, so it does not destroy user data.
  annotations: {
    title: 'Edit thought-chain',
    readOnlyHint: false,
    destructiveHint: false,
  },
  description:
    'Edit an existing Hilka chain — apply a batch of changes in ONE atomic transaction (if any ' +
    'change is invalid, none are applied and you get an error naming the problem; fix it and ' +
    'resend the whole edit).\n\n' +
    'ALWAYS call get_chain first and edit by the exact node ids it returns — never invent or reuse ' +
    'ids from another chain. Pass get_chain\'s `version` as `expected_version` so a change made ' +
    'meanwhile is not silently clobbered.\n\n' +
    'Rules that matter:\n' +
    '- DROP, don\'t delete. To reject/abandon a thought, set status:"dropped" with a one-sentence ' +
    'decline_reason — kept, greyed, the point of the journal. Use `deletes` ONLY for true mistakes ' +
    '(a typo node, a duplicate). When unsure, drop.\n' +
    '- A "dropped" thought keeps the children it already had, but you cannot ADD or MOVE a child ' +
    'under a dropped node — reopen it first.\n' +
    '- To reopen a dropped thought, just set its status to todo/doing/done; the old reason is ' +
    'auto-noted in its description. Do not hand-edit the description or clear decline_reason yourself.\n' +
    '- `updates` are partial: include only the fields you want to change. status:"dropped" requires ' +
    'a non-blank decline_reason.\n' +
    '- `adds` build new thoughts. Give each a temp `key`; set `parent` to an existing node id, ' +
    "another add's `key` (to nest), or null for a direct child of the chain root. Prefer depth over " +
    'wide levels; one idea per card; titles 2–7 words; descriptions plain first-person reflection.\n' +
    '- `deletes` are leaf-only and permanent; to remove a subtree, drop its root instead (or list ' +
    'every descendant). A node that has a description needs force:true to delete.\n' +
    '- To relocate a thought use `moves` (keeps its id, children and cross-links), not delete+add.',
  inputSchema: {
    type: 'object',
    required: ['chain_id'],
    properties: {
      chain_id: { type: 'string', description: 'The chain to edit — a chain_id from list_chains/get_chain.' },
      expected_version: {
        type: 'string',
        description: 'Optional. The `version` from your latest get_chain; the edit is rejected if the chain changed since.',
      },
      updates: {
        type: 'array',
        description: 'Change fields on existing nodes. Include only the fields to change.',
        items: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'The node id (from get_chain).' },
            title: { type: 'string' },
            description: { type: 'string', description: 'Pass "" to clear it.' },
            status: { type: 'string', enum: STATUS_ENUM as unknown as string[] },
            decline_reason: {
              type: 'string',
              description: 'Required (non-blank) when status becomes "dropped"; ignored otherwise.',
            },
          },
        },
      },
      adds: {
        type: 'array',
        description: 'Add new thoughts (optionally a whole subtree via temp keys).',
        items: {
          type: 'object',
          required: ['key', 'title'],
          properties: {
            key: { type: 'string', description: 'Your temp label for this new node; referenced by other adds/moves. Not a uuid.' },
            parent: {
              type: ['string', 'null'],
              description: "An existing node id, another add's key, or null = child of the chain root.",
            },
            title: { type: 'string', description: 'Short claim, 2–7 words.' },
            description: { type: 'string' },
            status: { type: 'string', enum: STATUS_ENUM as unknown as string[] },
            decline_reason: { type: 'string', description: 'Required (non-blank) iff status is "dropped".' },
          },
        },
      },
      moves: {
        type: 'array',
        description: 'Reparent and/or reorder existing nodes.',
        items: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
            parent: {
              type: ['string', 'null'],
              description: "New parent: a node id, an add's key, or null = chain root. Omit to keep the current parent.",
            },
            before: { type: 'string', description: 'Place just before this sibling id (mutually exclusive with after).' },
            after: { type: 'string', description: 'Place just after this sibling id. Omit both to append last.' },
          },
        },
      },
      deletes: {
        type: 'array',
        description: 'Permanently remove nodes (leaf-only; for typos/dupes — prefer dropping).',
        items: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
            force: { type: 'boolean', description: 'Required true to delete a node that has a description.' },
          },
        },
      },
      links: {
        type: 'array',
        description: 'Add a cross-link: the child also appears under another parent (dashed connector).',
        items: {
          type: 'object',
          required: ['parent', 'child'],
          properties: { parent: { type: 'string' }, child: { type: 'string' } },
        },
      },
      unlinks: {
        type: 'array',
        description: 'Remove a cross-link (the node stays under its home parent).',
        items: {
          type: 'object',
          required: ['parent', 'child'],
          properties: { parent: { type: 'string' }, child: { type: 'string' } },
        },
      },
    },
  },
} as const

export async function editChain(env: Env, bearer: string, args: unknown): Promise<string> {
  const chainId = String((args as { chain_id?: unknown })?.chain_id ?? '').trim()
  if (!chainId) throw new Error('edit_chain needs a chain_id — get one from list_chains/get_chain.')
  const ops = normalizeEditArgs(args)
  const data = await callChainRpc(env, bearer, 'edit_chain', { p_chain_id: chainId, p_ops: ops })
  return summarizeEdit(data)
}

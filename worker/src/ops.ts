/**
 * Pure helpers for the read/edit tools — argument normalization and human-readable
 * rendering of RPC results. Deliberately free of any Cloudflare/Env/crypto/fetch
 * imports so it typechecks under BOTH the worker tsconfig and the root tsconfig and
 * can be unit-tested in the root vitest suite (tests/unit/edit-ops.test.ts).
 */

/** The op arrays edit_chain understands. Sent verbatim as the RPC's `p_ops`. */
export const OP_ARRAYS = ['updates', 'adds', 'moves', 'deletes', 'links', 'unlinks'] as const

interface RawNode {
  id: string
  parent_id: string | null
  title: string
  status: string
  decline_reason: string | null
  depth: number
}

/**
 * Pull the edit operation arrays (and the optional optimistic-lock token) out of
 * the tool arguments into the `p_ops` object the RPC expects. Throws a friendly
 * error if no operations were supplied — the DB would otherwise do a no-op round
 * trip. Per-op semantic validation lives in the RPC (it needs the live tree).
 */
export function normalizeEditArgs(args: unknown): Record<string, unknown> {
  const a = (args ?? {}) as Record<string, unknown>
  const ops: Record<string, unknown> = {}
  let total = 0
  for (const k of OP_ARRAYS) {
    const v = a[k]
    if (v === undefined || v === null) continue
    if (!Array.isArray(v)) throw new Error(`"${k}" must be an array of operations.`)
    if (v.length) {
      ops[k] = v
      total += v.length
    }
  }
  if (total === 0) {
    throw new Error(
      'No edits given. Provide at least one of: updates, adds, moves, deletes, links, unlinks.',
    )
  }
  const ev = a.expected_version
  if (typeof ev === 'string' && ev.trim()) ops.expected_version = ev.trim()
  return ops
}

/** Indented outline of a chain, root first, children under parents in order. */
export function buildOutline(nodes: RawNode[]): string {
  if (!nodes?.length) return '(empty)'
  const byParent = new Map<string | null, RawNode[]>()
  let root: RawNode | undefined
  for (const n of nodes) {
    if (n.parent_id === null) root = n
    const list = byParent.get(n.parent_id) ?? []
    list.push(n)
    byParent.set(n.parent_id, list)
  }
  const lines: string[] = []
  const walk = (n: RawNode, indent: number) => {
    const tag =
      n.status === 'dropped'
        ? `  [dropped: ${n.decline_reason ?? ''}]`
        : n.status === 'todo'
          ? ''
          : `  [${n.status}]`
    lines.push(`${'  '.repeat(indent)}• ${n.title}${tag}  — ${n.id}`)
    for (const c of byParent.get(n.id) ?? []) walk(c, indent + 1)
  }
  if (root) walk(root, 0)
  // any node not reachable from the root (shouldn't happen) — surface, don't hide
  for (const n of nodes) if (n.parent_id === null && n !== root) walk(n, 0)
  return lines.join('\n')
}

/** Text summary for get_chain: outline + the raw JSON the model needs (ids/version). */
export function renderChain(data: unknown): string {
  const d = (data ?? {}) as {
    title?: string
    chain_id?: string
    node_count?: number
    version?: string
    nodes?: RawNode[]
    links?: unknown[]
  }
  const outline = buildOutline(d.nodes ?? [])
  const links = Array.isArray(d.links) ? d.links.length : 0
  const header =
    `Chain "${d.title ?? ''}" (${d.node_count ?? 0} thoughts` +
    (links ? `, ${links} cross-link${links === 1 ? '' : 's'}` : '') +
    `).\nUse these exact ids with edit_chain. version: ${d.version ?? ''}\n`
  return `${header}\n${outline}\n\n${JSON.stringify(data)}`
}

/** Text summary for list_chains. */
export function summarizeChains(data: unknown): string {
  const list = (Array.isArray(data) ? data : []) as {
    chain_id?: string
    title?: string
    node_count?: number
    dropped_count?: number
  }[]
  if (!list.length) return 'You have no chains yet. Create one with create_chain.'
  const lines = list.map(
    (c) =>
      `• ${c.title ?? '(untitled)'} — ${c.node_count ?? 0} thought${(c.node_count ?? 0) === 1 ? '' : 's'}` +
      (c.dropped_count ? `, ${c.dropped_count} dropped` : '') +
      `  (chain_id: ${c.chain_id})`,
  )
  return (
    `You have ${list.length} chain${list.length === 1 ? '' : 's'}:\n${lines.join('\n')}\n\n` +
    `Call get_chain with a chain_id to see its thoughts (and their ids) before editing.\n\n` +
    JSON.stringify(data)
  )
}

/** Text summary for edit_chain: what changed + the JSON (key→id map, new version). */
export function summarizeEdit(data: unknown): string {
  const d = (data ?? {}) as {
    applied?: {
      updated?: string[]
      added?: { key: string; id: string }[]
      moved?: string[]
      deleted?: string[]
      linked?: unknown[]
      unlinked?: unknown[]
    }
    counts?: { nodes_after?: number; dropped_after?: number }
    version?: string
  }
  const ap = d.applied ?? {}
  const parts: string[] = []
  const n = (x?: unknown[]) => (Array.isArray(x) ? x.length : 0)
  if (n(ap.updated)) parts.push(`updated ${n(ap.updated)}`)
  if (n(ap.added)) parts.push(`added ${n(ap.added)}`)
  if (n(ap.moved)) parts.push(`moved ${n(ap.moved)}`)
  if (n(ap.deleted)) parts.push(`deleted ${n(ap.deleted)}`)
  if (n(ap.linked)) parts.push(`linked ${n(ap.linked)}`)
  if (n(ap.unlinked)) parts.push(`unlinked ${n(ap.unlinked)}`)
  const what = parts.length ? parts.join(', ') : 'no changes'
  const after = d.counts?.nodes_after
  return (
    `Done — ${what}. ` +
    (after !== undefined ? `The chain now has ${after} thought${after === 1 ? '' : 's'}. ` : '') +
    `Open Hilka (tree view) to see it.\n\n` +
    JSON.stringify(data)
  )
}

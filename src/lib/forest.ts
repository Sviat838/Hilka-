import type { DropZone } from './drag'
import type { Chain, NodeLink, NodeRow, TreeNode } from './types'

/**
 * Assemble flat rows into chains (one per root). Rows must arrive ordered by
 * position so children arrays come out in sibling order (PLAN.md §4).
 * A row whose parent is missing is treated as a root rather than dropped —
 * data must never silently disappear from a journal.
 *
 * `links` are cross-link references (extra parent→child edges): they annotate
 * each node's xparents/xchildren but never touch the tree backbone, so layout,
 * the feed, and export keep following parent_id alone.
 */
export function assembleChains(rows: NodeRow[], links: NodeLink[] = []): Chain[] {
  const byId = new Map<string, TreeNode>(
    rows.map((r) => [r.id, { ...r, children: [], xparents: [], xchildren: [] }]),
  )
  const rootIds: string[] = []
  for (const n of byId.values()) {
    const parent = n.parent_id === null ? undefined : byId.get(n.parent_id)
    if (parent) parent.children.push(n.id)
    else rootIds.push(n.id)
  }

  // cross-links: only between nodes that exist and aren't the home edge already
  for (const l of links) {
    const parent = byId.get(l.parent_id)
    const child = byId.get(l.child_id)
    if (!parent || !child || child.parent_id === l.parent_id) continue
    parent.xchildren.push(l.child_id)
    child.xparents.push(l.parent_id)
  }
  // roots are siblings too (D3) — position is their order (D7), created_at tiebreak
  const byOrder = (a: string, b: string) => {
    const na = byId.get(a)!,
      nb = byId.get(b)!
    return na.position - nb.position || na.created_at.localeCompare(nb.created_at)
  }
  rootIds.sort(byOrder)

  const visited = new Set<string>()
  const buildChain = (rootId: string): Chain => {
    const nodes: Record<string, TreeNode> = {}
    const walk = (id: string) => {
      visited.add(id)
      const n = byId.get(id)!
      // break back-edges: a parent cycle (only possible via hand-crafted API
      // writes — the app never reparents) must not hang layout/export
      n.children = n.children.filter((c) => !visited.has(c))
      nodes[id] = n
      n.children.forEach(walk)
    }
    walk(rootId)
    return { rootId, nodes }
  }
  const chains = rootIds.map(buildChain)

  // rows trapped in a parent cycle are reachable from no root — surface them
  // as extra chains rather than silently dropping journal data
  const stranded = [...byId.keys()].filter((id) => !visited.has(id)).sort(byOrder)
  for (const id of stranded) {
    if (!visited.has(id)) chains.push(buildChain(id))
  }
  return chains
}

/** Fractional sibling order (D7): append = max + 1024. Accepts anything with a
 *  `position` (TreeNode in the app; a bare NodeRow in the in-memory demo). */
export function nextPosition(siblings: readonly { position: number }[]): number {
  if (!siblings.length) return 1024
  return Math.max(...siblings.map((s) => s.position)) + 1024
}

/**
 * Ids of nodes living under a dropped ancestor — kept visible but greyed
 * (PLAN.md §3.1: a dropped branch is a tombstone, its children stay).
 */
export function ghostedIds(chain: Chain): Set<string> {
  const ghosted = new Set<string>()
  const walk = (id: string, underDropped: boolean) => {
    if (underDropped) ghosted.add(id)
    const n = chain.nodes[id]
    const nextUnder = underDropped || n.status === 'dropped'
    n.children.forEach((c) => walk(c, nextUnder))
  }
  walk(chain.rootId, false)
  return ghosted
}

export interface FeedItem {
  id: string
  depth: number
}

/** Pre-order flattening for the linear "chain" view — children read right after their parent. */
export function flattenChain(chain: Chain): FeedItem[] {
  const out: FeedItem[] = []
  const walk = (id: string, depth: number) => {
    out.push({ id, depth })
    chain.nodes[id].children.forEach((c) => walk(c, depth + 1))
  }
  walk(chain.rootId, 0)
  return out
}

export function countByStatus(chain: Chain) {
  const counts = { total: 0, dropped: 0 }
  for (const n of Object.values(chain.nodes)) {
    counts.total++
    if (n.status === 'dropped') counts.dropped++
  }
  return counts
}

/** Ids strictly below `id` (its whole subtree, excluding itself). */
export function descendantIds(chain: Chain, id: string): Set<string> {
  const out = new Set<string>()
  const walk = (x: string) => {
    for (const c of chain.nodes[x]?.children ?? []) {
      out.add(c)
      walk(c)
    }
  }
  walk(id)
  return out
}

export interface Move {
  parentId: string | null
  position: number
}

/**
 * Resolve a drag-drop of `draggedId` relative to `targetId` into a concrete
 * (parent, position) move — or an error string if the move is illegal. Pure, so
 * the same rules cover both views and are unit-tested; the DB trigger
 * (migration 0003) is the backstop. `zone`:
 *   child  → become the last child of target (reparent)
 *   before → sibling just before target (same parent as target)
 *   after  → sibling just after target
 * Dropping onto the chain root is always treated as 'child' — drag never makes a
 * new root (one root per chain; nodes stay strictly positioned, §D11).
 */
export function computeMove(
  chain: Chain,
  draggedId: string,
  targetId: string,
  zone: DropZone,
): Move | { error: string } {
  if (draggedId === targetId) return { error: 'A thought cannot be dropped on itself.' }
  const target = chain.nodes[targetId]
  const dragged = chain.nodes[draggedId]
  if (!target || !dragged) return { error: 'That thought no longer exists.' }

  if (targetId === chain.rootId) zone = 'child' // never create a sibling of the root via drag

  const parentId = zone === 'child' ? targetId : target.parent_id

  const banned = descendantIds(chain, draggedId)
  banned.add(draggedId)
  if (parentId !== null) {
    if (banned.has(parentId)) return { error: 'You cannot move a thought under one of its own descendants.' }
    if (chain.nodes[parentId].status === 'dropped') {
      return { error: 'A dropped branch cannot grow children — reopen it first.' }
    }
  }

  if (zone === 'child') {
    const sibs = target.children.filter((id) => id !== draggedId).map((id) => chain.nodes[id])
    return { parentId, position: nextPosition(sibs) }
  }

  // sibling insert: order among the target's siblings, excluding the dragged node
  const siblingIds =
    parentId === null
      ? Object.values(chain.nodes).filter((n) => n.parent_id === null).map((n) => n.id)
      : chain.nodes[parentId].children
  const sibs = siblingIds.filter((id) => id !== draggedId).map((id) => chain.nodes[id])
  const ti = sibs.findIndex((s) => s.id === targetId)
  if (ti < 0) return { parentId, position: nextPosition(sibs) }
  if (zone === 'before') {
    const prev = sibs[ti - 1]
    return { parentId, position: prev ? (prev.position + sibs[ti].position) / 2 : sibs[ti].position - 1024 }
  }
  const next = sibs[ti + 1]
  return { parentId, position: next ? (sibs[ti].position + next.position) / 2 : sibs[ti].position + 1024 }
}

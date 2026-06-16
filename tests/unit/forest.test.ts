import { describe, expect, it } from 'vitest'
import {
  assembleChains,
  computeMove,
  countByStatus,
  descendantIds,
  flattenChain,
  ghostedIds,
  nextPosition,
} from '../../src/lib/forest'
import type { NodeRow } from '../../src/lib/types'

let seq = 0
function row(over: Partial<NodeRow>): NodeRow {
  seq++
  return {
    id: `n${seq}`,
    user_id: 'u1',
    parent_id: null,
    title: `node ${seq}`,
    description: '',
    status: 'todo',
    decline_reason: null,
    position: seq * 1024,
    status_changed_at: null,
    created_at: `2026-06-0${Math.min(seq, 9)}T00:00:00Z`,
    updated_at: '2026-06-12T00:00:00Z',
    ...over,
  }
}

describe('assembleChains', () => {
  it('builds one chain per root, in created order', () => {
    const r1 = row({ id: 'r1' })
    const r2 = row({ id: 'r2' })
    const c1 = row({ id: 'c1', parent_id: 'r2' })
    const chains = assembleChains([c1, r2, r1])
    expect(chains.map((c) => c.rootId)).toEqual(['r1', 'r2'])
    expect(chains[1].nodes['r2'].children).toEqual(['c1'])
    expect(Object.keys(chains[0].nodes)).toEqual(['r1'])
  })

  it('keeps sibling order as given (rows arrive position-sorted)', () => {
    const r = row({ id: 'r' })
    const a = row({ id: 'a', parent_id: 'r' })
    const b = row({ id: 'b', parent_id: 'r' })
    const chains = assembleChains([r, a, b])
    expect(chains[0].nodes['r'].children).toEqual(['a', 'b'])
  })

  it('annotates cross-links as xparents/xchildren without touching the tree', () => {
    // r → a, r → b (siblings); c is a's tree child, also cross-linked under b
    const r = row({ id: 'r' })
    const a = row({ id: 'a', parent_id: 'r' })
    const b = row({ id: 'b', parent_id: 'r' })
    const c = row({ id: 'c', parent_id: 'a' })
    const chains = assembleChains([r, a, b, c], [{ parent_id: 'b', child_id: 'c' }])
    const chain = chains[0]
    // tree backbone unchanged: c is still only a's child
    expect(chain.nodes['a'].children).toEqual(['c'])
    expect(chain.nodes['b'].children).toEqual([])
    // cross-link recorded on both ends
    expect(chain.nodes['c'].xparents).toEqual(['b'])
    expect(chain.nodes['b'].xchildren).toEqual(['c'])
  })

  it('ignores a cross-link that merely duplicates the home parent edge', () => {
    const r = row({ id: 'r' })
    const a = row({ id: 'a', parent_id: 'r' })
    const chains = assembleChains([r, a], [{ parent_id: 'r', child_id: 'a' }])
    expect(chains[0].nodes['a'].xparents).toEqual([])
    expect(chains[0].nodes['r'].xchildren).toEqual([])
  })

  it('never drops a row whose parent is missing — it becomes a root', () => {
    const orphan = row({ id: 'o', parent_id: 'gone' })
    const chains = assembleChains([orphan])
    expect(chains).toHaveLength(1)
    expect(chains[0].rootId).toBe('o')
  })

  it('orders roots by position, not creation time (D7 applies to roots too)', () => {
    const older = row({ id: 'older', position: 2048, created_at: '2026-06-01T00:00:00Z' })
    const newer = row({ id: 'newer', position: 1024, created_at: '2026-06-09T00:00:00Z' })
    const chains = assembleChains([older, newer])
    expect(chains.map((c) => c.rootId)).toEqual(['newer', 'older'])
  })

  it('survives a hand-crafted parent cycle without hanging or dropping rows', () => {
    // A -> B -> A is rejectable only by a future DB trigger; the client must
    // still terminate and surface every row
    const a = row({ id: 'a', parent_id: 'b' })
    const b = row({ id: 'b', parent_id: 'a' })
    const r = row({ id: 'r' })
    const chains = assembleChains([r, a, b])
    const allIds = chains.flatMap((c) => Object.keys(c.nodes))
    expect(new Set(allIds)).toEqual(new Set(['r', 'a', 'b']))
    // back-edge broken: no children array points at its own chain root
    for (const c of chains) {
      for (const n of Object.values(c.nodes)) {
        expect(n.children).not.toContain(c.rootId)
      }
    }
  })
})

describe('nextPosition (D7)', () => {
  it('starts at 1024 and appends as max + 1024', () => {
    expect(nextPosition([])).toBe(1024)
    const r = row({ id: 'r' })
    const chains = assembleChains([r, row({ id: 'a', parent_id: 'r', position: 2048 })])
    const siblings = chains[0].nodes['r'].children.map((id) => chains[0].nodes[id])
    expect(nextPosition(siblings)).toBe(3072)
  })
})

describe('ghostedIds (PLAN.md §3.1)', () => {
  it('marks descendants of a dropped node, not the dropped node itself', () => {
    const r = row({ id: 'r' })
    const dead = row({ id: 'dead', parent_id: 'r', status: 'dropped', decline_reason: 'nope' })
    const kid = row({ id: 'kid', parent_id: 'dead' })
    const grandkid = row({ id: 'gk', parent_id: 'kid' })
    const live = row({ id: 'live', parent_id: 'r' })
    const ghosted = ghostedIds(assembleChains([r, dead, kid, grandkid, live])[0])
    expect(ghosted).toEqual(new Set(['kid', 'gk']))
  })
})

describe('flattenChain (feed view)', () => {
  it('emits pre-order: each subtree reads in full before the next sibling', () => {
    const r = row({ id: 'r' })
    const a = row({ id: 'a', parent_id: 'r', position: 1024 })
    const a1 = row({ id: 'a1', parent_id: 'a' })
    const b = row({ id: 'b', parent_id: 'r', position: 2048 })
    const items = flattenChain(assembleChains([r, a, a1, b])[0])
    expect(items.map((i) => i.id)).toEqual(['r', 'a', 'a1', 'b'])
    expect(items.map((i) => i.depth)).toEqual([0, 1, 2, 1])
  })
})

describe('drag-move resolution (computeMove)', () => {
  // r ─ a ─ a1
  //   │   └ a2
  //   └ d(dropped) ─ d1
  const make = () =>
    assembleChains([
      row({ id: 'r' }),
      row({ id: 'a', parent_id: 'r', position: 1024 }),
      row({ id: 'd', parent_id: 'r', position: 2048, status: 'dropped', decline_reason: 'no' }),
      row({ id: 'a1', parent_id: 'a', position: 1024 }),
      row({ id: 'a2', parent_id: 'a', position: 2048 }),
      row({ id: 'd1', parent_id: 'd', position: 1024 }),
    ])[0]
  const chain = make()

  it('descendantIds collects the whole subtree, excluding self', () => {
    expect(descendantIds(chain, 'a')).toEqual(new Set(['a1', 'a2']))
    expect(descendantIds(chain, 'a1')).toEqual(new Set())
  })

  it('child drop reparents and appends (max position + 1024)', () => {
    expect(computeMove(chain, 'a1', 'd1', 'child')).toEqual({ parentId: 'd1', position: 1024 })
    // moving a1 under r (which has a@1024, d@2048) appends after the max
    expect(computeMove(chain, 'a1', 'r', 'child')).toEqual({ parentId: 'r', position: 2048 + 1024 })
  })

  it('before/after drops insert as a sibling of the target', () => {
    // a2 before a1 → same parent a, just above a1 (position 1024) → 1024 - 1024
    expect(computeMove(chain, 'a2', 'a1', 'before')).toEqual({ parentId: 'a', position: 0 })
    // a1 after a2 → after the last sibling → 2048 + 1024
    expect(computeMove(chain, 'a1', 'a2', 'after')).toEqual({ parentId: 'a', position: 3072 })
  })

  it('rejects dropping a node onto itself or its own descendant (cycle)', () => {
    expect(computeMove(chain, 'a', 'a', 'child')).toMatchObject({ error: expect.any(String) })
    expect(computeMove(chain, 'a', 'a1', 'child')).toMatchObject({ error: expect.any(String) })
    // sibling-insert next to a descendant also resolves to a banned parent
    expect(computeMove(chain, 'a', 'a1', 'before')).toMatchObject({ error: expect.any(String) })
  })

  it('rejects attaching under a dropped branch', () => {
    expect(computeMove(chain, 'a', 'd', 'child')).toMatchObject({ error: expect.any(String) })
    // inserting as a sibling among a dropped node's children = growing it
    expect(computeMove(chain, 'a', 'd1', 'before')).toMatchObject({ error: expect.any(String) })
  })

  it('treats any drop on the chain root as a child drop (never a new root)', () => {
    expect(computeMove(chain, 'a1', 'r', 'before')).toEqual({ parentId: 'r', position: 3072 })
    expect(computeMove(chain, 'a1', 'r', 'after')).toEqual({ parentId: 'r', position: 3072 })
  })
})

describe('countByStatus', () => {
  it('counts total and dropped', () => {
    const r = row({ id: 'r', status: 'todo' })
    const a = row({ id: 'a', parent_id: 'r', status: 'dropped', decline_reason: 'x' })
    const b = row({ id: 'b', parent_id: 'r', status: 'todo' })
    const counts = countByStatus(assembleChains([r, a, b])[0])
    expect(counts).toEqual({ total: 3, dropped: 1 })
  })
})

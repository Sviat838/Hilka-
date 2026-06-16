import { describe, expect, it } from 'vitest'
import {
  DEMO_TREE,
  STARTER_CHAIN,
  demoChain,
  parseHandoff,
  payloadToRows,
  topoSortRows,
  type SeedNode,
} from '../../src/lib/seed'
import type { NodeRow } from '../../src/lib/types'

describe('DEMO_TREE fixture', () => {
  const keys = new Set(DEMO_TREE.map((n) => n.key))
  const byKey = new Map(DEMO_TREE.map((n) => [n.key, n]))

  it('has exactly one root', () => {
    expect(DEMO_TREE.filter((n) => n.parentKey === null)).toHaveLength(1)
    expect(byKey.get('root')?.parentKey).toBeNull()
  })

  it('every parentKey references an existing key', () => {
    for (const n of DEMO_TREE) {
      if (n.parentKey !== null) expect(keys.has(n.parentKey)).toBe(true)
    }
  })

  it('every dropped node carries a non-blank, human reason', () => {
    const dropped = DEMO_TREE.filter((n) => n.status === 'dropped')
    expect(dropped.length).toBeGreaterThanOrEqual(1)
    for (const n of dropped) expect((n.declineReason ?? '').trim().length).toBeGreaterThan(10)
  })

  it('shows the whole progress axis (todo / doing / done / dropped)', () => {
    const statuses = new Set(DEMO_TREE.map((n) => n.status))
    expect(statuses).toContain('todo')
    expect(statuses).toContain('doing')
    expect(statuses).toContain('done')
    expect(statuses).toContain('dropped')
  })

  it('keeps the teaching beat: a node lives UNDER a dropped branch', () => {
    const droppedKeys = new Set(DEMO_TREE.filter((n) => n.status === 'dropped').map((n) => n.key))
    const keptUnderDropped = DEMO_TREE.some((n) => n.parentKey !== null && droppedKeys.has(n.parentKey))
    expect(keptUnderDropped).toBe(true)
  })
})

describe('STARTER_CHAIN payload (create_chain legality)', () => {
  const nodeKeys = new Set(STARTER_CHAIN.nodes.map((n) => n.key))

  it('has unique keys and resolvable parents', () => {
    expect(nodeKeys.size).toBe(STARTER_CHAIN.nodes.length)
    for (const n of STARTER_CHAIN.nodes) {
      if (n.parent_key !== null) expect(nodeKeys.has(n.parent_key)).toBe(true)
    }
  })

  it('keeps every dropped node a LEAF (the DB rejects a child under a dropped node)', () => {
    const droppedKeys = new Set(
      STARTER_CHAIN.nodes.filter((n) => n.status === 'dropped').map((n) => n.key),
    )
    expect(droppedKeys.size).toBeGreaterThanOrEqual(1)
    const childUnderDropped = STARTER_CHAIN.nodes.some(
      (n) => n.parent_key !== null && droppedKeys.has(n.parent_key),
    )
    expect(childUnderDropped).toBe(false)
  })

  it('every dropped node has a non-blank reason; has fill-in prompts', () => {
    for (const n of STARTER_CHAIN.nodes) {
      if (n.status === 'dropped') expect((n.decline_reason ?? '').trim().length).toBeGreaterThan(0)
    }
    expect(STARTER_CHAIN.nodes.some((n) => n.status === 'todo')).toBe(true)
    expect(STARTER_CHAIN.title.trim().length).toBeGreaterThan(0)
  })
})

describe('payloadToRows + demoChain', () => {
  it('produces one root row with resolvable parent links and dropped reasons', () => {
    const rows = payloadToRows(DEMO_TREE)
    expect(rows).toHaveLength(DEMO_TREE.length)

    const roots = rows.filter((r) => r.parent_id === null)
    expect(roots).toHaveLength(1)

    const ids = new Set(rows.map((r) => r.id))
    for (const r of rows) {
      if (r.parent_id !== null) expect(ids.has(r.parent_id)).toBe(true)
      if (r.status === 'dropped') expect((r.decline_reason ?? '').trim().length).toBeGreaterThan(0)
      else expect(r.decline_reason).toBeNull()
      expect(r.position).toBeGreaterThan(0)
    }
  })

  it('siblings get distinct positions', () => {
    const rows = payloadToRows(DEMO_TREE)
    const byParent = new Map<string | null, number[]>()
    for (const r of rows) {
      const arr = byParent.get(r.parent_id) ?? []
      arr.push(r.position)
      byParent.set(r.parent_id, arr)
    }
    for (const positions of byParent.values()) {
      expect(new Set(positions).size).toBe(positions.length)
    }
  })

  it('assembles into a single chain holding every node', () => {
    const chain = demoChain()
    expect(Object.keys(chain.nodes)).toHaveLength(DEMO_TREE.length)
    expect(chain.nodes[chain.rootId].title).toBe(DEMO_TREE[0].title)
  })
})

describe('topoSortRows', () => {
  it('orders every parent before its children', () => {
    const rows = payloadToRows(DEMO_TREE)
    const sorted = topoSortRows(rows)
    const seen = new Set<string>()
    for (const r of sorted) {
      if (r.parent_id !== null) expect(seen.has(r.parent_id)).toBe(true)
      seen.add(r.id)
    }
    expect(sorted).toHaveLength(rows.length)
  })
})

describe('parseHandoff', () => {
  const valid = (): NodeRow[] => payloadToRows(DEMO_TREE)

  it('round-trips a valid edited tree', () => {
    const rows = valid()
    const parsed = parseHandoff(JSON.stringify(rows))
    expect(parsed).not.toBeNull()
    expect(parsed).toHaveLength(rows.length)
  })

  it('rejects junk, empties, and malformed blobs', () => {
    expect(parseHandoff(null)).toBeNull()
    expect(parseHandoff('not json')).toBeNull()
    expect(parseHandoff('[]')).toBeNull()
    expect(parseHandoff('{"id":"x"}')).toBeNull()
  })

  it('rejects an orphan (parent_id pointing nowhere)', () => {
    const rows = valid()
    rows[2] = { ...rows[2], parent_id: 'does-not-exist' }
    expect(parseHandoff(JSON.stringify(rows))).toBeNull()
  })

  it('rejects more than one root', () => {
    const rows = valid()
    rows[1] = { ...rows[1], parent_id: null }
    expect(parseHandoff(JSON.stringify(rows))).toBeNull()
  })

  it('rejects a dropped node with a blank reason', () => {
    const rows = valid()
    const dropped = rows.find((r) => r.status === 'dropped')!
    const idx = rows.indexOf(dropped)
    rows[idx] = { ...dropped, decline_reason: '   ' }
    expect(parseHandoff(JSON.stringify(rows))).toBeNull()
  })
})

// keep the SeedNode type referenced so an unused-import lint can't drop it
const _typecheck: SeedNode = DEMO_TREE[0]
void _typecheck

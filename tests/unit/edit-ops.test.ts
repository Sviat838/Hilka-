import { describe, expect, it } from 'vitest'
import {
  buildOutline,
  normalizeEditArgs,
  renderChain,
  summarizeChains,
  summarizeEdit,
} from '../../worker/src/ops'

describe('normalizeEditArgs', () => {
  it('keeps only non-empty op arrays and the version token', () => {
    const ops = normalizeEditArgs({
      chain_id: 'c1',
      expected_version: '  v1  ',
      updates: [{ id: 'n1', title: 'x' }],
      adds: [],
      moves: undefined,
    })
    expect(ops).toEqual({ updates: [{ id: 'n1', title: 'x' }], expected_version: 'v1' })
  })

  it('throws when no operations are supplied', () => {
    expect(() => normalizeEditArgs({ chain_id: 'c1' })).toThrow(/No edits given/)
    expect(() => normalizeEditArgs({ chain_id: 'c1', updates: [], deletes: [] })).toThrow(/No edits/)
  })

  it('rejects a non-array op field', () => {
    expect(() => normalizeEditArgs({ updates: { id: 'n1' } })).toThrow(/"updates" must be an array/)
  })

  it('drops a blank expected_version', () => {
    const ops = normalizeEditArgs({ deletes: [{ id: 'n1' }], expected_version: '   ' })
    expect('expected_version' in ops).toBe(false)
  })
})

const NODES = [
  { id: 'r', parent_id: null, title: 'Root', status: 'todo', decline_reason: null, depth: 1 },
  { id: 'a', parent_id: 'r', title: 'Alpha', status: 'doing', decline_reason: null, depth: 2 },
  { id: 'b', parent_id: 'r', title: 'Beta', status: 'dropped', decline_reason: 'too risky', depth: 2 },
  { id: 'a1', parent_id: 'a', title: 'Alpha one', status: 'todo', decline_reason: null, depth: 3 },
]

describe('buildOutline', () => {
  it('renders a nested, ordered outline with ids and status tags', () => {
    const out = buildOutline(NODES)
    const lines = out.split('\n')
    expect(lines[0]).toBe('• Root  — r')
    expect(lines[1]).toBe('  • Alpha  [doing]  — a')
    expect(lines[2]).toBe('    • Alpha one  — a1')
    expect(lines[3]).toBe('  • Beta  [dropped: too risky]  — b')
  })

  it('handles an empty tree', () => {
    expect(buildOutline([])).toBe('(empty)')
  })
})

describe('renderChain', () => {
  it('includes the version, an outline, and the raw JSON (so the model gets ids)', () => {
    const data = { chain_id: 'r', title: 'Root', node_count: 4, version: 'abc', nodes: NODES, links: [] }
    const text = renderChain(data)
    expect(text).toContain('version: abc')
    expect(text).toContain('• Root  — r')
    expect(text).toContain(JSON.stringify(data))
  })
})

describe('summarizeChains', () => {
  it('lists each chain with its id and counts', () => {
    const text = summarizeChains([
      { chain_id: 'c1', title: 'One', node_count: 5, dropped_count: 1 },
      { chain_id: 'c2', title: 'Two', node_count: 1, dropped_count: 0 },
    ])
    expect(text).toContain('You have 2 chains')
    expect(text).toContain('One — 5 thoughts, 1 dropped  (chain_id: c1)')
    expect(text).toContain('Two — 1 thought  (chain_id: c2)')
  })

  it('handles no chains', () => {
    expect(summarizeChains([])).toMatch(/no chains yet/)
  })
})

describe('summarizeEdit', () => {
  it('summarizes what changed and echoes the JSON', () => {
    const data = {
      applied: { updated: ['n1'], added: [{ key: 'k', id: 'n9' }], deleted: ['n2'] },
      counts: { nodes_after: 7, dropped_after: 2 },
      version: 'v2',
    }
    const text = summarizeEdit(data)
    expect(text).toContain('updated 1')
    expect(text).toContain('added 1')
    expect(text).toContain('deleted 1')
    expect(text).toContain('7 thoughts')
    expect(text).toContain(JSON.stringify(data))
  })
})

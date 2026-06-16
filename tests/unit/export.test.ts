import { describe, expect, it } from 'vitest'
import { assembleChains } from '../../src/lib/forest'
import { chainsToJson, chainsToMarkdown } from '../../src/lib/export'
import type { NodeRow } from '../../src/lib/types'

function row(over: Partial<NodeRow>): NodeRow {
  return {
    id: 'r1',
    user_id: 'u1',
    parent_id: null,
    title: 'Root',
    description: '',
    status: 'todo',
    decline_reason: null,
    position: 1024,
    status_changed_at: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...over,
  }
}

describe('chainsToMarkdown', () => {
  it('flattens multi-line drop reasons so the bullet line stays intact (D8)', () => {
    const chains = assembleChains([
      row({}),
      row({
        id: 'd1',
        parent_id: 'r1',
        title: 'Dead path',
        status: 'dropped',
        decline_reason: 'too costly\nrevisit in Q3\n\n- maybe with funding',
      }),
    ])
    const md = chainsToMarkdown(chains)
    const bullet = md.split('\n').find((l) => l.includes('Dead path'))!
    expect(bullet).toContain('~~[dropped: too costly revisit in Q3 - maybe with funding]~~')
    // the marker never spawns extra unindented lines
    expect(md).not.toMatch(/^revisit in Q3/m)
  })

  it('marks dropped and indents children; live carries no marker', () => {
    const chains = assembleChains([
      row({ status: 'todo' }),
      row({ id: 'd1', parent_id: 'r1', title: 'Dead end', status: 'dropped', decline_reason: 'nope', position: 1 }),
    ])
    const md = chainsToMarkdown(chains)
    expect(md).toContain('- Root')
    expect(md).not.toMatch(/Root.*\[/) // live root has no status marker
    expect(md).toContain('  - ~~Dead end~~ ~~[dropped: nope]~~')
  })
})

describe('chainsToJson', () => {
  it('round-trips all rows without the client-only children field', () => {
    const chains = assembleChains([row({}), row({ id: 'c1', parent_id: 'r1', title: 'Child' })])
    const parsed = JSON.parse(chainsToJson(chains)) as Record<string, unknown>[]
    expect(parsed).toHaveLength(2)
    expect(parsed.every((r) => !('children' in r))).toBe(true)
  })
})

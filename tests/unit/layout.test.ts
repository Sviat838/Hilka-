import { describe, expect, it } from 'vitest'
import { assembleChains } from '../../src/lib/forest'
import { layoutChain, NODE_W } from '../../src/lib/layout'
import type { NodeRow } from '../../src/lib/types'

function row(id: string, parent: string | null, position: number): NodeRow {
  return {
    id,
    user_id: 'u1',
    parent_id: parent,
    title: id,
    description: '',
    status: 'todo',
    decline_reason: null,
    position,
    status_changed_at: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  }
}

describe('layoutChain', () => {
  const chain = assembleChains([
    row('r', null, 1024),
    row('a', 'r', 1024),
    row('b', 'r', 2048),
    row('a1', 'a', 1024),
    row('a2', 'a', 2048),
  ])[0]
  const pos = layoutChain(chain)

  it('puts the root at the origin and children one level down', () => {
    expect(pos['r']).toMatchObject({ x: 0, y: 0, depth: 0 })
    expect(pos['a'].depth).toBe(1)
    expect(pos['a1'].depth).toBe(2)
  })

  it('centers a parent over equal-width children', () => {
    expect(pos['a'].x).toBeCloseTo((pos['a1'].x + pos['a2'].x) / 2)
  })

  it('keeps a parent within the horizontal span of its children', () => {
    // with unequal subtree widths the parent centers on the span, not the
    // midpoint of child centers — assert the weaker, true invariant
    expect(pos['r'].x).toBeGreaterThan(pos['a'].x)
    expect(pos['r'].x).toBeLessThan(pos['b'].x)
  })

  it('keeps siblings from overlapping', () => {
    const sibs = [
      [pos['a'], pos['b']],
      [pos['a1'], pos['a2']],
    ]
    for (const [l, rgt] of sibs) {
      expect(rgt.x - l.x).toBeGreaterThanOrEqual(NODE_W)
    }
  })
})

describe('layoutChain (horizontal)', () => {
  const chain = assembleChains([
    row('r', null, 1024),
    row('a', 'r', 1024),
    row('b', 'r', 2048),
    row('a1', 'a', 1024),
    row('a2', 'a', 2048),
  ])[0]
  const pos = layoutChain(chain, { orientation: 'horizontal' })

  it('marches depth along x, not y', () => {
    expect(pos['r'].depth).toBe(0)
    expect(pos['a'].x).toBeGreaterThan(pos['r'].x) // child sits to the right
    expect(pos['a1'].x).toBeGreaterThan(pos['a'].x) // grandchild further right
  })

  it('puts same-depth nodes in the same column', () => {
    expect(pos['a'].x).toBeCloseTo(pos['b'].x)
    expect(pos['a1'].x).toBeCloseTo(pos['a2'].x)
  })

  it('stacks siblings down the y axis without overlapping', () => {
    // no measured heights → each card uses the fallback height (140)
    for (const [l, rgt] of [
      [pos['a'], pos['b']],
      [pos['a1'], pos['a2']],
    ]) {
      expect(Math.abs(rgt.y - l.y)).toBeGreaterThanOrEqual(140)
    }
  })

  it('centers a parent against the vertical span of its children', () => {
    const aMid = pos['a'].y + 70 // card center (fallback height 140)
    expect(aMid).toBeCloseTo((pos['a1'].y + 70 + (pos['a2'].y + 70)) / 2)
  })
})

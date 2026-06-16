import type { Chain } from './types'

export const NODE_W = 264
export const H_GAP = 36 // vertical tree: gap between sibling subtrees (x axis)
export const V_GAP = 220 // vertical tree: gap between depth levels (y axis)
export const H_LEVEL_GAP = 96 // horizontal tree: gap between depth levels (x axis)
export const V_CROSS_GAP = 26 // horizontal tree: gap between stacked siblings (y axis)
const FALLBACK_H = 140 // assumed card height before measurement (horizontal cross-axis)

export type TreeOrient = 'vertical' | 'horizontal'

export interface Pos {
  x: number
  y: number
  depth: number
}

export interface LayoutOpts {
  orientation?: TreeOrient
  /** measured card heights — used for the cross-axis packing of a horizontal tree */
  heights?: Record<string, number>
}

/**
 * Tidy top-down (vertical) OR left-to-right (horizontal) tree layout. Each
 * subtree claims the total breadth of its children on the cross axis; children
 * are centered against the parent. `pos.x` is the node's horizontal CENTER and
 * `pos.y` its TOP edge, so both orientations render identically
 * (left = x − NODE_W/2, top = y).
 *
 * Vertical: levels stack down (y = depth·V_GAP), siblings spread across x, and
 * the cross size is the fixed NODE_W. Horizontal: levels march right, siblings
 * stack down the y axis, and the cross size is each card's measured height
 * (falling back to a constant before measurement).
 */
export function layoutChain(chain: Chain, opts: LayoutOpts = {}): Record<string, Pos> {
  const horizontal = (opts.orientation ?? 'vertical') === 'horizontal'
  const heights = opts.heights ?? {}
  const crossGap = horizontal ? V_CROSS_GAP : H_GAP
  const pos: Record<string, Pos> = {}
  const breadths = new Map<string, number>()

  // the cross-axis size of a single node: fixed width (vertical) or its height (horizontal)
  const crossSize = (id: string): number => (horizontal ? (heights[id] ?? FALLBACK_H) : NODE_W)

  // the cross-axis extent a whole subtree must reserve
  const breadth = (id: string): number => {
    const cached = breadths.get(id)
    if (cached !== undefined) return cached
    const n = chain.nodes[id]
    const self = crossSize(id)
    const b = !n.children.length
      ? self
      : Math.max(self, n.children.reduce((s, c) => s + breadth(c), 0) + crossGap * (n.children.length - 1))
    breadths.set(id, b)
    return b
  }

  // main-axis coordinate for a depth level (y for vertical, x-center for horizontal)
  const mainAt = (depth: number): number =>
    horizontal ? NODE_W / 2 + depth * (NODE_W + H_LEVEL_GAP) : depth * V_GAP

  // `center` is the node's center on the cross axis
  const place = (id: string, center: number, depth: number) => {
    const n = chain.nodes[id]
    if (horizontal) pos[id] = { x: mainAt(depth), y: center - crossSize(id) / 2, depth }
    else pos[id] = { x: center, y: mainAt(depth), depth }
    if (!n.children.length) return
    const total = n.children.reduce((s, c) => s + breadth(c), 0) + crossGap * (n.children.length - 1)
    let edge = center - total / 2
    for (const c of n.children) {
      const b = breadth(c)
      place(c, edge + b / 2, depth + 1)
      edge += b + crossGap
    }
  }

  place(chain.rootId, 0, 0)
  return pos
}

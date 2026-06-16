export type DropZone = 'before' | 'after' | 'child'

/**
 * Which drop zone a pointer is over within a target card. The middle band is
 * "child" (reparent under target); the leading/trailing bands are sibling
 * inserts. 'v' = vertical stack (chain feed, top/bottom); 'h' = horizontal
 * siblings (tree canvas, left/right).
 */
export function zoneFromEvent(rect: DOMRect, x: number, y: number, orientation: 'h' | 'v'): DropZone {
  const t = orientation === 'v' ? (y - rect.top) / rect.height : (x - rect.left) / rect.width
  if (t < 0.28) return 'before'
  if (t > 0.72) return 'after'
  return 'child'
}

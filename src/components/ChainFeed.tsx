import { useMemo, type CSSProperties } from 'react'
import { flattenChain, ghostedIds } from '../lib/forest'
import { useCardDnD } from '../hooks/useCardDnD'
import type { Chain } from '../lib/types'
import { NodeCard } from './NodeCard'

const MAX_INDENT_DEPTH = 5 // beyond this, deeper levels share the same indent

interface ChainFeedProps {
  chain: Chain
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onAddChild: (id: string) => void
  onMove: (nodeId: string, parentId: string | null, position: number) => void
}

/**
 * The linear "chain" view: the tree in pre-order, top to bottom like a feed.
 * Threaded elbows + indent show structure; a "↳ parent" label appears when a
 * card doesn't directly follow its parent (e.g. a sibling after a deep subtree).
 */
export function ChainFeed({ chain, onEdit, onDelete, onAddChild, onMove }: ChainFeedProps) {
  const dnd = useCardDnD(chain, 'v', onMove)
  // chain is referentially stable across drag frames (App memoizes it; the drag's
  // state lives inside useCardDnD), so these recompute only when the tree changes.
  const items = useMemo(() => flattenChain(chain), [chain])
  const ghosted = useMemo(() => ghostedIds(chain), [chain])

  return (
    <div className="feed-wrap">
      {dnd.overlay}
      <div className="chain-feed">
        {items.map((it, i) => {
          const n = chain.nodes[it.id]
          const prev = items[i - 1]
          const showFrom = it.depth > 0 && prev?.id !== n.parent_id
          const fromTitle = n.parent_id ? (chain.nodes[n.parent_id]?.title ?? '') : ''
          return (
            <div
              key={it.id}
              className={'feed-item' + (ghosted.has(it.id) ? ' is-ghost' : '')}
              style={{ '--d': Math.min(it.depth, MAX_INDENT_DEPTH) } as CSSProperties}
            >
              {it.depth > 0 && (
                <span className={'feed-elbow' + (n.status === 'dropped' ? ' feed-elbow-dropped' : '')} />
              )}
              {showFrom && (
                <div className="feed-from" title={fromTitle}>
                  ↳ {fromTitle}
                </div>
              )}
              <NodeCard
                node={n}
                isRoot={it.id === chain.rootId}
                variant="feed"
                dnd={dnd.cardProps(it.id)}
                {...dnd.stateFor(it.id)}
                onEdit={() => onEdit(it.id)}
                onDelete={() => onDelete(it.id)}
                onAddChild={() => onAddChild(it.id)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

import type { DropZone } from '../lib/drag'
import type { CardPointerProps } from '../hooks/useCardDnD'
import { STATUS_META, type Status, type TreeNode } from '../lib/types'

export function StatusBadge({ status }: { status: Status }) {
  const m = STATUS_META[status] ?? STATUS_META.todo
  return (
    <span className={'badge ' + m.cls}>
      <i className="badge-dot" />
      {m.label}
    </span>
  )
}

interface NodeCardProps {
  node: TreeNode
  isRoot: boolean
  /** 'canvas' floats the add-child button below the card; 'feed' puts it in the actions row */
  variant?: 'canvas' | 'feed'
  /** drag-and-drop: pointer handlers to spread + live visual state */
  dnd?: CardPointerProps
  dragging?: boolean
  dropZone?: DropZone | null
  dropInvalid?: boolean
  inMovingSubtree?: boolean
  onEdit: () => void
  onDelete: () => void
  onAddChild: () => void
}

export function NodeCard({
  node,
  isRoot,
  variant = 'canvas',
  dnd,
  dragging = false,
  dropZone = null,
  dropInvalid = false,
  inMovingSubtree = false,
  onEdit,
  onDelete,
  onAddChild,
}: NodeCardProps) {
  const dropped = node.status === 'dropped'
  const body = dropped && node.decline_reason ? node.decline_reason : node.description
  const canDelete = node.children.length === 0 // leaf-only (D5)
  const canGrow = !dropped // a dropped branch is a tombstone (§3.1)
  const inlineAdd = variant === 'feed' && canGrow
  const cls = [
    'node-card',
    variant === 'feed' ? 'card-v' : 'card-h',
    dropped && 'is-dropped',
    isRoot && 'is-root',
    dragging && 'is-dragging',
    inMovingSubtree && 'is-submoving',
    dropInvalid && 'drop-invalid',
    dropZone && 'drop-' + dropZone,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      data-node-id={node.id}
      title="Drag to move · click to edit"
      role="button"
      tabIndex={0}
      aria-label={node.title}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onEdit()
        }
      }}
      {...dnd}
    >
      <div className="edit-hint" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      </div>
      <div className="node-top">
        <StatusBadge status={node.status} />
        {node.xparents.length > 0 && (
          <span
            className="xlink-tag"
            title={`Also appears under ${node.xparents.length} other ${node.xparents.length === 1 ? 'parent' : 'parents'}`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="2.4" />
              <circle cx="18" cy="6" r="2.4" />
              <circle cx="12" cy="18" r="2.4" />
              <path d="M7.6 7.8 11 15.6M16.4 7.8 13 15.6" />
            </svg>
            {node.xparents.length + 1}
          </span>
        )}
        {(canDelete || inlineAdd) && (
          <div className="node-actions">
            {inlineAdd && (
              <button
                className="icon-btn"
                title="Add child thought"
                onClick={(e) => {
                  e.stopPropagation()
                  onAddChild()
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            )}
            {canDelete && (
              <button
                className="icon-btn icon-btn-danger"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
      <div className="node-title">{node.title}</div>
      {body ? (
        <div className={'node-body' + (dropped && node.decline_reason ? ' node-body-reason' : '')}>
          {dropped && node.decline_reason ? <span className="reason-label">Why dropped · </span> : null}
          {body}
        </div>
      ) : null}
      {canGrow && variant === 'canvas' && (
        <button
          className="add-btn"
          title="Add child thought"
          onClick={(e) => {
            e.stopPropagation()
            onAddChild()
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
    </div>
  )
}

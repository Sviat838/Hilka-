export type Status = 'todo' | 'doing' | 'done' | 'dropped'

/** A row in the `nodes` table — the only entity (PLAN.md §3). */
export interface NodeRow {
  id: string
  user_id: string
  parent_id: string | null
  title: string
  description: string
  status: Status
  decline_reason: string | null
  position: number
  status_changed_at: string | null
  created_at: string
  updated_at: string
}

/** An extra parent→child edge beyond the home parent_id (cross-link references). */
export interface NodeLink {
  parent_id: string
  child_id: string
}

/** NodeRow + assembled child pointers, client-side only. */
export interface TreeNode extends NodeRow {
  children: string[]
  /** extra parents this node also hangs off of (cross-links), home parent_id excluded */
  xparents: string[]
  /** nodes cross-linked as extra children of this node, tree children excluded */
  xchildren: string[]
}

/** A root node and its subtree. Chains are not a DB entity (D3): chain id === root id. */
export interface Chain {
  rootId: string
  nodes: Record<string, TreeNode>
}

export const STATUS_META: Record<Status, { label: string; cls: string }> = {
  todo: { label: 'To do', cls: 'st-todo' },
  doing: { label: 'Doing', cls: 'st-doing' },
  done: { label: 'Done', cls: 'st-done' },
  dropped: { label: 'Dropped', cls: 'st-dropped' },
}

export const STATUSES: Status[] = ['todo', 'doing', 'done', 'dropped']

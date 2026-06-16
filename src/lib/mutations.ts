import type { NodeRow, Status, TreeNode } from './types'

/** What the edit sheet hands back on save. */
export interface SheetData {
  title: string
  description: string
  status: Status
  decline_reason: string
}

/** D6 — Dropped demands a non-blank reason; everything needs a title. */
export function canSave(data: SheetData): boolean {
  if (!data.title.trim()) return false
  if (data.status === 'dropped' && !data.decline_reason.trim()) return false
  return true
}

export function buildInsertRow(
  parentId: string | null,
  data: SheetData,
  position: number,
  now = new Date(),
): Omit<NodeRow, 'user_id' | 'created_at' | 'updated_at'> {
  return {
    id: crypto.randomUUID(), // client-generated (D4)
    parent_id: parentId,
    title: data.title.trim(),
    description: data.description.trim(),
    status: data.status,
    decline_reason: data.status === 'dropped' ? data.decline_reason.trim() : null,
    position,
    status_changed_at: now.toISOString(),
  }
}

/**
 * Patch for an edit-sheet save. Reopening a dropped node (PLAN.md §3.2)
 * preserves the old reason by prepending it to the description — the column
 * itself is also left intact so a later re-drop prefills it.
 */
export function buildUpdatePatch(node: TreeNode, data: SheetData, now = new Date()): Partial<NodeRow> {
  const reopened = node.status === 'dropped' && data.status !== 'dropped'
  let description = data.description.trim()
  if (reopened) {
    const stamp = now.toISOString().slice(0, 10)
    const line = `[${stamp}] Reopened. Was dropped: ${node.decline_reason ?? ''}`.trimEnd()
    description = description ? `${line}\n\n${description}` : line
  }

  const patch: Partial<NodeRow> = {
    title: data.title.trim(),
    description,
    status: data.status,
    updated_at: now.toISOString(),
  }
  if (data.status === 'dropped') patch.decline_reason = data.decline_reason.trim()
  if (data.status !== node.status) patch.status_changed_at = now.toISOString()
  return patch
}

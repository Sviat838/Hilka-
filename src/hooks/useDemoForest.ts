/**
 * In-memory forest for the public /demo — the same edit operations the real app
 * runs, but applied to a Chain held in React state instead of the database.
 *
 * It reuses the *exact* pure builders the DB path uses (buildInsertRow /
 * buildUpdatePatch / nextPosition / assembleChains), so a logged-out visitor can
 * branch, edit, drop and drag cards and watch the tree update live — with zero
 * network calls. The current rows are the same NodeRow[] shape the database
 * stores, so they drop straight into the post-signup handoff (see useFirstRunSeed).
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { assembleChains, nextPosition } from '../lib/forest'
import { buildInsertRow, buildUpdatePatch, type SheetData } from '../lib/mutations'
import { DEMO_TREE, payloadToRows } from '../lib/seed'
import type { Chain, NodeRow, TreeNode } from '../lib/types'
import analytics from '../lib/analytics'

export interface DemoForest {
  chain: Chain
  rows: NodeRow[]
  /** true once the visitor has changed anything — drives the "keep it" CTA */
  edited: boolean
  createNode: (parentId: string, data: SheetData) => void
  updateNode: (node: TreeNode, data: SheetData) => void
  deleteNode: (node: TreeNode) => void
  moveNode: (nodeId: string, parentId: string | null, position: number) => void
  reset: () => void
}

export function useDemoForest(): DemoForest {
  const [rows, setRows] = useState<NodeRow[]>(() => payloadToRows(DEMO_TREE))
  const [edited, setEdited] = useState(false)
  // the demo fixture always has exactly one root
  const chain = useMemo<Chain>(() => assembleChains(rows)[0], [rows])

  // mark the first real edit once (and only once) — the IKEA-effect moment the
  // "keep your tree" CTA hangs off of
  const editedRef = useRef(false)
  const touch = useCallback(() => {
    if (editedRef.current) return
    editedRef.current = true
    setEdited(true)
    analytics.track('Demo Edited')
  }, [])

  const createNode = useCallback(
    (parentId: string, data: SheetData) => {
      setRows((prev) => {
        const siblings = prev.filter((r) => r.parent_id === parentId)
        const row = buildInsertRow(parentId, data, nextPosition(siblings))
        const now = new Date().toISOString()
        return [...prev, { ...row, user_id: 'demo', created_at: now, updated_at: now }]
      })
      touch()
    },
    [touch],
  )

  const updateNode = useCallback(
    (node: TreeNode, data: SheetData) => {
      setRows((prev) => prev.map((r) => (r.id === node.id ? { ...r, ...buildUpdatePatch(node, data) } : r)))
      touch()
    },
    [touch],
  )

  const deleteNode = useCallback(
    (node: TreeNode) => {
      setRows((prev) => prev.filter((r) => r.id !== node.id))
      touch()
    },
    [touch],
  )

  const moveNode = useCallback(
    (nodeId: string, parentId: string | null, position: number) => {
      setRows((prev) => prev.map((r) => (r.id === nodeId ? { ...r, parent_id: parentId, position } : r)))
      touch()
    },
    [touch],
  )

  const reset = useCallback(() => {
    editedRef.current = false
    setEdited(false)
    setRows(payloadToRows(DEMO_TREE))
  }, [])

  return { chain, rows, edited, createNode, updateNode, deleteNode, moveNode, reset }
}

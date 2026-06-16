import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { assembleChains, nextPosition } from '../lib/forest'
import { buildInsertRow, buildUpdatePatch, type SheetData } from '../lib/mutations'
import type { Chain, NodeLink, NodeRow, TreeNode } from '../lib/types'

const NODES_KEY = ['nodes']

/** One query, whole forest + cross-links, assembled client-side (PLAN.md §4). */
export function useChains() {
  return useQuery({
    queryKey: NODES_KEY,
    queryFn: async (): Promise<Chain[]> => {
      const [nodesRes, linksRes] = await Promise.all([
        supabase.from('nodes').select('*').order('position').order('created_at'),
        supabase.from('node_links').select('parent_id, child_id'),
      ])
      if (nodesRes.error) throw nodesRes.error
      // links are an overlay — a links failure (e.g. table not migrated yet) must
      // not hide the whole journal; fall back to a plain tree with no cross-links
      if (linksRes.error) console.warn('node_links unavailable, skipping cross-links:', linksRes.error.message)
      const links = linksRes.error ? [] : ((linksRes.data ?? []) as NodeLink[])
      return assembleChains(nodesRes.data as NodeRow[], links)
    },
  })
}

/** Mutations are mutate → invalidate, no optimistic rollback machinery (D10). */
function useInvalidate() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: NODES_KEY })
}

export function useCreateNode() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (args: { parent: TreeNode | null; siblings: TreeNode[]; data: SheetData }) => {
      if (args.parent?.status === 'dropped') {
        throw new Error('A dropped branch cannot grow new children — reopen it first.')
      }
      const row = buildInsertRow(args.parent?.id ?? null, args.data, nextPosition(args.siblings))
      const { error } = await supabase.from('nodes').insert(row)
      if (error) throw error
      return row.id
    },
    onSettled: () => invalidate(),
  })
}

export function useUpdateNode() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (args: { node: TreeNode; data: SheetData }) => {
      const patch = buildUpdatePatch(args.node, args.data)
      const { error } = await supabase.from('nodes').update(patch).eq('id', args.node.id)
      if (error) throw error
    },
    onSettled: () => invalidate(),
  })
}

export function useDeleteNode() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (node: TreeNode) => {
      // D5 — delete is for typos, leaf nodes only; decline is for decisions.
      if (node.children.length > 0) {
        throw new Error('Only leaf thoughts can be deleted. Decline branches instead — the reason is the point.')
      }
      const { error } = await supabase.from('nodes').delete().eq('id', node.id)
      if (error) throw error
    },
    onSettled: () => invalidate(),
  })
}

/**
 * Move a node (and its whole subtree) to a new parent and/or position — one
 * single-row write covers both reparent and reorder (D7). The DB trigger
 * enforce_node_move (migration 0003/0005) rejects cycles and attach-to-dropped.
 */
export function useMoveNode() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (args: { nodeId: string; parentId: string | null; position: number }) => {
      if (args.parentId === args.nodeId) throw new Error('A thought cannot be its own parent.')
      const { error } = await supabase
        .from('nodes')
        .update({ parent_id: args.parentId, position: args.position, updated_at: new Date().toISOString() })
        .eq('id', args.nodeId)
      if (error) throw error
    },
    onSettled: () => invalidate(),
  })
}

/** Add a cross-link: `childId` will also appear under `parentId` (user_id defaults to auth.uid()). */
export function useAddLink() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (args: { parentId: string; childId: string }) => {
      if (args.parentId === args.childId) throw new Error('A thought cannot be its own parent.')
      const { error } = await supabase
        .from('node_links')
        .insert({ parent_id: args.parentId, child_id: args.childId })
      if (error) throw error
    },
    onSettled: () => invalidate(),
  })
}

/** Remove a cross-link (the node stays under its home parent). */
export function useRemoveLink() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (args: { parentId: string; childId: string }) => {
      const { error } = await supabase
        .from('node_links')
        .delete()
        .eq('parent_id', args.parentId)
        .eq('child_id', args.childId)
      if (error) throw error
    },
    onSettled: () => invalidate(),
  })
}

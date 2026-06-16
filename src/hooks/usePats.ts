import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { generateToken, sha256hex } from '../lib/pat'

const PATS_KEY = ['pats']

/** A token as shown in the list — never includes the hash. */
export interface PatRow {
  id: string
  name: string
  created_at: string
  last_used_at: string | null
}

/** The caller's Personal Access Tokens (RLS scopes the rows to them). */
export function usePats() {
  return useQuery({
    queryKey: PATS_KEY,
    queryFn: async (): Promise<PatRow[]> => {
      const { data, error } = await supabase
        .from('pat')
        .select('id, name, created_at, last_used_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as PatRow[]
    },
  })
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: PATS_KEY })
}

/**
 * Mint a token: generate it client-side, store only its hash (user_id defaults to
 * auth.uid()), and hand the RAW token back to show once — it is never recoverable.
 */
export function useCreatePat() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (name: string): Promise<string> => {
      const token = generateToken()
      const token_hash = await sha256hex(token)
      const { error } = await supabase.from('pat').insert({ token_hash, name: name.trim() })
      if (error) throw error
      return token
    },
    onSettled: () => invalidate(),
  })
}

/** Revoke (hard-delete) a token by id. */
export function useRevokePat() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('pat').delete().eq('id', id)
      if (error) throw error
    },
    onSettled: () => invalidate(),
  })
}

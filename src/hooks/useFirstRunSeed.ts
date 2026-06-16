/**
 * Feature 1 — auto-create a starter chain on a new user's first sign-in.
 *
 * Fires once, when an authenticated user has zero chains and hasn't been seeded
 * before. If they edited the public /demo before signing up, their edited tree is
 * waiting in localStorage (the handoff) and we persist THAT instead of the default
 * starter — so the effort they invested in the demo carries into their account.
 *
 * Idempotency is layered: a `hilka_seeded` flag on the account is the durable
 * guard (mirrors `hilka_onboarded`), a ref guards React StrictMode's double-mount,
 * and the chains.length check is the backstop — once any chain exists we never
 * seed again, so even a failed metadata write can't cause a duplicate.
 */
import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import analytics from '../lib/analytics'
import { HANDOFF_KEY, parseHandoff, STARTER_CHAIN, topoSortRows } from '../lib/seed'
import type { Chain, NodeRow } from '../lib/types'

/** Read + clear the demo→signup handoff (best-effort; storage may be unavailable). */
function takeHandoff(): NodeRow[] | null {
  try {
    const rows = parseHandoff(localStorage.getItem(HANDOFF_KEY))
    if (rows) localStorage.removeItem(HANDOFF_KEY)
    return rows
  } catch {
    return null
  }
}

/**
 * Persist an edited demo tree row-by-row. We own the (client-minted) ids already,
 * so no id round-trip is needed. The one subtlety: the DB blocks inserting a child
 * under a dropped parent, so we insert every node live (dropped → 'todo'), then
 * flip the dropped ones back with a status-only update (which the move-trigger
 * ignores). Single-row ops keep trigger/RLS/FK behaviour unambiguous.
 */
async function persistHandoff(rows: NodeRow[]): Promise<void> {
  const ordered = topoSortRows(rows)
  for (const r of ordered) {
    const { error } = await supabase.from('nodes').insert({
      id: r.id,
      parent_id: r.parent_id,
      title: r.title,
      description: r.description,
      status: r.status === 'dropped' ? 'todo' : r.status, // insert live; re-drop below
      decline_reason: null,
      position: r.position,
    })
    if (error) throw error
  }
  for (const r of ordered) {
    if (r.status !== 'dropped') continue
    const reason = r.decline_reason?.trim() || '(no reason given)'
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('nodes')
      .update({ status: 'dropped', decline_reason: reason, status_changed_at: now, updated_at: now })
      .eq('id', r.id)
    if (error) throw error
  }
}

/** Returns `true` while a seed is in flight, so the workspace can show a planting note. */
export function useFirstRunSeed(
  session: Session,
  chains: Chain[] | undefined,
  onSeeded: () => void,
): boolean {
  const started = useRef(false)
  const [seeding, setSeeding] = useState(false)

  useEffect(() => {
    if (started.current) return
    if (!chains) return // chains still loading — don't decide yet
    if (chains.length > 0) return // already has chains → never seed
    const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>
    if (meta.hilka_seeded) return
    started.current = true

    void (async () => {
      try {
        // An existing user who simply has no chains (they've already onboarded) —
        // don't surprise them with a starter; just mark them so we stop checking.
        if (meta.hilka_onboarded) {
          await supabase.auth.updateUser({ data: { hilka_seeded: true } })
          return
        }

        setSeeding(true)
        const handoff = takeHandoff()
        if (handoff) {
          await persistHandoff(handoff)
          analytics.track('Starter Chain Seeded', { source: 'demo_handoff', node_count: handoff.length })
        } else {
          const { error } = await supabase.rpc('create_chain', { p_payload: STARTER_CHAIN })
          if (error) throw error
          analytics.track('Starter Chain Seeded', { source: 'starter', node_count: STARTER_CHAIN.nodes.length + 1 })
        }
        onSeeded() // refetch so the new chain shows immediately
        // mark last: if this write fails the chains.length backstop still prevents a re-seed
        await supabase.auth.updateUser({ data: { hilka_seeded: true } })
      } catch (e) {
        started.current = false // let it retry on the next load
        console.warn('starter-chain seed failed:', e)
      } finally {
        setSeeding(false)
      }
    })()
  }, [session, chains, onSeeded])

  return seeding
}

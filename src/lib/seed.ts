/**
 * Seed content + pure helpers shared by the two "get a stranger thinking" surfaces:
 *
 *   • the public, editable /demo tree (src/components/Demo.tsx) — rendered in-memory
 *     with the real canvas, never touching the database, and
 *   • the starter chain auto-created on a new user's first sign-in
 *     (src/hooks/useFirstRunSeed.ts).
 *
 * Both grow from the SAME relatable root question so first-run and the demo teach
 * one lesson — branch, prune the dead options *with their reason*, reflect, branch
 * again. The dropped cards keep blunt, human reasons (not polished copy): the
 * tombstone-with-a-why is the most screenshot-able proof of the USP.
 *
 * This module is deliberately pure (no supabase / no analytics) so the in-memory
 * demo stays DB-free and the data shapes are unit-testable. The one DB-touching
 * piece — actually seeding / persisting — lives in src/hooks/useFirstRunSeed.ts.
 */
import type { Chain, NodeRow, Status } from './types'
import { assembleChains } from './forest'

/** A node in a seed fixture, in the create_chain payload shape (key / parent_key). */
export interface SeedNode {
  key: string
  /** key of the parent node, or null for the chain root */
  parentKey: string | null
  title: string
  description: string
  status: Status
  /** required (non-blank) iff status === 'dropped' */
  declineReason?: string
}

/** The create_chain RPC payload shape (root is `title`/`root_description`; the
 *  array holds the non-root nodes). See supabase/migrations/0007. */
export interface ChainPayloadNode {
  key: string
  parent_key: string | null
  title: string
  description?: string
  status?: Status
  decline_reason?: string
}
export interface ChainPayload {
  title: string
  root_description: string
  nodes: ChainPayloadNode[]
}

/** localStorage key the /demo edits are stashed under for the post-signup handoff. */
export const HANDOFF_KEY = 'hilka-demo-handoff'

/**
 * The /demo example tree. A 34-year-old mid-life "am I on the right path?" loop —
 * engineered for self-recognition ("oh, I've thought exactly this") and to teach
 * the mechanic by doing: a struck-through dropped card carries a raw, lowercase,
 * typed-at-2am reason, and a *done* card stays VISIBLE under a dead branch
 * (move-berlin under the dropped move-lisbon) so "the dead end stays on the
 * record" is literal in one screen. Rendered only in-memory, so it is free of the
 * DB rule that a dropped node must be a leaf.
 */
export const DEMO_TREE: SeedNode[] = [
  {
    key: 'root',
    parentKey: null,
    status: 'doing',
    title: 'What do I actually want to do with my life?',
    description:
      "Thirty-four. Good job, fine apartment, and a quiet 9pm feeling that I'm just maintaining a life I never actually chose. Writing the options down so I stop running the same loop at 2am.",
  },
  {
    key: 'chase',
    parentKey: 'root',
    status: 'doing',
    title: 'Go all-in on the thing I actually care about',
    description:
      'The photography. The only thing I lose hours to without checking the clock. Question is whether it survives contact with rent.',
  },
  {
    key: 'chase-budget',
    parentKey: 'chase',
    status: 'doing',
    title: 'Run the real numbers, not the fantasy ones',
    description:
      "Started the budget. Stopped at the exact line where I'd have to tell people I'm leaving the salary. That hesitation is data too.",
  },
  {
    key: 'chase-quit',
    parentKey: 'chase',
    status: 'dropped',
    title: 'Quit on Friday and figure it out after',
    description: '',
    declineReason:
      "did the math at 2am. four months of runway and no plan isn't brave, it's panic with a resignation letter attached. the version of me who does this is just scared, not free.",
  },
  {
    key: 'chase-side',
    parentKey: 'chase',
    status: 'todo',
    title: 'Keep the job, give it the best hour of every morning',
    description:
      "Boring answer. Probably the right one. Ship one real series before I bet the rent on it — if I won't do the small version, I was never doing the big one.",
  },
  {
    key: 'move',
    parentKey: 'root',
    status: 'todo',
    title: 'Sell everything and move abroad',
    description:
      "Lisbon. Sun, cheap rent, a version of me who finally has their act together. I keep opening this tab when I'm tired.",
  },
  {
    key: 'move-lisbon',
    parentKey: 'move',
    status: 'dropped',
    title: 'Book the one-way ticket to Lisbon',
    description: '',
    declineReason:
      "spent two hours pricing flights instead of texting one friend back. that's the whole thing right there. it's not the city — i'd just be lonely in better weather, and i'd still be the one I was running from.",
  },
  {
    key: 'move-berlin',
    parentKey: 'move-lisbon',
    status: 'done',
    title: 'Already ran this experiment — Berlin, 2019',
    description:
      'Lasted eleven months. Same restlessness, new postcode, worse furniture. Leaving it on the tree so future-me reads it before booking anything.',
  },
  {
    key: 'school',
    parentKey: 'root',
    status: 'todo',
    title: 'Go back to school and reset everything',
    description:
      "A master's. A clean reason to start over that nobody could argue with. Or — and I'm only just letting myself think this —",
  },
  {
    key: 'school-masters',
    parentKey: 'school',
    status: 'dropped',
    title: "Enroll in the master's to reset my career",
    description: '',
    declineReason:
      "$60k and two years to avoid admitting I don't know what I'd even do with the degree. buying a credential isn't the same as buying a direction. honestly I just wanted the deadline so the not-knowing would stop.",
  },
  {
    key: 'school-cheap',
    parentKey: 'school',
    status: 'doing',
    title: 'Test the field with one cheap course first',
    description:
      "One evening class. One coffee with someone who already does it. Same rule as the photography — if I won't do the $40 version, the $60k version was always a fantasy.",
  },
  {
    key: 'clarity',
    parentKey: 'root',
    status: 'done',
    title: 'Wait — whose life am I even trying to win?',
    description:
      "Ruled out the version of this that was just my dad's voice and the group chat scoreboard. Turns out half my 'behind' was other people's race. Kept the half that's actually mine.",
  },
]

/**
 * The default starter chain seeded on a brand-new account. A CLOSE VARIANT of the
 * demo: same root question, but mostly a scaffold the user fills in — three blank
 * prompt-questions (todo) plus ONE fully-worked example branch so they learn
 * "kill a branch, keep the why" hands-on on first sign-in.
 *
 * Note: unlike the in-memory demo, this goes through create_chain, which rejects a
 * child under a dropped node ("drop only leaves", migration 0007). So the worked
 * example keeps the dropped card (escape-drop) as a LEAF and puts the kept-record
 * "done" card (escape-tried) as its sibling. The richer "done card under a dropped
 * branch" beat lives in /demo, where there is no such constraint.
 */
export const STARTER_CHAIN: ChainPayload = {
  title: 'What do I actually want to do with my life?',
  root_description:
    "This is your tree — start anywhere, there's no wrong card. Rename this root to the question that's actually keeping you up, or leave it. The point isn't to answer today; it's to stop re-arguing it in your head at 2am.",
  nodes: [
    {
      key: 'pull',
      parent_key: null,
      status: 'todo',
      title: "What would I do if money weren't the question?",
      description: 'One card. The thing you lose hours to. Write it before you talk yourself out of it.',
    },
    {
      key: 'fear',
      parent_key: null,
      status: 'todo',
      title: 'What am I actually scared will happen if I choose wrong?',
      description: 'Name it plainly. Half the paralysis dies the second the fear is a sentence instead of a fog.',
    },
    {
      key: 'whose',
      parent_key: null,
      status: 'todo',
      title: "How much of 'behind' is mine — and how much is everyone else's scoreboard?",
      description: "Be honest about whose race you're running. You can't win a game you didn't pick.",
    },
    {
      key: 'escape',
      parent_key: null,
      status: 'doing',
      title: 'The escape fantasy — blow it all up and start over',
      description:
        'Everyone has one: move abroad, quit Friday, vanish. This branch is worked through as an example — read how it gets pruned, then build your own the same way.',
    },
    {
      key: 'escape-tried',
      parent_key: 'escape',
      status: 'done',
      title: 'I already ran this experiment once',
      description:
        "A past attempt that didn't fix it. The dead end isn't gone — it's evidence. Replace this with your own, or delete it.",
    },
    {
      key: 'escape-drop',
      parent_key: 'escape',
      status: 'dropped',
      title: 'Sell everything and move to a new city',
      description: '',
      decline_reason:
        "this is the example — I cut it, but Hilka kept the reason instead of deleting it. mine: two hours pricing flights instead of fixing one real thing here. it's not the city — I'd just pack myself in the suitcase. (your turn: kill a branch and write the real reason, not the polite one.)",
    },
  ],
}

/**
 * Turn a key/parent_key fixture into real NodeRow[] with client-minted UUIDs and
 * fractional sibling positions — exactly the shape useChains() produces from the
 * DB, so the demo can feed the real canvas. `created_at` etc. get placeholder
 * stamps; only `position` (sibling order) and the parent links matter for layout.
 */
export function payloadToRows(nodes: SeedNode[]): NodeRow[] {
  const ids = new Map<string, string>()
  for (const n of nodes) ids.set(n.key, crypto.randomUUID())
  const seqByParent = new Map<string, number>()
  const now = new Date().toISOString()
  return nodes.map((n) => {
    const pk = n.parentKey ?? '__root__'
    const seq = (seqByParent.get(pk) ?? 0) + 1
    seqByParent.set(pk, seq)
    return {
      id: ids.get(n.key)!,
      user_id: 'demo',
      parent_id: n.parentKey ? (ids.get(n.parentKey) ?? null) : null,
      title: n.title,
      description: n.description,
      status: n.status,
      decline_reason: n.status === 'dropped' ? (n.declineReason ?? '') : null,
      position: seq * 1024,
      status_changed_at: now,
      created_at: now,
      updated_at: now,
    }
  })
}

/** The demo tree as a ready-to-render Chain (one root). */
export function demoChain(): Chain {
  return assembleChains(payloadToRows(DEMO_TREE))[0]
}

/**
 * Order rows so every parent precedes its children — the order in which the
 * handoff must be inserted, since a child insert requires its parent to exist
 * (and to be non-dropped) first.
 */
export function topoSortRows(rows: NodeRow[]): NodeRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const done = new Set<string>()
  const out: NodeRow[] = []
  const visit = (r: NodeRow) => {
    if (done.has(r.id)) return
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined
    if (parent) visit(parent)
    done.add(r.id)
    out.push(r)
  }
  rows.forEach(visit)
  return out
}

/**
 * Validate + narrow a parsed handoff blob to NodeRow[]. Guards against tampered /
 * stale localStorage: must be a non-empty array of node-ish rows forming exactly
 * one tree (one root, every parent present, dropped nodes carry a reason).
 */
export function parseHandoff(raw: string | null): NodeRow[] | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(data) || data.length === 0 || data.length > 500) return null
  const rows = data as Partial<NodeRow>[]
  const ids = new Set<string>()
  for (const r of rows) {
    if (typeof r.id !== 'string' || typeof r.title !== 'string' || !r.title.trim()) return null
    if (!['todo', 'doing', 'done', 'dropped'].includes(r.status as string)) return null
    if (r.parent_id != null && typeof r.parent_id !== 'string') return null
    if (r.status === 'dropped' && !(typeof r.decline_reason === 'string' && r.decline_reason.trim())) return null
    ids.add(r.id)
  }
  let roots = 0
  for (const r of rows) {
    if (r.parent_id == null) roots++
    else if (!ids.has(r.parent_id)) return null // orphan → reject the whole blob
  }
  if (roots !== 1) return null
  return rows as NodeRow[]
}

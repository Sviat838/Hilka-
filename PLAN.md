# Hilka — Plan

A personal decision-tree journal. *Hilka* (гілка) = branch — and the branch, especially the dead one, is the product.

> Status: v1 rebuilt 2026-06-12 against the "Thought Chains" canvas mockup (see §5 amendment) on a fresh Supabase project (`htrvknxzunkqxcqsqxpm`, eu-central-1) after the first outline-style build was rejected on design. Originally produced 2026-06-12 from a 4-perspective design pass (product, database, stack/hosting, UI) + adversarial critique, reconciled into the single set of decisions below.

---

## 1. Concept

**A decision journal shaped like a tree, where dead branches are first-class citizens.**

Every notes tool records what you decided. Almost nothing records *what you decided against, and why*, in a structure that shows where each rejection sits in the larger exploration. That is the entire product:

- **Kills re-litigation.** "Why didn't we do the Telegram bot?" → one click, with the reason written at the moment you knew the most.
- **Turns rejected ideas into inventory.** Decline reasons are conditions, not verdicts ("no liquidity for this *yet*"). When the world changes, scan declined branches and re-open the ones whose reasons expired.
- **Shows the shape of your thinking.** At this fork you considered 5 directions, killed 3, parked 1, walked 1. That map is the artifact.

**Job-to-be-done:** *"When I'm exploring a big ambiguous decision over weeks, show me the full map of options considered and why dead paths died, so I never re-explore a dead end unknowingly and can resurrect branches when conditions change."*

Hilka is **not** an outliner, a notes app, or a task manager. It is a ledger of decisions about directions. That narrowness is the moat against "why not just use Workflowy."

### Comparables — copy / avoid

| Product | Copy | Avoid |
|---|---|---|
| Workflowy | Keyboard-driven outline, instant capture, zoom-into-node navigation | Being a generic outliner — Hilka's edge is *enforced* decision semantics |
| Gingko | Calm tree navigation (column-per-depth is a nice v2 idea) | Writing/drafting focus |
| Tana / Notion | Structured fields on outline nodes | The flexible-schema rabbit hole — Hilka has ONE fixed schema, on purpose |
| Decision journals (Farnam Street) | Recording reasoning *at decision time*, reviewing later | Flat chronology — tree context is exactly what they're missing |

---

## 2. Decision log (reconciled)

Contested points the design pass surfaced, settled here. **These are frozen for MVP** — re-opening one requires a written reason (dogfood the product).

| # | Decision | Rationale |
|---|---|---|
| D1 | ~~**Statuses: exactly `open / accepted / declined / parked`**~~ → **`open / declined` only** *(amended 2026-06-13)*, stored as `TEXT + CHECK`, not a Postgres enum | "Exploring" cut — exploration *is* having children; fuzzy-entry statuses rot. "Done" cut — task-manager territory. TEXT+CHECK because enum values can never be removed and this list already churned 4× during planning — **and indeed it churned again: 2026-06-13 the owner dropped `accepted` and `parked` (migration 0002), collapsing to live-vs-dead. A thought is `open` (under consideration, grows children) or `declined` (dead, requires a reason, struck through). TEXT+CHECK made this a one-line constraint swap + data backfill, exactly the flexibility this decision bought.** **Re-amended again 2026-06-13: `open`/`declined` was itself replaced by a four-value PROGRESS axis — `todo / doing / done / dropped` (migration 0005).** The owner wanted to track where each thought *stands* (started / in progress / finished / gave up), not just keep-vs-reject it. `dropped` inherits every bit of `declined`'s tombstone behavior (leaf-only, non-blank reason, struck through, greyed subtree); `todo`/`doing`/`done` are all "live" exactly as `open` was. Names chosen for i18n (Trello/Notion's most-translated vocabulary; "Dropped" beats "Abandoned" for non-native readers). The TEXT+CHECK bet paid off a third time |
| D2 | **Supabase from day one** (no localStorage v0), with `user_id` + RLS **in migration one** | Durability beats localStorage for a journal whose value compounds for years; setup is ~1 hour; the anon key ships in the JS bundle, so RLS is not optional — without it the journal is publicly readable AND writable via PostgREST |
| D3 | **One table.** No `trees` table — a root is a node with `parent_id IS NULL` | Multiple trees for free via multiple roots; no two-entity tax, no composite-FK machinery |
| D4 | **Client-generated UUIDs** (`crypto.randomUUID()`), not DB identity columns | Optimistic create, focus-follow, and Enter-Enter-Enter rapid capture all need the ID before the round-trip; also makes export/import ID-stable |
| D5 | **Delete: leaf-only, app-enforced, `ON DELETE RESTRICT` in DB** | Delete is for typos; decline is for decisions. CASCADE would let one buggy mutation vaporize the record the product exists to keep. "Declined" is the real soft-delete |
| D6 | **`decline_reason` required and non-blank** — UI disables Confirm until non-empty, DB checks `btrim(decline_reason) <> ''` | The hero constraint, enforced at both layers; `IS NOT NULL` alone lets `''` through |
| D7 | **Sibling order: `position double precision`**, fractional indexing (insert = average of neighbors, append = max + 1024) | Single-row writes for any reorder; `real`/float4 exhausts bisection precision too soon; `int default 0` kills insert-between entirely |
| D8 | **Export from day one: Markdown + JSON.** ~~Weekly GitHub Actions cron commits `backup.json` to the private repo~~ *(cron dropped 2026-06-13, owner request)* | Markdown (~30 lines: indented bullets + `[declined: reason]`) is abandonment insurance — readable forever, pastes into Obsidian. **Amended 2026-06-13:** the automated backup/keep-alive cron was removed — backups are now manual via the in-app Markdown/JSON export buttons. Consequence the cron used to mask: a free Supabase project pauses after 7 days of no DB activity (data kept, one-click restore); regular use of the live app is now the keep-alive |
| D9 | **Decline UI: anchored popover, not a modal**; status + reason commit as one atomic mutation; Esc reverts | Keeps you in flow next to the node; never a half-declined node |
| D10 | **No optimistic-rollback machinery in MVP**: mutate → `invalidateQueries` | Single user, tiny payloads — latency is fine; rollback paths that never run are untested code. Add optimism only if typing feels laggy |
| D11 | **Indent/outdent (`Tab`/`Shift+Tab`) ships in MVP; arbitrary drag-reparenting is v2** | Constrained moves are cycle-safe and core outliner grammar; free-form moves are not needed for decision trees. Superseded 2026-06-12 (canvas pivot) → no reparenting. Re-amended 2026-06-13 first as popup controls (Structure section). **Re-amended again 2026-06-13 (owner request — keep the Edit popup minimal): reparent + reorder are now DRAG-AND-DROP** in both tree and chain views; the popup is back to title/description/status only. Cards are `draggable`; dropping resolves via pure `computeMove` → drop zones: middle = become child, leading/trailing edge = sibling before/after (HTML5 DnD; zone from screen-space rect, so it works on the scaled canvas). **Nodes stay strictly positioned** — drag never sets free x/y, only (parent, position); the tidy layout still computes placement. Dropping on the chain root is always "child" (drag never makes a new root). Guards at three layers: `computeMove` (self / own-descendant / declined), client cycle-tolerant assembly, and the DB `BEFORE` trigger `enforce_node_move` (migration 0003) rejecting cycles + attach-to-declined. One single-row `parent_id`+`position` write per move (D7 fractional indexing) |
| D12 | **Strict tree forever.** v2 cross-links are soft references, never multi-parent | A DAG destroys the zoom-into-branch mental model and 10×es UI complexity |

---

## 3. Domain model & product rules

### Node fields (the only entity)

```
id                 uuid (client-generated)
user_id            uuid → auth.users
parent_id          uuid | null      -- null = root; roots are the "trees"
title              text, required   -- one line
description        text             -- markdown: details, links, evidence
status             todo | doing | done | dropped  (default todo)  -- D1 re-amended 2026-06-13 (migration 0005)
decline_reason     text             -- required + non-blank iff dropped (column name historical; holds the drop reason)
position           double precision -- fractional sibling order
status_changed_at  timestamptz      -- the journal moment (app-set)
created_at / updated_at
```

Deliberately deferred: tags, confidence scores (people fiddle with numbers instead of writing reasons — the prose IS the value), structured notes log, structured links.

### Rules

> **2026-06-13 (migration 0005):** the status set is now the progress axis `todo / doing / done / dropped`. In the rules below, read `open`/`accepted`/`parked` as any **live** status (`todo`/`doing`/`done`) and `declined` as **`dropped`** — the tombstone semantics are unchanged, only the names. The editor now shows a 4-way **To do / Doing / Done / Dropped** segmented control and a matching colored badge per card.

1. **Dropped nodes cannot grow new children** — hard block in the app (not a warning). A dropped branch is a tombstone; existing children stay visible, greyed. The friction is the point.
2. **Re-opening is a core flow** (`declined → open`). The old reason is preserved: auto-prepend to description `"[2026-06-12] Reopened. Was declined: <reason>"`. This must be in the status-change mutation spec or it silently won't get built.
3. **Multiple roots** — one per big decision. Sidebar lists roots. Store shape is `rootIds: string[]`, assembly loop collects all `parent_id === null` nodes (not just the last one).
4. **Delete is for typos** — leaf nodes only. Anything with thought invested gets declined.
5. **Siblings aren't mutually exclusive** — a fork can keep several `open` directions alive at once. *(Was "multiple accepted siblings allowed"; `accepted` removed in D1's 2026-06-13 amendment — only `open`/`declined` remain.)*
6. **Only `declined` is restrictive** — an `open` node allows children and edits; `declined` is the one status that blocks new children. *(Was "parked behaves like open"; `parked` removed in the same amendment.)*
7. **No event-sourcing.** `status_changed_at` + decline reasons + the reopen-prepend convention is the audit trail. An append-only `node_events` table is v2, if ever.

---

## 4. Architecture & stack

```
Browser ── Vite + React + TS SPA ──> Cloudflare Pages   (static, free, unlimited requests)
                │ supabase-js (anon key + JWT)
                ▼
            Supabase free project:  Postgres + Auth + RLS + auto REST (PostgREST)
                ▲
GitHub Actions weekly cron ── backup.json commit (backup + keep-alive + repo activity)
```

- **Frontend: Vite + React SPA (TypeScript) + Tailwind.** Not Next.js/SvelteKit: the app is 100% behind auth, so SSR/SEO buys nothing; static files are the most generously free thing on the internet; React has the deepest ecosystem for the pieces needed (supabase-js, TanStack Query).
- **Backend: none.** Supabase's generated REST API + RLS *is* the backend. No Edge Functions in MVP.
- **Data fetching: TanStack Query.** One query `['nodes']` → `select *` → normalize client-side. Mutations invalidate (D10). Debounce description saves ~600 ms **with flush on blur + `visibilitychange`** (otherwise the last edit before tab-close is lost).
- **Client state: normalized** `Map<id, {…, parentId, childrenIds}>` + `rootIds: string[]`. Moves are 3 pointer edits; edits are O(1); it's isomorphic to the DB row; React Flow (v2 map view) wants flat arrays anyway. View state (focus, collapsed set — localStorage, not DB) in a small context.
- **Auth: Supabase email+password, one user created manually in the dashboard, public signups disabled, RLS scoped to `user_id`.** Password over magic link: session persists in localStorage, you log in ~once per device ever.

### Database: why Postgres, why adjacency list

- **Not a graph DB.** Graph databases earn their complexity on graph-shaped *queries* (variable-length patterns over many edge types), not graph-shaped *data*. Hilka has one edge type, one parent per node, and queries that are trivial `parent_id` lookups. Also: Neo4j Aura Free pauses instances and deletes them after ~30 days paused — disqualifying for a journal you might not open for a month.
- **Not MongoDB.** Tree-as-document makes node updates read-modify-write surgery; doc-per-node is just an adjacency list with the integrity stripped out (no conditional CHECK for the decline rule).
- **Adjacency list over ltree / closure table / nested sets.** Those exist to fetch subtrees from huge tables without recursion. Hilka's whole forest fits in memory ×1000: the dominant read is one indexed `select * where user_id = me`, assembled client-side in O(n). And adjacency list is the only scheme where a subtree move is a single-row UPDATE. Recursive CTE stays available for exports.

### Migration 0001 (the whole schema)

```sql
create table nodes (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users(id),
  parent_id         uuid references nodes(id) on delete restrict,
  title             text not null,
  description       text not null default '',
  status            text not null default 'todo'
                      check (status in ('todo','doing','done','dropped')),  -- D1 re-amended 2026-06-13 (migration 0005)
  decline_reason    text,
  position          double precision not null default 1024,
  status_changed_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint decline_reason_required check (
    status <> 'dropped'
    or (decline_reason is not null and btrim(decline_reason) <> '')
  )
);

create index idx_nodes_user   on nodes (user_id);
create index idx_nodes_parent on nodes (parent_id);

alter table nodes enable row level security;
create policy owner_all on nodes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Notes: the decline CHECK is one-directional on purpose — re-opening does **not** wipe the old reason (preserving it is the product). `updated_at`/`status_changed_at` are app-set in the same UPDATE. Cycle prevention *(updated 2026-06-13, drag reparenting shipped — see D11)*: enforced at all three layers — pure `computeMove` in the client (resolves a drop, rejects self/own-descendant/declined), a `BEFORE INSERT OR UPDATE OF parent_id` trigger `enforce_node_move` (migration 0003, also blocks attach-to-declined), and the client assembly still breaks any back-edge + surfaces stranded rows as extra chains as a last resort.

### Whole-forest load + assembly

```sql
select * from nodes order by parent_id nulls first, position;
```

```ts
const byId = new Map(rows.map(r => [r.id, { ...r, childrenIds: [] as string[] }]));
const rootIds: string[] = [];
for (const n of byId.values())
  n.parent_id === null ? rootIds.push(n.id) : byId.get(n.parent_id)!.childrenIds.push(n.id);
```

---

## 5. UI/UX

> **⚠️ AMENDED 2026-06-12 — canvas-first, not outline-first.** The original outline
> decision below is superseded. Reason (recorded per §2's own rule): the first build
> followed this section and shipped a Workflowy-style outline; the owner rejected it —
> "completely different in design" from the approved mockup (`Hilka — Standalone.html`,
> "Thought Chains"). The mockup is the design of record: a **chain list** page plus a
> **pan/zoom canvas** per chain — tidy top-down tree of 264px cards, curved connectors
> (dashed for declined), status badges, an edit sheet for capture, themes
> paper/ink/warm (Spectral + Public Sans). The outline's keyboard grammar is dropped;
> capture is Enter-to-save in the sheet (plus ⌘/Ctrl+Enter from any sheet field — an
> additive shortcut not present in the mockup, kept deliberately).
>
> *2026-06-13 owner-requested additions:* a second per-chain view — **chain view**, the
> tree flattened pre-order into a top-down feed (threaded elbows, depth indents capped
> at 5, "↳ parent" label when a card doesn't directly follow its parent) — with a
> tree/chain switcher in the canvas header (persisted locally); and a fourth,
> true-black theme (`black`) alongside paper/ink/warm. Everything else in this section that is not
> outline-specific (status encoding intent, mandatory decline reason in the editor,
> declined-can't-grow) carries over to the canvas. The v1 rebuild (2026-06-12) also
> originally pulled `parked` into the UI as a fourth segment/badge per D1 — but D1 was
> later amended (2026-06-13) to drop both `accepted` and `parked`, so the editor now
> offers only Open / Declined.

**~~Primary (and only MVP) view: Workflowy-style collapsible indented outline.~~** *(superseded — see amendment above)* No graph library — a recursive `<NodeRow>` with `padding-left` is an afternoon. Hilka is write-heavy and text-heavy: you'll add nodes 50× more often than you admire topology. Declined branches collapse to one struck-through line each; on a canvas they'd clutter the viewport. **v2: read-only "map view"** with React Flow (MIT core is free; auto-layout via free `d3-hierarchy` `tree()` — only polished examples and badge removal are paid) for the one thing outlines can't do: seeing the shape of the exploration.

**Status encoding** (dot shape + strikethrough, never color alone):

| Status | Dot | Title | Extra |
|---|---|---|---|
| open | gray ○ | normal | — |
| accepted | green ● | normal (don't tint the text) | subtle green left border on subtree |
| declined | muted red ● | muted gray + strikethrough | reason as small italic line beneath — the WHY visible without opening anything |
| parked | gray ● | dimmed/italic | — |

**Decline flow (the hero interaction):** click status dot (or `S`) → menu; `open`/`accepted`/`parked` apply instantly; `declined` opens an anchored popover with one autofocused "Why declined?" textarea, Confirm disabled until non-blank, `Cmd+Enter` confirms, `Esc` reverts. Atomic mutation, DB CHECK as backstop.

**Keyboard grammar (day one, nothing more):** `↑/↓` focus · `←/→` collapse/expand (at the edge of the text caret) · `Enter` new sibling · `Cmd+Enter` new child · `Tab`/`Shift+Tab` indent/outdent (Tab on a first sibling = no-op) · `Cmd+.` status menu · `Cmd+I` detail panel · `Cmd+Backspace` delete leaf. *Amended at build time:* the original `S`/`A`/`D`/`O`/`P` and `Space` bindings are impossible with always-editable title inputs (bare letters type into the title) — modifier chords replace them. Deferred: undo, `Cmd+K` jump (week two), zoom-into-node + breadcrumb (week two), drag-and-drop, multi-select.

**Editing:** titles inline; description/timestamps in a right-side detail panel (full-screen sheet under ~640 px). Capture must take **< 3 seconds**: Enter, type, done — title now, description later.

**Mobile:** the outline is natively phone-shaped (a canvas isn't). Row tap targets ≥ 44 px, hover-revealed buttons also appear on tap/focus, cap visual indent ~5 levels.

---

## 6. Hosting & ops (free tiers verified 2026-06-12)

**Pick: Cloudflare Pages (SPA) + Supabase free project. $0, no card.**

| Provider | Free tier (verified) | Gotcha |
|---|---|---|
| **Supabase** ✅ | 2 projects, 500 MB DB, 50k MAU auth, 5 GB egress | **Pauses after 7 days of no DB activity** (data kept, manual restore; restore window for long-paused projects is limited — verify policy) |
| **Cloudflare Pages** ✅ | Static requests free & unlimited, 500 builds/mo | None for static-only use |
| Vercel Hobby (runner-up) | 100 GB bandwidth, 1M fn invocations | Non-commercial only; hitting any cap pauses until cycle reset |
| Netlify | 300 credits/mo (Apr 2026 model) | Exceed → suspended rest of month |
| Neon | 100 CU-hrs/mo, 0.5 GB | Scale-to-zero cold starts; no built-in auth |
| Render | 750 hrs/mo | 15-min spin-down, ~1-min cold start |
| Fly.io ❌ | No free tier (removed 2024) | — |
| Railway ❌ | $5 one-time trial only | — |

**The realistic data-loss chain, and the one mitigation:** repo goes quiet → **GitHub disables scheduled workflows after 60 days of repo inactivity** → keep-alive dies silently → Supabase pauses at day 7 → long-paused free project degrades to backup-download. Mitigation (D8): the weekly cron **fetches all rows and commits `backup.json`** — real DB activity (no pause), an offsite versioned backup, and the commit itself keeps the repo active so the schedule never dies. One stone, three birds.

---

## 7. Milestones (each independently shippable)

- **M0 — Deployed hello (½ day).** Vite+React+TS repo → Cloudflare Pages via git. Hardcoded nested list renders at the live URL. Pipeline proven before real code.
- **M1 — Schema + lockdown (½ day).** Supabase project; migration 0001 above (RLS included from the start); create the one user, disable signups; login page + session persistence.
- **M2 — Read-only tree (1 day).** Insert the real prediction-markets tree via SQL. App loads, normalizes, renders the outline with status styling. Already useful as a viewer.
- **M3 — Full CRUD + decline flow (1–2 days).** Create sibling/child, inline title edit, detail panel, status popover with enforced reason, leaf-only delete, declined-can't-grow-children block, reopen-with-prepend. **This is the MVP.**
- **M4 — Safety net + ergonomics (1 day).** Markdown + JSON export buttons; GitHub Actions weekly backup-commit cron; collapse/expand with localStorage persistence + collapsed-count chips (`▸ 5 (3 declined)`, declined auto-collapsed); full keyboard grammar; seed fixture JSON in repo.
- **Week 2+:** `Cmd+K` jump, zoom-into-node + breadcrumb, undo stack, graveyard review (all declined/parked across trees), Obsidian export, then the v2 backlog.

**Acceptance test for the whole plan:** a real decline reason for a real prediction-markets sub-direction is recorded within 48 hours of `git init`.

### v2+ backlog (only after weeks of real dogfooding)
Full-text search · graveyard review with parked-item resurfacing · drag reorder/reparent · tags · soft cross-links (never multi-parent) · read-only share links · React Flow map view · `node_events` audit table · AI: suggest sibling alternatives at a fork, devil's-advocate a decline reason before committing it.

---

## 8. Risks

1. **It becomes a worse Workflowy** — if statuses/reasons feel optional. Mitigation: the decline ritual is mandatory and central; the tool stays aggressively opinionated about its one job.
2. **The founder-engineer trap** (the biggest one — the design pass itself demonstrated it by gold-plating until "days" became weeks). Mitigation: the decision log above is frozen; the 9-field schema is fixed; the first tree logged is the real startup decision. Building Hilka must not become the way to avoid the decision it serves.
3. **Capture friction → stale tree → lost trust.** A decision journal that's out of date lies about what was considered. Mitigation: keyboard-first sub-3-second capture.
4. **Data loss kills compounding value.** Mitigation: D8 — markdown export (outlives the app, pastes into Obsidian) + automated versioned `backup.json`.

## Do NOT use
Graph DBs (one `parent_id` column does it) · Kubernetes/Docker/Terraform (zero servers) · separate API server (RLS+PostgREST is the backend) · Next.js SSR (authed app, no SEO) · Redux/Zustand for server state (Query cache is the store) · GraphQL (one table) · Prisma/Drizzle day one (Supabase SQL migrations suffice) · ltree/closure tables/nested sets (premature) · local-first sync engines (sync is the hardest problem in software; one user, two devices) · Fly.io/Railway/Render (no/trial-only free tier; cold starts).

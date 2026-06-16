---
name: create-chain
description: >-
  Create a new Hilka "thought chain" — a tree of thought/decision cards in the user's
  Hilka decision journal — and insert it into their account via the Hilka MCP server's
  create_chain tool. Use whenever the user wants to create, add, build, or "materialize"
  a chain, thought chain, chain of thoughts, tree of thoughts, decision tree, or a map of
  their thinking in Hilka — including phrasings like "make me a chain about X", "add a
  thought chain for my thinking on Y", or "turn these thoughts into a Hilka tree".
---

# Create a Hilka thought chain

Hilka is a personal decision-tree journal. A **chain** is a tree of one-idea-per-card
thoughts that maps how someone reasoned through something — the directions they're
exploring and, crucially, the ones they **decided against and why**. This skill turns a
rough idea ("a chain about whether to switch jobs") into a well-shaped chain inserted into
the user's own Hilka account.

This skill requires the **Hilka MCP server** to be connected (the `hilka` plugin bundles
it). You create the chain by calling its **`create_chain`** tool — never by writing SQL.

## Step 1 — Gather (ask only what's genuinely missing)

Read what the user gave you and fill the rest with sensible defaults. Ask a short, focused
question (1–3 max) only when something material is missing or ambiguous.

| Detail | Default |
|---|---|
| **Topic / the thinking to map** | *Required — if absent or too vague, ask what it should be about. Don't invent a topic.* |
| **Chain title** | Derive a short title from the topic; mention what you chose. |
| **Depth** | ~4 levels (hard cap 5). |
| **Max width** | ~5. **"Width N" = no single level holds more than N nodes** — the widest *level* of the tree, NOT children-per-node. |
| **Dropped branches** | Include 1–2 honest dead ends (status `dropped`) with condition-style reasons — they're the point of the journal. Skip only if the user says so. |
| **Voice** | The user's own, first-person and reflective (see below). |

## Step 2 — Voice

Chains are personal reflections, not documentation. Write **first-person, sincere,
reflective, plain**. Not corporate, not a listicle, no hype, no buzzwords.

- **Titles:** short, 2–7 words. A claim or a direction, not a sentence.
- **Descriptions:** 1–3 sentences of genuine reflection. Empty is fine when the title says it all.
- **Drop reasons:** one calm sentence naming the *condition/trade-off* that killed the
  branch — something worth re-reading later. Good: *"Easy distribution but weak retention."*
  Bad: *"Dumb idea."*

If the user has existing chains and you can see them, match their register.

## Step 3 — Design the tree (heuristics)

- **One thought per node.** If a card says "X, and also Y," split it.
- **Mind the level budget.** "Max width N" = widest level ≤ N. Push detail **down** the
  tree (depth/asymmetry), never **across** one level — a level with 12 cards is an
  unreadable horizontal scroll.
- **Dropped branches are the product.** Aim for 1–2 honest dead ends, each a **leaf** with
  a condition-style reason. A dropped node can never have children.
- **Broad where exploring, deep where committed.** Don't pad for symmetry.
- **Drop leaves, not subtrees.** To reject a direction with sub-ideas worth keeping, leave
  the parent live (`todo`) and drop the specific child paths.

Sketch the tree as an indented outline and, if it's large or you made non-trivial
assumptions, show it to the user before inserting.

## Step 4 — Insert via the `create_chain` tool

Call **`create_chain`** with:

- `title` — the root thought (2–7 words).
- `root_description` — 1–3 sentences on what they're trying to figure out (may be `""`).
- `nodes` — every thought below the root. Each node:
  - `key` — your arbitrary unique label (e.g. `"a"`, `"a1"`).
  - `parent_key` — another node's `key`, or `null` for a direct child of the root.
  - `title`, `description`.
  - `status` — `"todo"` (default) | `"doing"` | `"done"` | `"dropped"`.
  - `decline_reason` — required & non-blank **iff** `status` is `"dropped"`, else `null`.

Do **not** include the root in `nodes` (it's built from `title` + `root_description`), and
do not set ids, positions, or timestamps — the server owns those. The server validates the
tree and returns a clear error if a rule is broken (dropped node with children, a cycle, a
missing drop reason); fix the design and retry.

## Step 5 — Hand off

Tell the user it's live, show the tree shape (indented outline) and the drop reasons, and
remind them: open Hilka → pick the new chain → the **tree (canvas) view** is the prettiest.

## If the tool isn't available

If `create_chain` isn't connected, point the user to Hilka → **Connect your AI assistant**:
add the Hilka MCP server URL and log in (or paste a token). Then retry.

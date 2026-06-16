import { describe, expect, it } from 'vitest'
import { buildInsertRow, buildUpdatePatch, canSave } from '../../src/lib/mutations'
import type { TreeNode } from '../../src/lib/types'

const NOW = new Date('2026-06-12T10:00:00Z')

function node(over: Partial<TreeNode>): TreeNode {
  return {
    id: 'n1',
    user_id: 'u1',
    parent_id: null,
    title: 'a thought',
    description: '',
    status: 'todo',
    decline_reason: null,
    position: 1024,
    status_changed_at: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    children: [],
    xparents: [],
    xchildren: [],
    ...over,
  }
}

describe('canSave (D6 — the hero constraint)', () => {
  it('requires a title', () => {
    expect(canSave({ title: '  ', description: '', status: 'todo', decline_reason: '' })).toBe(false)
  })
  it('blocks dropped without a non-blank reason', () => {
    expect(canSave({ title: 'x', description: '', status: 'dropped', decline_reason: '  ' })).toBe(false)
    expect(canSave({ title: 'x', description: '', status: 'dropped', decline_reason: 'too risky' })).toBe(true)
  })
  it('allows the live statuses without a reason', () => {
    expect(canSave({ title: 'x', description: '', status: 'todo', decline_reason: '' })).toBe(true)
    expect(canSave({ title: 'x', description: '', status: 'doing', decline_reason: '' })).toBe(true)
    expect(canSave({ title: 'x', description: '', status: 'done', decline_reason: '' })).toBe(true)
  })
})

describe('buildInsertRow', () => {
  it('nulls decline_reason unless dropped', () => {
    const r = buildInsertRow(null, { title: 't', description: '', status: 'todo', decline_reason: 'stale' }, 1024, NOW)
    expect(r.decline_reason).toBeNull()
    expect(r.parent_id).toBeNull()
    expect(r.id).toMatch(/[0-9a-f-]{36}/)
  })
  it('keeps the reason when dropped', () => {
    const r = buildInsertRow('p1', { title: 't', description: '', status: 'dropped', decline_reason: ' why ' }, 2048, NOW)
    expect(r.decline_reason).toBe('why')
    expect(r.position).toBe(2048)
  })
})

describe('buildUpdatePatch — reopen flow (PLAN.md §3.2)', () => {
  it('prepends the old reason to the description on dropped → todo', () => {
    const n = node({ status: 'dropped', decline_reason: 'no liquidity yet', description: 'old notes' })
    const patch = buildUpdatePatch(n, { title: n.title, description: 'old notes', status: 'todo', decline_reason: 'no liquidity yet' }, NOW)
    expect(patch.description).toBe('[2026-06-12] Reopened. Was dropped: no liquidity yet\n\nold notes')
    expect(patch.status_changed_at).toBe(NOW.toISOString())
    // the column itself is preserved (one-directional CHECK, PLAN.md §4)
    expect('decline_reason' in patch).toBe(false)
  })
  it('does not prepend when staying dropped', () => {
    const n = node({ status: 'dropped', decline_reason: 'old reason' })
    const patch = buildUpdatePatch(n, { title: n.title, description: '', status: 'dropped', decline_reason: 'new reason' }, NOW)
    expect(patch.description).toBe('')
    expect(patch.decline_reason).toBe('new reason')
    expect('status_changed_at' in patch).toBe(false)
  })
  it('stamps status_changed_at only when status changes', () => {
    const n = node({ status: 'todo' })
    const same = buildUpdatePatch(n, { title: 'x', description: '', status: 'todo', decline_reason: '' }, NOW)
    expect('status_changed_at' in same).toBe(false)
    const changed = buildUpdatePatch(n, { title: 'x', description: '', status: 'dropped', decline_reason: 'no' }, NOW)
    expect(changed.status_changed_at).toBe(NOW.toISOString())
  })
})

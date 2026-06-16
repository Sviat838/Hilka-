import { useEffect, useRef, useState } from 'react'
import { canSave, type SheetData } from '../lib/mutations'
import { STATUS_META, STATUSES, type Status, type TreeNode } from '../lib/types'
import { LinkPicker } from './LinkPicker'

export type SheetMode = 'create-root' | 'create-child' | 'edit'

/** A node the editing node could link to / is already linked to, with its label. */
export interface LinkOption {
  id: string
  title: string
}

interface EditSheetProps {
  open: boolean
  mode: SheetMode
  initial: TreeNode | null
  parentTitle: string
  saving: boolean
  /** extra parents this node already hangs off of (cross-links) */
  linkParents?: LinkOption[]
  /** other nodes in the chain it could be linked under */
  linkTargets?: LinkOption[]
  onAddLink?: (parentId: string) => void
  onRemoveLink?: (parentId: string) => void
  onSave: (data: SheetData) => void
  onClose: () => void
}

export function EditSheet({
  open,
  mode,
  initial,
  parentTitle,
  saving,
  linkParents = [],
  linkTargets = [],
  onAddLink,
  onRemoveLink,
  onSave,
  onClose,
}: EditSheetProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<Status>('todo')
  const [reason, setReason] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTitle(initial ? initial.title : '')
      setDescription(initial ? initial.description : '')
      setStatus(initial ? initial.status : 'todo')
      setReason(initial?.decline_reason ?? '')
      setTimeout(() => titleRef.current?.focus(), 220)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id, mode])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const heading =
    mode === 'create-root' ? 'New thought chain' : mode === 'create-child' ? 'New thought' : 'Edit thought'
  const sub =
    mode === 'create-root'
      ? 'Start with the root thought — the big question or idea.'
      : mode === 'create-child' && parentTitle
        ? `Branching from “${parentTitle}”`
        : ''

  const data: SheetData = { title, description, status, decline_reason: reason }
  const saveable = canSave(data) && !saving // no double-submit while the insert is in flight
  const save = () => {
    if (saveable) onSave(data)
  }

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="sheet"
        role="dialog"
        aria-label={heading}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.repeat) save()
        }}
      >
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div>
            <h2 className="sheet-title">{heading}</h2>
            {sub ? <p className="sheet-sub">{sub}</p> : null}
          </div>
          <button className="icon-btn sheet-close" title="Close" onClick={onClose}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <label className="field">
          <span className="field-label">Title</span>
          <input
            ref={titleRef}
            className="field-input"
            type="text"
            value={title}
            placeholder="e.g. Create a startup in prediction markets"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.repeat) save()
            }}
          />
        </label>

        <label className="field">
          <span className="field-label">
            Description <em>optional</em>
          </span>
          <textarea
            className="field-input field-area"
            rows={3}
            value={description}
            placeholder="More details about this thought…"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="field">
          <span className="field-label">Status</span>
          <div className="seg">
            {STATUSES.map((s) => (
              <button
                key={s}
                className={'seg-btn ' + (status === s ? 'seg-on seg-' + s : '')}
                onClick={() => setStatus(s)}
              >
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
        </div>

        {status === 'dropped' && (
          <label className="field">
            <span className="field-label">Drop reason</span>
            <textarea
              className="field-input field-area"
              rows={2}
              value={reason}
              placeholder="Why are you dropping this path?"
              onChange={(e) => setReason(e.target.value)}
            />
            {!reason.trim() && (
              <p className="field-hint">A reason is required — it keeps your thinking even after you let go.</p>
            )}
          </label>
        )}

        {mode === 'edit' && (
          <div className="field">
            <span className="field-label">
              Also appears under <em>cross-links</em>
            </span>
            {linkParents.length > 0 && (
              <div className="link-chips">
                {linkParents.map((p) => (
                  <span className="link-chip" key={p.id}>
                    {p.title}
                    <button
                      type="button"
                      className="link-chip-x"
                      title="Remove cross-link"
                      onClick={() => onRemoveLink?.(p.id)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}
            {linkTargets.length > 0 ? (
              <LinkPicker options={linkTargets} onAdd={(id) => onAddLink?.(id)} />
            ) : (
              linkParents.length === 0 && (
                <p className="field-hint field-hint-muted">
                  No other thoughts in this chain to link to yet.
                </p>
              )
            )}
          </div>
        )}

        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className={'btn btn-primary' + (saveable ? '' : ' btn-disabled')} onClick={save}>
            {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

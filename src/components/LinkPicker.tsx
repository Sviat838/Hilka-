import { useMemo, useRef, useState } from 'react'
import type { LinkOption } from './EditSheet'

interface LinkPickerProps {
  options: LinkOption[]
  onAdd: (id: string) => void
}

/**
 * Searchable cross-link picker: type to filter the chain's other thoughts,
 * then click (or ↑/↓ + Enter) to add one as an extra parent. Replaces a plain
 * <select> so a long chain stays navigable. The results render in-flow below
 * the input — the edit sheet scrolls, so there's nothing to clip or overlay.
 */
export function LinkPicker({ options, onAdd }: LinkPickerProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.title.toLowerCase().includes(q)) : options
  }, [query, options])

  const pick = (id: string) => {
    onAdd(id)
    setQuery('')
    setActive(0)
    inputRef.current?.focus() // keep the picker open to add several in a row
  }

  return (
    <div className="link-search">
      <input
        ref={inputRef}
        className="field-input"
        type="text"
        value={query}
        placeholder="Search a thought to link…"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-autocomplete="list"
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((a) => Math.min(a + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter') {
            if (open && matches[active]) {
              e.preventDefault()
              pick(matches[active].id)
            }
          } else if (e.key === 'Escape' && open) {
            // close the dropdown first; don't let the sheet's Esc-to-close fire
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
          }
        }}
      />
      {open && matches.length > 0 && (
        <ul className="link-search-menu" role="listbox">
          {matches.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                className={'link-search-option' + (i === active ? ' is-active' : '')}
                // mousedown (not click) + preventDefault keeps input focus, so the
                // input's blur never races the selection
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(m.id)
                }}
                onMouseEnter={() => setActive(i)}
              >
                {m.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim() !== '' && matches.length === 0 && (
        <p className="field-hint field-hint-muted">No thoughts match “{query.trim()}”.</p>
      )}
    </div>
  )
}

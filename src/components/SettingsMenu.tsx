import { useEffect, useRef, useState } from 'react'
import type { TreeOrient } from '../lib/layout'

interface SettingsMenuProps {
  treeOrient: TreeOrient
  onTreeOrientChange: (o: TreeOrient) => void
}

/** Gear button in the canvas header → a small popover of view settings. */
export function SettingsMenu({ treeOrient, onTreeOrientChange }: SettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // close on outside press or Escape
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="settings-wrap" ref={ref}>
      <button
        className="back-btn settings-btn"
        title="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div className="settings-pop" role="menu" aria-label="Settings">
          <div className="settings-overline">Settings</div>
          <div className="settings-group">
            <span className="settings-label">Tree view</span>
            <div className="orient-seg" role="radiogroup" aria-label="Tree view orientation">
              <button
                className={'orient-btn' + (treeOrient === 'vertical' ? ' on' : '')}
                role="radio"
                aria-checked={treeOrient === 'vertical'}
                onClick={() => onTreeOrientChange('vertical')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="5" r="2.2" />
                  <circle cx="6" cy="19" r="2.2" />
                  <circle cx="18" cy="19" r="2.2" />
                  <path d="M12 7.2v3.3M12 10.5 7 16.8M12 10.5l5 6.3" />
                </svg>
                <span>Vertical</span>
              </button>
              <button
                className={'orient-btn' + (treeOrient === 'horizontal' ? ' on' : '')}
                role="radio"
                aria-checked={treeOrient === 'horizontal'}
                onClick={() => onTreeOrientChange('horizontal')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="5" cy="12" r="2.2" />
                  <circle cx="19" cy="6" r="2.2" />
                  <circle cx="19" cy="18" r="2.2" />
                  <path d="M7.2 12h3.3M10.5 12 16.8 7M10.5 12l6.3 5" />
                </svg>
                <span>Horizontal</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

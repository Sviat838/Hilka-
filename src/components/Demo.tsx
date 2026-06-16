/**
 * Public, editable /demo — reachable without an account (App routes here on the
 * /demo pathname, before the auth gate, just like /privacy). It renders the real
 * product (TreeCanvas / NodeCard / EditSheet) against an in-memory tree
 * (useDemoForest), so a stranger can branch, edit, drop and drag cards and feel
 * the mechanic — but nothing touches the database.
 *
 * The conversion engine is the IKEA effect: edits genuinely persist locally, so
 * once the visitor has invested effort the CTA reframes from "make one" to "keep
 * the one you just made". On sign-up we stash the edited tree (localStorage) and
 * useFirstRunSeed re-creates it inside their new account.
 */
import { useMemo, useState } from 'react'
import type { TreeOrient } from '../lib/layout'
import type { SheetData } from '../lib/mutations'
import { HANDOFF_KEY } from '../lib/seed'
import { useDemoForest } from '../hooks/useDemoForest'
import analytics from '../lib/analytics'
import { TreeCanvas } from './TreeCanvas'
import { ChainFeed } from './ChainFeed'
import { EditSheet, type SheetMode } from './EditSheet'

type ViewMode = 'tree' | 'feed'
type Sheet = { mode: 'create-child'; parentId: string } | { mode: 'edit'; nodeId: string } | null

const SIGNUP_HREF = '/?signup=1'

export function Demo() {
  const forest = useDemoForest()
  const { chain } = forest
  const [sheet, setSheet] = useState<Sheet>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('tree')
  // Phones are tall and narrow: a left-to-right (horizontal) tree reads far better
  // there than a wide vertical one. Desktop keeps the vertical layout. (A 0/unknown
  // width — e.g. measured mid-resize — falls back to the desktop default.)
  const [orient] = useState<TreeOrient>(() => {
    const w = window.innerWidth
    return w > 0 && w <= 720 ? 'horizontal' : 'vertical'
  })

  // Leaving the demo for sign-up — carry the edited tree across so their account
  // is created already holding it (loss-aversion: "don't lose what you just made").
  const goSignup = () => {
    if (forest.edited) {
      try {
        localStorage.setItem(HANDOFF_KEY, JSON.stringify(forest.rows))
      } catch {
        /* private mode / storage full — fall back to the default starter */
      }
    }
    analytics.track('Demo Signup Clicked', { edited: forest.edited })
    window.location.assign(SIGNUP_HREF)
  }

  const handleSave = (data: SheetData) => {
    if (!sheet) return
    if (sheet.mode === 'create-child') forest.createNode(sheet.parentId, data)
    else {
      const node = chain.nodes[sheet.nodeId]
      if (node) forest.updateNode(node, data)
    }
    setSheet(null)
  }

  const handleDelete = (id: string) => {
    const node = chain.nodes[id]
    if (node && confirm('Delete this thought?')) forest.deleteNode(node)
  }

  const sheetMode: SheetMode = sheet?.mode ?? 'edit'
  const editingNode = (sheet?.mode === 'edit' ? chain.nodes[sheet.nodeId] : null) ?? null
  const parentTitle = (sheet?.mode === 'create-child' ? chain.nodes[sheet.parentId]?.title : '') ?? ''

  const cta = useMemo(
    () =>
      forest.edited
        ? {
            text: 'You just branched and pruned this — and wrote down a real reason. That tree lives only in this browser tab.',
            button: 'Create a free account to keep it →',
          }
        : {
            text: "Live demo — edit anything: drop a branch, write its reason, drag cards around. Nothing's saved until you sign up.",
            button: 'Map your own decision — free',
          },
    [forest.edited],
  )

  return (
    <div className="app">
      <div className="canvas-page">
        <header className="canvas-head demo-head">
          <a className="demo-brand" href="/" title="Hilka">
            <span className="app-name">Hilka</span>
            <span className="demo-pill">live demo</span>
          </a>
          <div className="view-seg" role="tablist" aria-label="View mode">
            <button
              className={'vbtn' + (viewMode === 'tree' ? ' on' : '')}
              role="tab"
              aria-selected={viewMode === 'tree'}
              title="Tree view"
              onClick={() => setViewMode('tree')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="5" r="2.2" />
                <circle cx="6" cy="19" r="2.2" />
                <circle cx="18" cy="19" r="2.2" />
                <path d="M12 7.2v3.3M12 10.5 7 16.8M12 10.5l5 6.3" />
              </svg>
            </button>
            <button
              className={'vbtn' + (viewMode === 'feed' ? ' on' : '')}
              role="tab"
              aria-selected={viewMode === 'feed'}
              title="Chain view"
              onClick={() => setViewMode('feed')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="3.5" width="16" height="7" rx="2" />
                <rect x="4" y="13.5" width="16" height="7" rx="2" />
              </svg>
            </button>
          </div>
          <button className="btn btn-primary demo-head-cta" onClick={goSignup}>
            Map your own — free
          </button>
        </header>

        {viewMode === 'tree' ? (
          <TreeCanvas
            chain={chain}
            orient={orient}
            onEdit={(id) => setSheet({ mode: 'edit', nodeId: id })}
            onDelete={handleDelete}
            onAddChild={(id) => setSheet({ mode: 'create-child', parentId: id })}
            onMove={forest.moveNode}
          />
        ) : (
          <ChainFeed
            chain={chain}
            onEdit={(id) => setSheet({ mode: 'edit', nodeId: id })}
            onDelete={handleDelete}
            onAddChild={(id) => setSheet({ mode: 'create-child', parentId: id })}
            onMove={forest.moveNode}
          />
        )}

        <div className={'demo-cta-bar' + (forest.edited ? ' is-edited' : '')}>
          <p className="demo-cta-text">{cta.text}</p>
          <button className="btn btn-primary demo-cta-btn" onClick={goSignup}>
            {cta.button}
          </button>
        </div>
      </div>

      <EditSheet
        open={!!sheet}
        mode={sheetMode}
        initial={editingNode}
        parentTitle={parentTitle}
        saving={false}
        onSave={handleSave}
        onClose={() => setSheet(null)}
      />
    </div>
  )
}

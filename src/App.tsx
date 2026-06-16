import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { chainsToJson, chainsToMarkdown, download, today } from './lib/export'
import type { SheetData } from './lib/mutations'
import type { Chain, TreeNode } from './lib/types'
import type { TreeOrient } from './lib/layout'
import { countByStatus, descendantIds } from './lib/forest'
import analytics from './lib/analytics'
import {
  useAddLink,
  useChains,
  useCreateNode,
  useDeleteNode,
  useMoveNode,
  useRemoveLink,
  useUpdateNode,
} from './hooks/useForest'
import { useFirstRunSeed } from './hooks/useFirstRunSeed'
import { ChainFeed } from './components/ChainFeed'
import { ChainList } from './components/ChainList'
import { EditSheet, type SheetMode } from './components/EditSheet'
import { Login } from './components/Login'
import { Onboarding } from './components/Onboarding'
import { SettingsMenu } from './components/SettingsMenu'
import { TreeCanvas } from './components/TreeCanvas'
import { SiteFooter } from './components/SiteFooter'

// Off-critical-path screens — code-split so they don't ship in the initial bundle.
// The privacy page, OAuth-consent and password-reset are full-page routes a normal
// session never hits; the Connect modal opens only on demand. Each lazy chunk loads
// the first time its screen is shown; the UI is byte-identical once resolved.
const OAuthConsent = lazy(() => import('./components/OAuthConsent').then((m) => ({ default: m.OAuthConsent })))
const PrivacyPolicy = lazy(() => import('./components/PrivacyPolicy').then((m) => ({ default: m.PrivacyPolicy })))
const UpdatePassword = lazy(() => import('./components/UpdatePassword').then((m) => ({ default: m.UpdatePassword })))
const ConnectAssistant = lazy(() => import('./components/ConnectAssistant').then((m) => ({ default: m.ConnectAssistant })))
const Demo = lazy(() => import('./components/Demo').then((m) => ({ default: m.Demo })))

// Hilka ships two appearances: Warm (light, default) and Ink (dark).
type Theme = 'ink' | 'warm'
const THEMES: Theme[] = ['warm', 'ink']
// appearance picker options, ordered as the designer's segmented control (Ink, Warm)
const APPEARANCES: { id: Theme; label: string; swatch: string }[] = [
  { id: 'ink', label: 'Ink', swatch: '#14161b' },
  { id: 'warm', label: 'Warm', swatch: '#faf1e0' },
]
// keep the mobile browser chrome (status bar / address bar) in sync with the theme
const THEME_COLOR: Record<Theme, string> = {
  ink: '#14161b',
  warm: '#faf1e0',
}

type ViewMode = 'tree' | 'feed'

type Sheet =
  | { mode: 'create-root' }
  | { mode: 'create-child'; parentId: string }
  | { mode: 'edit'; nodeId: string }
  | null

function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  // true while the user is following a password-reset link and must set a new password
  const [recovering, setRecovering] = useState(false)
  const queryClient = useQueryClient()
  // guard so a 'Signed In' is counted once per app load (not on every event)
  const signedInTracked = useRef(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
      // returning user restored from storage → identify, but this is not a fresh
      // sign-in, so suppress the 'Signed In' that a restore may emit.
      if (data.session?.user) {
        analytics.identify(data.session.user.id)
        signedInTracked.current = true
      }
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (s?.user) analytics.identify(s.user.id)
      if (event === 'SIGNED_IN' && !signedInTracked.current) {
        signedInTracked.current = true
        // provider is 'email' for password, 'google' for OAuth — no PII
        analytics.track('Signed In', { method: s?.user?.app_metadata?.provider ?? 'unknown' })
      }
      if (event === 'SIGNED_OUT') {
        analytics.track('Signed Out')
        analytics.reset()
        signedInTracked.current = false
        // never serve one account's cached journal to the next sign-in
        queryClient.clear()
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [queryClient])
  return { session, ready, recovering, endRecovery: () => setRecovering(false) }
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('hilka-theme')
    // fall back to the default for any unknown / retired value (e.g. legacy 'paper'/'black')
    return THEMES.includes(stored as Theme) ? (stored as Theme) : 'warm'
  })
  useEffect(() => {
    document.body.dataset.theme = theme
    localStorage.setItem('hilka-theme', theme)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
  }, [theme])
  return { theme, setTheme }
}

// First-run onboarding: open the tour automatically the first time a user signs
// in, then remember it on their Supabase account (user_metadata) so it never
// auto-shows again — on any device. The Tour button re-opens it on demand.
function useOnboarding(session: Session) {
  const [open, setOpen] = useState(false)
  // bumped on each open and used as a React key so <Onboarding> remounts fresh —
  // its step starts at 0 with no stale-frame flash when the Tour is replayed
  // after having closed past the first step
  const [openId, setOpenId] = useState(0)
  const autoOpened = useRef(false)

  useEffect(() => {
    if (autoOpened.current) return
    if (!session.user.user_metadata?.hilka_onboarded) {
      autoOpened.current = true
      setOpen(true)
    }
  }, [session])

  const close = useCallback(() => {
    setOpen(false)
    // persist on first dismissal; a failed write just means it re-shows next
    // load, which is harmless
    if (!session.user.user_metadata?.hilka_onboarded) {
      void supabase.auth.updateUser({ data: { hilka_onboarded: true } }).catch(() => {})
    }
  }, [session])

  const replay = useCallback(() => {
    analytics.track('Tour Replayed')
    setOpenId((n) => n + 1)
    setOpen(true)
  }, [])

  return { open, openId, close, replay }
}

function CornerActions({
  chains,
  theme,
  onSetTheme,
  onReplayTour,
}: {
  chains: Chain[]
  theme: Theme
  onSetTheme: (t: Theme) => void
  onReplayTour: () => void
}) {
  const [connectOpen, setConnectOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // close the menu on outside press or Escape
  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const exportMarkdown = () => {
    analytics.track('Export Downloaded', { format: 'markdown', scope: 'all' })
    download(`hilka-${today()}.md`, chainsToMarkdown(chains), 'text/markdown')
    setMenuOpen(false)
  }
  const exportJson = () => {
    analytics.track('Export Downloaded', { format: 'json', scope: 'all' })
    download(`hilka-backup-${today()}.json`, chainsToJson(chains), 'application/json')
    setMenuOpen(false)
  }

  return (
    <div className="corner-actions">
      <button
        className="connect-pill"
        title="Connect your AI assistant"
        aria-label="Connect your AI assistant"
        onClick={() => {
          analytics.track('Assistant Connect Opened')
          setConnectOpen(true)
        }}
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
        <span>Connect AI</span>
      </button>
      {connectOpen && (
        <Suspense fallback={null}>
          <ConnectAssistant open onClose={() => setConnectOpen(false)} />
        </Suspense>
      )}

      <div className="menu-wrap" ref={menuRef}>
        <button
          className="menu-btn"
          title="Menu"
          aria-label="Menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        {menuOpen && (
          <div className="menu-pop" role="menu" aria-label="Menu">
            <div className="menu-overline">Export</div>
            <button className="menu-item" role="menuitem" onClick={exportMarkdown}>
              <svg className="menu-item-icon" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="m7 10 5 5 5-5" />
                <path d="M12 15V3" />
              </svg>
              <span className="menu-item-text">
                <span className="menu-item-title">Markdown</span>
                <span className="menu-item-sub">Readable outline (.md)</span>
              </span>
            </button>
            <button className="menu-item" role="menuitem" onClick={exportJson}>
              <svg className="menu-item-icon" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                <path d="M3 12a9 3 0 0 0 18 0" />
              </svg>
              <span className="menu-item-text">
                <span className="menu-item-title">JSON backup</span>
                <span className="menu-item-sub">Full data, re-importable (.json)</span>
              </span>
            </button>

            <div className="menu-sep" />

            <div className="menu-overline">Appearance</div>
            <div className="appearance-seg" role="radiogroup" aria-label="Appearance">
              {APPEARANCES.map((a) => (
                <button
                  key={a.id}
                  className={'appearance-btn' + (theme === a.id ? ' on' : '')}
                  role="radio"
                  aria-checked={theme === a.id}
                  onClick={() => {
                    if (theme !== a.id) analytics.track('Theme Changed', { theme: a.id })
                    onSetTheme(a.id)
                  }}
                >
                  <span className="appearance-swatch" style={{ background: a.swatch }} aria-hidden="true" />
                  <span>{a.label}</span>
                </button>
              ))}
            </div>

            <div className="menu-sep" />

            <button
              className="menu-item menu-item-compact"
              role="menuitem"
              onClick={() => {
                onReplayTour()
                setMenuOpen(false)
              }}
            >
              <svg className="menu-item-icon" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <path d="M12 17h.01" />
              </svg>
              <span className="menu-item-title">Take the tour</span>
            </button>
            <button
              className="menu-item menu-item-compact menu-item-danger"
              role="menuitem"
              onClick={() => supabase.auth.signOut()}
            >
              <svg className="menu-item-icon" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="m16 17 5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
              <span className="menu-item-title">Sign out</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const { session, ready, recovering, endRecovery } = useSession()
  const { theme, setTheme } = useTheme()

  // OAuth consent (an AI assistant connecting via Supabase's OAuth server) takes
  // priority — Supabase redirects here with ?authorization_id=… ; the screen
  // handles its own login state.
  const consentMode = useMemo(
    () =>
      window.location.pathname.startsWith('/oauth/consent') ||
      new URLSearchParams(window.location.search).has('authorization_id'),
    [],
  )
  const isPrivacy = useMemo(() => window.location.pathname.replace(/\/$/, '') === '/privacy', [])
  // Public, editable demo — reachable without an account (same SPA-fallback trick
  // as /privacy). Checked before the auth gate so a logged-out stranger sees it.
  const isDemo = useMemo(() => window.location.pathname.replace(/\/$/, '') === '/demo', [])

  // Screen views for the URL- and auth-gated full screens. The signed-in
  // workspace reports its own sub-screens (chain list vs canvas) from Workspace,
  // so the authenticated path is left null here to avoid double-counting.
  const screen = consentMode
    ? 'oauth_consent'
    : isPrivacy
      ? 'privacy'
      : isDemo
        ? 'demo'
        : recovering
          ? 'update_password'
          : ready && !session
            ? 'login'
            : null
  useEffect(() => {
    if (screen) analytics.page(screen)
  }, [screen])

  if (consentMode) {
    return (
      <div className="app">
        <Suspense fallback={null}>
          <OAuthConsent session={session} ready={ready} />
        </Suspense>
      </div>
    )
  }

  // Public privacy policy — reachable without a session, at a stable URL
  // (public/_redirects serves the SPA on /privacy). Checked before the auth
  // gates so it works whether or not someone is signed in.
  if (isPrivacy) {
    return (
      <div className="app">
        <Suspense fallback={null}>
          <PrivacyPolicy />
        </Suspense>
      </div>
    )
  }

  // Public editable demo — also before the auth gates, so it works logged out.
  if (isDemo) {
    return (
      <div className="app">
        <Suspense fallback={null}>
          <Demo />
        </Suspense>
      </div>
    )
  }

  if (!ready) return <div className="app" />
  // A reset link grants a session, so check recovery before the normal signed-in path.
  if (recovering) {
    return (
      <div className="app">
        <Suspense fallback={null}>
          <UpdatePassword onDone={endRecovery} />
        </Suspense>
      </div>
    )
  }
  if (!session) {
    return (
      <div className="app">
        <Login />
        <SiteFooter />
      </div>
    )
  }
  return <Workspace session={session} theme={theme} onSetTheme={setTheme} />
}

function Workspace({
  session,
  theme,
  onSetTheme,
}: {
  session: Session
  theme: Theme
  onSetTheme: (t: Theme) => void
}) {
  const onboarding = useOnboarding(session)
  const { data: chains, isLoading, error, refetch } = useChains()
  // First sign-in with no chains → seed a starter (or the tree they edited on the
  // public /demo before signing up). Idempotent; see useFirstRunSeed.
  const onSeeded = useCallback(() => void refetch(), [refetch])
  const seeding = useFirstRunSeed(session, chains, onSeeded)
  const [chainId, setChainId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    localStorage.getItem('hilka-view') === 'feed' ? 'feed' : 'tree',
  )
  useEffect(() => {
    localStorage.setItem('hilka-view', viewMode)
  }, [viewMode])
  const [treeOrient, setTreeOrient] = useState<TreeOrient>(() =>
    localStorage.getItem('hilka-tree-orient') === 'horizontal' ? 'horizontal' : 'vertical',
  )
  useEffect(() => {
    localStorage.setItem('hilka-tree-orient', treeOrient)
  }, [treeOrient])

  // screen views for the two workspace sub-screens (chain list ↔ canvas)
  useEffect(() => {
    analytics.page(chainId ? 'chain_canvas' : 'chain_list')
  }, [chainId])

  // opening the edit sheet — pairs with the save events ('Chain Created',
  // 'Node Created', 'Node Edited') and 'Edit Sheet Dismissed' to measure where
  // users abandon a create/edit. Ref-guarded to the closed→open edge so swapping
  // one open sheet for another (or StrictMode's double-invoke) can't re-count it.
  const sheetOpenRef = useRef(false)
  useEffect(() => {
    if (sheet && !sheetOpenRef.current) analytics.track('Edit Sheet Opened', { mode: sheet.mode })
    sheetOpenRef.current = !!sheet
  }, [sheet])

  const createNode = useCreateNode()
  const updateNode = useUpdateNode()
  const deleteNode = useDeleteNode()
  const moveNode = useMoveNode()
  const addLink = useAddLink()
  const removeLink = useRemoveLink()

  const chain = useMemo(
    () => (chainId && chains ? (chains.find((c) => c.rootId === chainId) ?? null) : null),
    [chains, chainId],
  )

  // a deleted chain (or stale id) drops you back to the list
  useEffect(() => {
    if (chainId && chains && !chains.find((c) => c.rootId === chainId)) setChainId(null)
  }, [chains, chainId])

  // if the node a sheet points at vanishes (deleted from another tab/device),
  // close the sheet instead of rendering against a hole
  const sheetTargetId =
    sheet?.mode === 'edit' ? sheet.nodeId : sheet?.mode === 'create-child' ? sheet.parentId : null
  useEffect(() => {
    if (sheetTargetId && chains && !(chain && chain.nodes[sheetTargetId])) setSheet(null)
  }, [chains, chain, sheetTargetId])

  if (isLoading) {
    return (
      <div className="app">
        <div className="center-note">Loading your chains…</div>
      </div>
    )
  }
  // first-run seed in flight — show a friendly note instead of a blank list flash
  if (seeding && (!chains || chains.length === 0)) {
    return (
      <div className="app">
        <div className="center-note">Planting your first thought chain…</div>
      </div>
    )
  }
  // full-screen error only when there is nothing to show — a failed background
  // refetch keeps the cached forest (and any open sheet) on screen
  if (!chains) {
    return (
      <div className="app">
        <div className="center-note">
          <span>
            Could not load your chains — {error instanceof Error ? error.message : 'unknown error'}.{' '}
            <button className="btn btn-ghost" onClick={() => refetch()}>
              Retry
            </button>
          </span>
        </div>
      </div>
    )
  }

  const fail = (e: unknown) => alert(e instanceof Error ? e.message : String(e))

  const handleSave = async (data: SheetData) => {
    if (!sheet) return
    try {
      if (sheet.mode === 'create-root') {
        const roots = chains.map((c) => c.nodes[c.rootId])
        const id = await createNode.mutateAsync({ parent: null, siblings: roots, data })
        analytics.track('Chain Created', {
          source: 'ui',
          node_count: 1,
          status: data.status,
          has_description: !!data.description.trim(),
        })
        setChainId(id)
      } else if (sheet.mode === 'create-child' && chain) {
        const parent = chain.nodes[sheet.parentId]
        if (!parent) {
          setSheet(null)
          return
        }
        const siblings = parent.children.map((cid) => chain.nodes[cid])
        await createNode.mutateAsync({ parent, siblings, data })
        analytics.track('Node Created', {
          source: 'ui',
          parent_status: parent.status,
          status: data.status,
          has_description: !!data.description.trim(),
        })
      } else if (sheet.mode === 'edit' && chain) {
        const node = chain.nodes[sheet.nodeId]
        if (!node) {
          setSheet(null)
          return
        }
        const isRoot = node.parent_id === null
        const statusChanged = node.status !== data.status
        await updateNode.mutateAsync({ node, data })
        analytics.track('Node Edited', {
          is_root: isRoot,
          status_changed: statusChanged,
          previous_status: node.status,
          new_status: data.status,
          // reopening a dropped branch is a distinct, high-intent action
          reopened: node.status === 'dropped' && data.status !== 'dropped',
          has_description: !!data.description.trim(),
        })
        // a root-title edit intentionally emits BOTH 'Node Edited' (is_root:true,
        // above) and 'Chain Renamed' — downstream metrics should expect the overlap
        if (isRoot && node.title !== data.title.trim()) analytics.track('Chain Renamed')
      }
      setSheet(null)
    } catch (e) {
      fail(e)
    }
  }

  const handleDelete = async (node: TreeNode) => {
    const isRoot = node.parent_id === null
    const msg = isRoot ? 'Delete this thought chain?' : 'Delete this thought?'
    if (!confirm(msg)) return
    try {
      await deleteNode.mutateAsync(node)
      if (isRoot) {
        analytics.track('Chain Deleted', {
          node_count: chain ? Object.keys(chain.nodes).length : undefined,
        })
        setChainId(null)
      } else {
        analytics.track('Node Deleted', { previous_status: node.status })
      }
    } catch (e) {
      fail(e)
    }
  }

  // a card was dropped onto another — computeMove (in the view) already resolved
  // the legal (parent, position); persist it as one single-row move
  const handleMove = async (nodeId: string, parentId: string | null, position: number) => {
    const oldParentId = chain?.nodes[nodeId]?.parent_id ?? null
    try {
      await moveNode.mutateAsync({ nodeId, parentId, position })
      analytics.track('Node Moved', {
        reparented: oldParentId !== parentId,
        reordered: oldParentId === parentId,
      })
    } catch (e) {
      fail(e)
    }
  }

  const sheetMode: SheetMode = sheet?.mode ?? 'edit'
  const editingNode = (sheet?.mode === 'edit' && chain ? chain.nodes[sheet.nodeId] : null) ?? null
  const parentTitle =
    (sheet?.mode === 'create-child' && chain ? chain.nodes[sheet.parentId]?.title : '') ?? ''
  const saving = createNode.isPending || updateNode.isPending

  const handleAddLink = async (parentId: string) => {
    if (!editingNode) return
    try {
      await addLink.mutateAsync({ parentId, childId: editingNode.id })
      analytics.track('Cross-Link Added')
    } catch (e) {
      fail(e)
    }
  }
  const handleRemoveLink = async (parentId: string) => {
    if (!editingNode) return
    try {
      await removeLink.mutateAsync({ parentId, childId: editingNode.id })
      analytics.track('Cross-Link Removed')
    } catch (e) {
      fail(e)
    }
  }

  // cross-link options for the editing node: its current extra parents, and the
  // legal candidates to add (same chain; not itself, its home parent, an existing
  // cross-parent, a dropped tombstone, or one of its own descendants → no cycle)
  const linkParents =
    editingNode && chain
      ? editingNode.xparents
          .map((id) => chain.nodes[id])
          .filter(Boolean)
          .map((n) => ({ id: n.id, title: n.title }))
      : []
  const linkTargets =
    editingNode && chain
      ? (() => {
          const banned = descendantIds(chain, editingNode.id)
          banned.add(editingNode.id)
          if (editingNode.parent_id) banned.add(editingNode.parent_id)
          editingNode.xparents.forEach((id) => banned.add(id))
          return Object.values(chain.nodes)
            .filter((n) => !banned.has(n.id) && n.status !== 'dropped')
            .map((n) => ({ id: n.id, title: n.title }))
        })()
      : []

  return (
    <div className="app">
      {!chain ? (
        <>
          <ChainList
            chains={chains}
            onOpen={(rootId) => {
              const c = chains.find((x) => x.rootId === rootId)
              if (c) {
                const { total, dropped } = countByStatus(c)
                analytics.track('Chain Opened', { node_count: total, dropped_count: dropped })
              }
              setChainId(rootId)
            }}
            onNew={() => {
              analytics.track('New Chain Started')
              setSheet({ mode: 'create-root' })
            }}
          />
          <CornerActions chains={chains} theme={theme} onSetTheme={onSetTheme} onReplayTour={onboarding.replay} />
          <SiteFooter />
        </>
      ) : (
        <div className="canvas-page">
          <header className="canvas-head">
            <button className="back-btn" onClick={() => setChainId(null)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
              <span>Chains</span>
            </button>
            <div className="canvas-head-title">{chain.nodes[chain.rootId].title}</div>
            <div className="view-seg" role="tablist" aria-label="View mode">
              <button
                className={'vbtn' + (viewMode === 'tree' ? ' on' : '')}
                role="tab"
                aria-selected={viewMode === 'tree'}
                title="Tree view"
                onClick={() => {
                  if (viewMode !== 'tree') analytics.track('View Mode Changed', { mode: 'tree' })
                  setViewMode('tree')
                }}
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
                onClick={() => {
                  if (viewMode !== 'feed') analytics.track('View Mode Changed', { mode: 'feed' })
                  setViewMode('feed')
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="3.5" width="16" height="7" rx="2" />
                  <rect x="4" y="13.5" width="16" height="7" rx="2" />
                </svg>
              </button>
            </div>
            <button
              className="back-btn"
              title="Export this chain as Markdown"
              onClick={() => {
                analytics.track('Export Downloaded', { format: 'markdown', scope: 'chain' })
                download(`hilka-${today()}.md`, chainsToMarkdown([chain]), 'text/markdown')
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="m7 10 5 5 5-5" />
                <path d="M12 15V3" />
              </svg>
              <span>Export</span>
            </button>
            <SettingsMenu
              treeOrient={treeOrient}
              onTreeOrientChange={(o) => {
                if (o !== treeOrient) analytics.track('Tree Orientation Changed', { orientation: o })
                setTreeOrient(o)
              }}
            />
          </header>
          {viewMode === 'tree' ? (
            <TreeCanvas
              chain={chain}
              orient={treeOrient}
              onEdit={(id) => setSheet({ mode: 'edit', nodeId: id })}
              onDelete={(id) => handleDelete(chain.nodes[id])}
              onAddChild={(id) => setSheet({ mode: 'create-child', parentId: id })}
              onMove={handleMove}
            />
          ) : (
            <ChainFeed
              chain={chain}
              onEdit={(id) => setSheet({ mode: 'edit', nodeId: id })}
              onDelete={(id) => handleDelete(chain.nodes[id])}
              onAddChild={(id) => setSheet({ mode: 'create-child', parentId: id })}
              onMove={handleMove}
            />
          )}
        </div>
      )}

      <EditSheet
        open={!!sheet}
        mode={sheetMode}
        initial={editingNode}
        parentTitle={parentTitle}
        saving={saving}
        linkParents={linkParents}
        linkTargets={linkTargets}
        onAddLink={handleAddLink}
        onRemoveLink={handleRemoveLink}
        onSave={handleSave}
        onClose={() => {
          // user dismissed without saving (Cancel / backdrop / Esc) — the save
          // path closes the sheet directly, so this fires only on abandonment
          if (sheet) analytics.track('Edit Sheet Dismissed', { mode: sheet.mode })
          setSheet(null)
        }}
      />

      <Onboarding key={onboarding.openId} open={onboarding.open} onClose={onboarding.close} />
    </div>
  )
}

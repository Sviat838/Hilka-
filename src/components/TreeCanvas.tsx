import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { layoutChain, NODE_W, type TreeOrient } from '../lib/layout'
import { ghostedIds } from '../lib/forest'
import { useCardDnD } from '../hooks/useCardDnD'
import type { Chain } from '../lib/types'
import { NodeCard } from './NodeCard'

const FALLBACK_H = 140
const MIN_K = 0.18
const MAX_K = 2.2

interface TreeCanvasProps {
  chain: Chain
  orient: TreeOrient
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onAddChild: (id: string) => void
  onMove: (nodeId: string, parentId: string | null, position: number) => void
}

interface View {
  x: number
  y: number
  k: number
}

export function TreeCanvas({ chain, orient, onEdit, onDelete, onAddChild, onMove }: TreeCanvasProps) {
  const horizontal = orient === 'horizontal'
  // sibling inserts run along the cross axis: side-by-side (h) in a vertical tree,
  // stacked (v) in a horizontal one
  const dnd = useCardDnD(chain, horizontal ? 'v' : 'h', onMove)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const [heights, setHeights] = useState<Record<string, number>>({})
  const nodeRefs = useRef<Record<string, HTMLElement | null>>({})
  // active pointers on the canvas background + the current gesture (1 finger = pan, 2 = pinch)
  const ptrs = useRef<Map<number, { x: number; y: number }>>(new Map())
  const gesture = useRef<
    | { mode: 'pan'; sx: number; sy: number; ox: number; oy: number }
    | { mode: 'pinch'; mx: number; my: number; dist: number; base: View }
    | null
  >(null)

  // Layout + ghost set are pure functions of the tree, orientation and measured
  // heights — NOT of `view`. Memoizing them means pan/zoom/drag frames (which only
  // bump `view`/drag state) reuse the same result instead of re-running the tidy-
  // tree recursion every frame. Output is identical to recomputing inline.
  const pos = useMemo(() => layoutChain(chain, { orientation: orient, heights }), [chain, orient, heights])
  const ghosted = useMemo(() => ghostedIds(chain), [chain])

  // measure card heights so connectors start at each card's bottom edge
  useLayoutEffect(() => {
    const h: Record<string, number> = {}
    let changed = false
    for (const id of Object.keys(nodeRefs.current)) {
      const el = nodeRefs.current[id]
      if (el) {
        h[id] = el.offsetHeight
        if (heights[id] !== el.offsetHeight) changed = true
      }
    }
    if (changed || Object.keys(h).length !== Object.keys(heights).length) setHeights(h)
  })

  const fit = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ids = Object.keys(pos)
    if (!ids.length) return
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    for (const id of ids) {
      const p = pos[id]
      minX = Math.min(minX, p.x - NODE_W / 2)
      maxX = Math.max(maxX, p.x + NODE_W / 2)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y + (heights[id] ?? FALLBACK_H) + 28)
    }
    const pad = 70
    const vw = wrap.clientWidth,
      vh = wrap.clientHeight
    const rawK = Math.min(1, (vw - pad * 2) / (maxX - minX), (vh - pad * 2) / (maxY - minY))
    // On a phone, shrinking a whole tree to fit makes every card illegible (a 13%
    // thumbnail). Keep a readable floor on narrow screens and, when the tree is too
    // big for it, anchor on the root — top for a vertical tree, left for a
    // horizontal one — so you start where the thinking starts and pan outward.
    // Desktop keeps the existing centred whole-tree fit (floor = 0).
    const floor = vw < 720 ? 0.7 : 0
    if (rawK >= floor) {
      setView({ k: rawK, x: vw / 2 - ((minX + maxX) / 2) * rawK, y: vh / 2 - ((minY + maxY) / 2) * rawK })
    } else {
      const k = floor
      const r = pos[chain.rootId] ?? { x: (minX + maxX) / 2, y: minY }
      const lead = 28
      setView({
        k,
        x: horizontal ? lead - minX * k : vw / 2 - r.x * k,
        y: horizontal ? vh / 2 - r.y * k : lead - minY * k,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, heights, orient])

  // Fit once — but only after EVERY node's height is measured AND the canvas has a
  // real on-screen size. A one-shot "fit on first heights" misfires when the wrap
  // gets its dimensions a frame after mount (e.g. a lazy-loaded route like /demo),
  // landing the tree tiny in a corner; a ResizeObserver closes that gap.
  const fittedOnce = useRef(false)
  useEffect(() => {
    if (fittedOnce.current) return
    const wrap = wrapRef.current
    if (!wrap) return
    const tryFit = () => {
      if (fittedOnce.current) return
      const ids = Object.keys(pos)
      if (!ids.length || !ids.every((id) => heights[id] != null)) return
      if (!wrap.clientWidth || !wrap.clientHeight) return
      fittedOnce.current = true
      fit()
    }
    tryFit()
    if (fittedOnce.current) return
    const ro = new ResizeObserver(tryFit)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [pos, heights, fit])

  // switching vertical↔horizontal reshapes the whole tree — re-fit to the new layout
  const prevOrient = useRef(orient)
  useEffect(() => {
    if (prevOrient.current !== orient) {
      prevOrient.current = orient
      fit()
    }
  }, [orient, fit])

  // wheel zoom toward cursor
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = wrap.getBoundingClientRect()
      const mx = e.clientX - rect.left,
        my = e.clientY - rect.top
      setView((v) => {
        const k = Math.min(MAX_K, Math.max(MIN_K, v.k * Math.exp(-e.deltaY * 0.0016)))
        const f = k / v.k
        return { k, x: mx - (mx - v.x) * f, y: my - (my - v.y) * f }
      })
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [])

  const zoomBy = (f: number) => {
    const wrap = wrapRef.current
    if (!wrap) return
    const mx = wrap.clientWidth / 2,
      my = wrap.clientHeight / 2
    setView((v) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * f))
      const ff = k / v.k
      return { k, x: mx - (mx - v.x) * ff, y: my - (my - v.y) * ff }
    })
  }

  // recompute a pinch baseline from whatever two pointers are currently down
  const pinchFrom = (): { mode: 'pinch'; mx: number; my: number; dist: number; base: View } | null => {
    const wrap = wrapRef.current
    if (!wrap || ptrs.current.size < 2) return null
    const rect = wrap.getBoundingClientRect()
    const [a, b] = [...ptrs.current.values()]
    return {
      mode: 'pinch',
      mx: (a.x + b.x) / 2 - rect.left,
      my: (a.y + b.y) / 2 - rect.top,
      dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      base: view,
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    // card presses (which stopPropagation) drive card drag, not canvas pan/zoom
    if (target.closest('.node-card') || target.closest('.canvas-controls')) return
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* no active pointer to capture — pan/pinch math still works */
    }
    if (ptrs.current.size >= 2) {
      gesture.current = pinchFrom()
    } else {
      gesture.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }
    }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ptrs.current.has(e.pointerId)) return
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    if (g.mode === 'pan') {
      // a card drag may have lifted on a second finger resting on a card — don't
      // also pan the world out from under it
      if (ptrs.current.size !== 1 || dnd.dragging) return
      // a mouseup lost to a gesture/OS takeover would leave us panning with no button
      if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
        gesture.current = null
        return
      }
      setView((v) => ({ ...v, x: g.ox + e.clientX - g.sx, y: g.oy + e.clientY - g.sy }))
    } else {
      const wrap = wrapRef.current
      if (!wrap || ptrs.current.size < 2) return
      const rect = wrap.getBoundingClientRect()
      const [a, b] = [...ptrs.current.values()]
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const cmx = (a.x + b.x) / 2 - rect.left
      const cmy = (a.y + b.y) / 2 - rect.top
      const k = Math.min(MAX_K, Math.max(MIN_K, g.base.k * (dist / g.dist)))
      const f = k / g.base.k
      // hold the world point under the start midpoint fixed, then follow the midpoint
      setView({ k, x: cmx - (g.mx - g.base.x) * f, y: cmy - (g.my - g.base.y) * f })
    }
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ptrs.current.delete(e.pointerId)) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    if (ptrs.current.size >= 2) {
      gesture.current = pinchFrom()
    } else if (ptrs.current.size === 1) {
      const [pt] = [...ptrs.current.values()]
      gesture.current = { mode: 'pan', sx: pt.x, sy: pt.y, ox: view.x, oy: view.y }
    } else {
      gesture.current = null
    }
  }

  // connectors + cross-links + svg bbox — all pure functions of the tree and the
  // memoized layout, so they too are rebuilt only when those change (not on pan/
  // zoom/drag frames). Identical arrays to computing them inline each render.
  const { edges, xedges, bb } = useMemo(() => {
    // vertical: parent bottom-center → child top-center;
    // horizontal: parent right-center → child left-center
    const anchor = (pId: string, cId: string) => {
      const p1 = pos[pId],
        p2 = pos[cId]
      if (!p1 || !p2) return null
      const h1 = heights[pId] ?? FALLBACK_H,
        h2 = heights[cId] ?? FALLBACK_H
      return {
        x1: horizontal ? p1.x + NODE_W / 2 : p1.x,
        y1: horizontal ? p1.y + h1 / 2 : p1.y + h1,
        x2: horizontal ? p2.x - NODE_W / 2 : p2.x,
        y2: horizontal ? p2.y + h2 / 2 : p2.y,
      }
    }

    const edges: { id: string; x1: number; y1: number; x2: number; y2: number; dropped: boolean }[] = []
    for (const n of Object.values(chain.nodes)) {
      for (const cId of n.children) {
        const a = anchor(n.id, cId)
        if (!a) continue
        edges.push({ id: n.id + '-' + cId, ...a, dropped: chain.nodes[cId].status === 'dropped' })
      }
    }

    // cross-links — dashed overlay edges (both endpoints must be in this chain)
    const xedges: { id: string; x1: number; y1: number; x2: number; y2: number }[] = []
    for (const n of Object.values(chain.nodes)) {
      for (const cId of n.xchildren) {
        if (!pos[cId]) continue
        const a = anchor(n.id, cId)
        if (!a) continue
        xedges.push({ id: 'x-' + n.id + '-' + cId, ...a })
      }
    }

    // svg bbox
    const bb = { minX: -200, maxX: 200, minY: -50, maxY: 400 }
    for (const id of Object.keys(pos)) {
      const p = pos[id]
      bb.minX = Math.min(bb.minX, p.x - NODE_W)
      bb.maxX = Math.max(bb.maxX, p.x + NODE_W)
      bb.minY = Math.min(bb.minY, p.y - 100)
      bb.maxY = Math.max(bb.maxY, p.y + 400)
    }
    return { edges, xedges, bb }
  }, [chain, pos, heights, horizontal])

  const edgePath = (e: { x1: number; y1: number; x2: number; y2: number }) => {
    if (horizontal) {
      const dx = Math.max(34, (e.x2 - e.x1) * 0.55)
      return `M${e.x1} ${e.y1} C ${e.x1 + dx} ${e.y1}, ${e.x2 - dx} ${e.y2}, ${e.x2} ${e.y2}`
    }
    const dy = Math.max(34, (e.y2 - e.y1) * 0.55)
    return `M${e.x1} ${e.y1} C ${e.x1} ${e.y1 + dy}, ${e.x2} ${e.y2 - dy}, ${e.x2} ${e.y2}`
  }

  return (
    <div
      className="canvas-wrap"
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className={'canvas-world' + (horizontal ? ' is-horizontal' : '')}
        style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.k})` }}
      >
        <svg
          className="edges"
          style={{ left: bb.minX, top: bb.minY, width: bb.maxX - bb.minX, height: bb.maxY - bb.minY }}
          viewBox={`${bb.minX} ${bb.minY} ${bb.maxX - bb.minX} ${bb.maxY - bb.minY}`}
        >
          <defs>
            <marker
              id="xlink-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" className="xlink-arrow-head" />
            </marker>
          </defs>
          {edges.map((e) => (
            <path key={e.id} d={edgePath(e)} className={'edge' + (e.dropped ? ' edge-dropped' : '')} />
          ))}
          {xedges.map((e) => (
            <path key={e.id} d={edgePath(e)} className="edge edge-xlink" markerEnd="url(#xlink-arrow)" />
          ))}
        </svg>
        {Object.keys(pos).map((id) => (
          <div
            key={id}
            className={'node-slot' + (ghosted.has(id) ? ' is-ghost' : '')}
            style={{ left: pos[id].x - NODE_W / 2, top: pos[id].y, width: NODE_W }}
            ref={(el) => {
              nodeRefs.current[id] = el ? (el.firstChild as HTMLElement) : null
            }}
          >
            <NodeCard
              node={chain.nodes[id]}
              isRoot={id === chain.rootId}
              dnd={dnd.cardProps(id)}
              {...dnd.stateFor(id)}
              onEdit={() => onEdit(id)}
              onDelete={() => onDelete(id)}
              onAddChild={() => onAddChild(id)}
            />
          </div>
        ))}
      </div>
      {dnd.overlay}
      <div className="canvas-controls">
        <button className="ctl-btn" title="Zoom in" onClick={() => zoomBy(1.25)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button className="ctl-btn" title="Zoom out" onClick={() => zoomBy(0.8)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button className="ctl-btn ctl-fit" title="Fit to view" onClick={fit}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </button>
        <div className="ctl-zoom">{Math.round(view.k * 100)}%</div>
      </div>
    </div>
  )
}

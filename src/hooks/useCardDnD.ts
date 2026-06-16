import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { computeMove, descendantIds } from '../lib/forest'
import { zoneFromEvent, type DropZone } from '../lib/drag'
import type { Chain } from '../lib/types'

/** props spread onto every draggable card */
export interface CardPointerProps {
  onPointerDown: (e: ReactPointerEvent) => void
  onPointerMove: (e: ReactPointerEvent) => void
  onPointerUp: (e: ReactPointerEvent) => void
  onPointerCancel: (e: ReactPointerEvent) => void
}

export interface CardDnD {
  /** spread onto the draggable card element */
  cardProps: (id: string) => CardPointerProps
  /** visual state for a card */
  stateFor: (id: string) => {
    dragging: boolean
    dropZone: DropZone | null
    dropInvalid: boolean
    inMovingSubtree: boolean
  }
  /** floating drag chip — render it once inside the view (it portals to <body>) */
  overlay: ReactNode
  /** true while a card is lifted — lets the canvas pause panning during a drag */
  dragging: boolean
}

interface Over {
  id: string
  zone: DropZone
  valid: boolean
}

interface Press {
  id: string
  el: HTMLElement
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  longPress: number | null
  dragging: boolean
}

const TOUCH_HOLD_MS = 380 // long-press before a card lifts on touch
const TOUCH_SLOP = 10 // px of movement that cancels a pending long-press (it's a scroll/pan)
const MOUSE_SLOP = 5 // px of movement before a mouse press becomes a drag

/**
 * Pointer-based drag-and-drop for cards, shared by both views and working on
 * mouse, pen and touch alike (the old native HTML5 DnD was dead on touch).
 *
 * - Mouse/pen: press a card and move past a small threshold to lift it.
 * - Touch: long-press a card to lift it; a quick swipe scrolls/pans instead.
 *   While a card is lifted, page scrolling is suppressed and a floating chip
 *   follows the finger.
 *
 * Dropping resolves to a (parent, position) move via the pure `computeMove`:
 * legal drops get a drop indicator and are accepted, illegal ones a rejected
 * indicator and are refused. The target under the pointer is found with
 * `document.elementFromPoint`, so this works on the scaled tree canvas too.
 * orientation: 'v' = feed (before/after = top/bottom), 'h' = tree (left/right).
 */
export function useCardDnD(
  chain: Chain,
  orientation: 'h' | 'v',
  onMove: (nodeId: string, parentId: string | null, position: number) => void,
): CardDnD {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [over, setOver] = useState<Over | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const press = useRef<Press | null>(null)

  // the grabbed node carries its whole subtree — dim it so the move's scope is visible
  const movingSubtree = draggingId ? descendantIds(chain, draggingId) : null

  // keep the freshest chain/onMove without rebinding every card's handlers
  const chainRef = useRef(chain)
  const moveRef = useRef(onMove)
  chainRef.current = chain
  moveRef.current = onMove
  // the active touchmove scroll-blocker. Attached SYNCHRONOUSLY in beginDrag (not
  // via a draggingId effect) so the first post-lift touchmove can't scroll the feed
  // a frame before it engages.
  const scrollBlock = useRef<((e: TouchEvent) => void) | null>(null)

  // while a card is lifted, suppress text selection (mouse drags); scroll is
  // blocked imperatively in beginDrag/endPress, see scrollBlock above.
  useEffect(() => {
    if (!draggingId) return
    const prevSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.userSelect = prevSelect
    }
  }, [draggingId])

  // an OS interruption (app switch, incoming call, multitasking gesture) can swallow
  // the pointerup/cancel for a pending press — never let a backgrounded page resume
  // and lift a phantom card with page scroll blocked.
  useEffect(() => {
    const abort = () => {
      const p = press.current
      if (!p && !scrollBlock.current) return
      if (p && p.longPress !== null) window.clearTimeout(p.longPress)
      if (scrollBlock.current) {
        document.removeEventListener('touchmove', scrollBlock.current)
        scrollBlock.current = null
      }
      press.current = null
      setDraggingId(null)
      setOver(null)
      setGhost(null)
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') abort()
    }
    window.addEventListener('blur', abort)
    window.addEventListener('pagehide', abort)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('blur', abort)
      window.removeEventListener('pagehide', abort)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const clearHold = (p: Press) => {
    if (p.longPress !== null) {
      window.clearTimeout(p.longPress)
      p.longPress = null
    }
  }

  // the post-drag pointerup fires a synthetic click — swallow it so a move
  // does not also open the editor
  const swallowNextClick = () => {
    const handler = (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
    }
    document.addEventListener('click', handler, { capture: true, once: true })
    window.setTimeout(() => document.removeEventListener('click', handler, true), 400)
  }

  const resolveTarget = useCallback(
    (x: number, y: number): { targetId: string; zone: DropZone; valid: boolean } | null => {
      const dragged = press.current?.id
      if (!dragged) return null
      const el = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>('.node-card[data-node-id]')
      const targetId = el?.dataset.nodeId
      if (!el || !targetId || targetId === dragged) return null
      const chainNow = chainRef.current
      const zone: DropZone =
        targetId === chainNow.rootId ? 'child' : zoneFromEvent(el.getBoundingClientRect(), x, y, orientation)
      const res = computeMove(chainNow, dragged, targetId, zone)
      return { targetId, zone, valid: !('error' in res) }
    },
    [orientation],
  )

  const beginDrag = (p: Press, x: number, y: number) => {
    p.dragging = true
    try {
      p.el.setPointerCapture(p.pointerId)
    } catch {
      /* pointer already released */
    }
    // block native scroll for the rest of the gesture, synchronously — pointer
    // capture alone does NOT stop touch scrolling, only touch-action/preventDefault do
    if (!scrollBlock.current) {
      const block = (ev: TouchEvent) => ev.preventDefault()
      document.addEventListener('touchmove', block, { passive: false })
      scrollBlock.current = block
    }
    setDraggingId(p.id)
    setGhost({ x, y })
    const t = resolveTarget(x, y)
    setOver(t ? { id: t.targetId, zone: t.zone, valid: t.valid } : null)
  }

  const endPress = () => {
    const p = press.current
    if (p) {
      clearHold(p)
      try {
        p.el.releasePointerCapture(p.pointerId)
      } catch {
        /* fine */
      }
    }
    if (scrollBlock.current) {
      document.removeEventListener('touchmove', scrollBlock.current)
      scrollBlock.current = null
    }
    press.current = null
    setDraggingId(null)
    setOver(null)
    setGhost(null)
  }

  const cardProps = (id: string): CardPointerProps => ({
    onPointerDown: (e) => {
      // ignore secondary mouse buttons; keep canvas pan from also seeing this
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.stopPropagation()
      const el = e.currentTarget as HTMLElement
      const p: Press = {
        id,
        el,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        startX: e.clientX,
        startY: e.clientY,
        longPress: null,
        dragging: false,
      }
      press.current = p
      if (e.pointerType === 'touch') {
        const x = e.clientX
        const y = e.clientY
        p.longPress = window.setTimeout(() => {
          if (press.current === p && !p.dragging) beginDrag(p, x, y)
        }, TOUCH_HOLD_MS)
      }
    },
    onPointerMove: (e) => {
      const p = press.current
      if (!p || p.pointerId !== e.pointerId) return
      if (!p.dragging) {
        const dist = Math.hypot(e.clientX - p.startX, e.clientY - p.startY)
        if (p.pointerType === 'touch') {
          // moved before the hold fired → it's a scroll/pan, let the browser have it
          if (dist > TOUCH_SLOP) {
            clearHold(p)
            press.current = null
          }
          return
        }
        if (dist < MOUSE_SLOP) return
        beginDrag(p, e.clientX, e.clientY)
        return
      }
      setGhost({ x: e.clientX, y: e.clientY })
      const t = resolveTarget(e.clientX, e.clientY)
      setOver(t ? { id: t.targetId, zone: t.zone, valid: t.valid } : null)
    },
    onPointerUp: (e) => {
      const p = press.current
      if (!p || p.pointerId !== e.pointerId) return
      if (p.dragging) {
        const t = resolveTarget(e.clientX, e.clientY)
        if (t?.valid) {
          const res = computeMove(chainRef.current, p.id, t.targetId, t.zone)
          if (!('error' in res)) moveRef.current(p.id, res.parentId, res.position)
        }
        // only the mouse/pen path emits a synthetic post-drag click to swallow; a
        // touch long-press-drag already suppresses the tap-click, so a global click
        // eater would just swallow the user's NEXT real tap on any element
        if (p.pointerType !== 'touch') swallowNextClick()
      }
      endPress()
    },
    onPointerCancel: (e) => {
      const p = press.current
      if (!p || p.pointerId !== e.pointerId) return
      endPress()
    },
  })

  const stateFor = (id: string) => ({
    dragging: draggingId === id,
    dropZone: over && over.id === id && over.valid ? over.zone : null,
    dropInvalid: !!over && over.id === id && !over.valid,
    inMovingSubtree: !!movingSubtree?.has(id),
  })

  const overlay =
    draggingId && ghost
      ? createPortal(
          createElement(
            'div',
            {
              className: 'drag-ghost',
              style: { left: ghost.x, top: ghost.y },
              'aria-hidden': true,
            },
            chain.nodes[draggingId]?.title ?? '',
          ),
          document.body,
        )
      : null

  return { cardProps, stateFor, overlay, dragging: !!draggingId }
}

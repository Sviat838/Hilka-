import { useCallback, useEffect, useRef, useState } from 'react'
import analytics from '../lib/analytics'

/* ---- animated demo stages ----
   Each stage is keyed by step in <Onboarding>, so it remounts (and replays its
   entrance animations) every time its step is shown. They are purely decorative
   illustrations built from the mini-card styles — never interactive. */

function DemoWelcome() {
  return (
    <div className="ob-stage">
      <div className="ob-mini ob-mini-root ob-pop" style={{ left: '50%', top: 14, animationDelay: '.05s' }}>
        <span className="ob-badge ob-b-todo">To do</span>
        <span className="ob-mini-title">Make myself better</span>
      </div>
      <svg className="ob-wires" viewBox="0 0 360 200" preserveAspectRatio="none">
        <path className="ob-wire ob-draw" style={{ animationDelay: '.45s' }} d="M180 70 C180 95, 96 95, 96 120" />
        <path className="ob-wire ob-draw" style={{ animationDelay: '.55s' }} d="M180 70 C180 95, 264 95, 264 120" />
      </svg>
      <div className="ob-mini ob-pop" style={{ left: '27%', top: 118, animationDelay: '.75s' }}>
        <span className="ob-badge ob-b-doing">Doing</span>
        <span className="ob-mini-title">Train focus</span>
      </div>
      <div className="ob-mini ob-pop" style={{ left: '73%', top: 118, animationDelay: '.9s' }}>
        <span className="ob-badge ob-b-todo">To do</span>
        <span className="ob-mini-title">Find a sport hobby</span>
      </div>
    </div>
  )
}

function DemoRoot() {
  return (
    <div className="ob-stage ob-stage-center">
      <div className="ob-mini ob-mini-root ob-pop" style={{ position: 'relative', left: 0, top: 0 }}>
        <span className="ob-badge ob-b-todo">To do</span>
        <span className="ob-type-wrap">
          <span className="ob-type">Make myself better</span>
          <i className="ob-caret" />
        </span>
      </div>
    </div>
  )
}

function DemoBranch() {
  return (
    <div className="ob-stage">
      <div className="ob-mini ob-mini-root" style={{ left: '50%', top: 18 }}>
        <span className="ob-badge ob-b-todo">To do</span>
        <span className="ob-mini-title">Make myself better</span>
        <span className="ob-plus ob-plus-demo">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
      </div>
      <svg className="ob-wires" viewBox="0 0 360 200" preserveAspectRatio="none">
        <path className="ob-wire ob-draw" style={{ animationDelay: '.95s' }} d="M180 78 C180 105, 180 105, 180 122" />
      </svg>
      <div className="ob-mini ob-pop" style={{ left: '50%', top: 120, animationDelay: '1.15s' }}>
        <span className="ob-badge ob-b-todo">To do</span>
        <span className="ob-mini-title">Train focus</span>
      </div>
    </div>
  )
}

function DemoDecide() {
  return (
    <div className="ob-stage ob-stage-center">
      <div className="ob-decide-row">
        <div className="ob-mini ob-pop" style={{ position: 'relative', left: 0, top: 0, animationDelay: '.1s' }}>
          <span className="ob-badge ob-b-done ob-badge-in" style={{ animationDelay: '.5s' }}>Done</span>
          <span className="ob-mini-title">Train focus</span>
          <span className="ob-mini-body">20-min daily deep-work blocks.</span>
        </div>
        <div className="ob-mini ob-mini-dropped ob-pop" style={{ position: 'relative', left: 0, top: 0, animationDelay: '.25s' }}>
          <span className="ob-badge ob-b-dropped ob-badge-in" style={{ animationDelay: '.7s' }}>Dropped</span>
          <span className="ob-mini-title ob-strike">Wake up at 5 AM</span>
          <span className="ob-mini-body ob-mini-reason">Why · wrecked my sleep, not sustainable.</span>
        </div>
      </div>
    </div>
  )
}

interface Step {
  demo: () => React.ReactElement
  title: string
  body: string
}

const OB_STEPS: Step[] = [
  {
    demo: DemoWelcome,
    title: 'Welcome to Hilka',
    body: 'Hilka turns messy thinking into a clear tree. Capture an idea, branch it into options, and keep a record of every decision you made along the way.',
  },
  {
    demo: DemoRoot,
    title: 'Plant a root thought',
    body: 'Every chain starts with one big question or idea. Create a new chain, give the root a title, and you’re off — this is the trunk everything grows from.',
  },
  {
    demo: DemoBranch,
    title: 'Branch your thinking',
    body: 'Hover any thought and tap the + below it to add a child. Keep branching to explore directions, sub-ideas, and the consequences of each path.',
  },
  {
    demo: DemoDecide,
    title: 'Decide & prune',
    body: 'Click a thought to set its status — To do, Doing, Done, or Dropped — to track where each idea stands. Dropped branches are kept (and locked) with your reason, so your thinking is never lost.',
  },
]

interface OnboardingProps {
  open: boolean
  onClose: () => void
}

/** First-run onboarding popup: a centered modal with a 4-step carousel of
 *  animated mini-demos teaching the core actions. Replayable from the Tour
 *  button. The host owns persistence (see useOnboarding in App). */
export function Onboarding({ open, onClose }: OnboardingProps) {
  const [step, setStep] = useState(0)
  const modalRef = useRef<HTMLDivElement>(null)
  // always-current step so the keydown / backdrop dismissers report the step the
  // user was actually on when they bailed
  const stepRef = useRef(0)
  stepRef.current = step

  const dismiss = useCallback(() => {
    analytics.track('Onboarding Dismissed', { step: stepRef.current + 1 })
    onClose()
  }, [onClose])
  const complete = useCallback(() => {
    analytics.track('Onboarding Completed')
    onClose()
  }, [onClose])

  // count a view each time the tour actually opens (auto first-run or replay).
  // Ref-guarded to the closed→open edge so StrictMode's double-invoke (and any
  // re-render while open) can't double-count, mirroring the autoOpened /
  // signedInTracked guards used elsewhere.
  const startedRef = useRef(false)
  useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true
      analytics.track('Onboarding Started')
    } else if (!open) {
      startedRef.current = false
    }
  }, [open])

  // reset to the first step whenever the modal (re)opens. The host also remounts
  // this component on each open (key={openId}) so step starts at 0 with no
  // stale-frame flash; this stays as a defensive no-op for that fresh mount.
  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  // ← / → move between steps, Esc closes
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
      else if (e.key === 'ArrowRight') setStep((s) => Math.min(OB_STEPS.length - 1, s + 1))
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismiss])

  // honor the aria-modal contract (mirrors EditSheet's focus-on-open): move
  // focus into the dialog on open, trap Tab inside it, and restore focus to the
  // trigger (the Tour button / whatever was focused) on close.
  useEffect(() => {
    if (!open) return
    const modal = modalRef.current
    if (!modal) return
    const prevFocus = document.activeElement as HTMLElement | null
    modal.focus()
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = Array.from(
        modal.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === modal)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    modal.addEventListener('keydown', onTab)
    return () => {
      modal.removeEventListener('keydown', onTab)
      prevFocus?.focus?.()
    }
  }, [open])

  if (!open) return null
  const s = OB_STEPS[step]
  const Demo = s.demo
  const last = step === OB_STEPS.length - 1

  return (
    <div
      className="ob-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss()
      }}
    >
      <div ref={modalRef} className="ob-modal" role="dialog" aria-modal="true" aria-label="Welcome to Hilka" tabIndex={-1}>
        <button className="ob-skip" onClick={dismiss}>
          Skip
        </button>
        <div className="ob-demo-frame">
          <Demo key={step} />
        </div>
        <div className="ob-content">
          <div className="ob-step-label">
            Step {step + 1} of {OB_STEPS.length}
          </div>
          <h2 className="ob-title">{s.title}</h2>
          <p className="ob-body">{s.body}</p>
        </div>
        <div className="ob-foot">
          <div className="ob-dots">
            {OB_STEPS.map((_, i) => (
              <button
                key={i}
                className={'ob-dot' + (i === step ? ' ob-dot-on' : '')}
                aria-label={'Go to step ' + (i + 1)}
                aria-current={i === step}
                onClick={() => setStep(i)}
              />
            ))}
          </div>
          <div className="ob-btns">
            {step > 0 && (
              <button className="btn btn-ghost" onClick={() => setStep((x) => x - 1)}>
                Back
              </button>
            )}
            {last ? (
              <button className="btn btn-primary" onClick={complete}>
                Get started
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => setStep((x) => x + 1)}>
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

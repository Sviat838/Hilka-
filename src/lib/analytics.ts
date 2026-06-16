/**
 * Product analytics — a thin, fail-safe wrapper over Mixpanel.
 *
 * Two hard rules this module exists to enforce:
 *
 *  1. It must NEVER throw or block the app. Unlike `src/lib/supabase.ts` (which
 *     throws at import when its env is missing — by design, the app can't run
 *     without a backend), analytics is *optional*: with no `VITE_MIXPANEL_TOKEN`
 *     it degrades to a complete no-op, and every call into the SDK is wrapped so
 *     a failure inside Mixpanel can never bubble into the UI.
 *
 *  2. It must never send personal or journal content. Users are identified only
 *     by their Supabase auth UUID; events carry structure (counts, statuses,
 *     enums, booleans) — never node titles, descriptions, decline reasons, or
 *     email addresses. The whole point of Hilka is private thinking; analytics
 *     measures *behaviour*, not *content*.
 *
 * The SDK is brought in with a dynamic `import()` inside `init()`, so when there
 * is no token (local dev, forks, Do-Not-Track) it is never fetched at runtime and
 * stays out of the initial bundle (it code-splits into its own lazy chunk). Events
 * fired before the SDK finishes loading are queued and flushed once it's ready.
 */

// Injected by Vite's `define` (see vite.config.ts) — the package.json version.
declare const __APP_VERSION__: string

type Mixpanel = typeof import('mixpanel-browser')['default']

const TOKEN = import.meta.env.VITE_MIXPANEL_TOKEN as string | undefined
// EU data residency / a self-hosted proxy. US ingestion is the SDK default, so
// leave this unset unless the Mixpanel project lives in the EU.
const API_HOST = import.meta.env.VITE_MIXPANEL_API_HOST as string | undefined
// We honour the browser's Do-Not-Track signal by default; a deployment can opt
// back in with VITE_MIXPANEL_IGNORE_DNT=true.
const IGNORE_DNT = import.meta.env.VITE_MIXPANEL_IGNORE_DNT === 'true'

/**
 * The full Hilka event vocabulary. Centralising it here (rather than passing raw
 * strings at call sites) keeps names consistent and typo-proof, and doubles as
 * living documentation of everything we measure.
 */
export type AnalyticsEvent =
  // lifecycle & identity / activation funnel
  | 'App Loaded'
  | 'Page Viewed'
  | 'Signed Up'
  | 'Signed In'
  | 'Signed Out'
  | 'Auth Failed'
  | 'Password Reset Requested'
  | 'Password Changed'
  // core usage — chains & nodes
  | 'New Chain Started'
  | 'Chain Created'
  | 'Chain Opened'
  | 'Chain Renamed'
  | 'Chain Deleted'
  | 'Node Created'
  | 'Node Edited'
  | 'Node Deleted'
  | 'Node Moved'
  | 'Cross-Link Added'
  | 'Cross-Link Removed'
  // micro-abandonment (the edit sheet: opened vs saved vs dismissed)
  | 'Edit Sheet Opened'
  | 'Edit Sheet Dismissed'
  // preferences & exports
  | 'View Mode Changed'
  | 'Tree Orientation Changed'
  | 'Theme Changed'
  | 'Export Downloaded'
  // onboarding funnel
  | 'Onboarding Started'
  | 'Onboarding Completed'
  | 'Onboarding Dismissed'
  | 'Tour Replayed'
  // public demo → signup funnel + first-run seeding
  | 'Demo Edited'
  | 'Demo Signup Clicked'
  | 'Starter Chain Seeded'
  // AI / MCP adoption funnel
  | 'Assistant Connect Opened'
  | 'Access Token Created'
  | 'Access Token Revoked'
  | 'OAuth Consent Shown'
  | 'OAuth Consent Approved'
  | 'OAuth Consent Denied'

type Props = Record<string, string | number | boolean | null | undefined>

let mp: Mixpanel | null = null
let enabled = false
// the boot sequence runs at most once, ever — even after a failed dynamic import
// (a CSP/ad-block failure stays terminal rather than retrying on a defensive re-call)
let booted = false
// calls made before the dynamic import resolves; bounded so a stuck load can't
// grow this without limit.
let pending: Array<(m: Mixpanel) => void> = []
const MAX_PENDING = 100

/** Run `fn` against the live SDK, or queue it — but only while analytics is on. */
function run(fn: (m: Mixpanel) => void): void {
  if (!enabled) return
  if (mp) {
    try {
      fn(mp)
    } catch {
      /* analytics must never break the app */
    }
    return
  }
  if (pending.length < MAX_PENDING) pending.push(fn)
}

/** The browser's Do-Not-Track preference, across the various spellings. */
function doNotTrack(): boolean {
  if (IGNORE_DNT) return false
  const w = window as unknown as { doNotTrack?: string }
  const n = navigator as unknown as { doNotTrack?: string; msDoNotTrack?: string }
  const v = n.doNotTrack ?? w.doNotTrack ?? n.msDoNotTrack
  return v === '1' || v === 'yes'
}

/** Boot Mixpanel once. Safe (and a no-op) to call when there's no token. */
export function init(): void {
  if (booted) return // idempotent + terminal: boot once, never retry (even after failure)
  if (!TOKEN) return // no token → analytics is permanently off
  if (doNotTrack()) return // respect the user's Do-Not-Track signal
  booted = true
  enabled = true
  import('mixpanel-browser')
    .then(({ default: mixpanel }) => {
      const config: Parameters<Mixpanel['init']>[1] = {
        persistence: 'localStorage', // no third-party tracking cookies
        track_pageview: false, // an SPA has no real navigations; we send them ourselves
        batch_requests: true,
        ignore_dnt: IGNORE_DNT,
      }
      if (API_HOST) config.api_host = API_HOST
      mixpanel.init(TOKEN, config)
      // super-properties attached to every event: which surface (web vs the
      // future server-side MCP channel) and which release produced it.
      mixpanel.register({
        app: 'web',
        app_version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
      })
      mp = mixpanel
      const queued = pending
      pending = []
      for (const fn of queued) {
        try {
          fn(mixpanel)
        } catch {
          /* ignore */
        }
      }
    })
    .catch(() => {
      // SDK blocked (CSP, ad-blocker, offline) — stay a silent no-op.
      enabled = false
      pending = []
    })
}

/** Drop undefined props so Mixpanel doesn't record empty keys. */
function clean(props?: Props): Record<string, unknown> | undefined {
  if (!props) return undefined
  const out: Record<string, unknown> = {}
  for (const key in props) {
    const v = props[key]
    if (v !== undefined) out[key] = v
  }
  return out
}

/** Record an event. Never include titles, descriptions, reasons, or emails. */
export function track(event: AnalyticsEvent, props?: Props): void {
  run((m) => m.track(event, clean(props)))
}

/** Convenience wrapper for the page/screen-view event. */
export function page(screen: string, props?: Props): void {
  track('Page Viewed', { screen, ...props })
}

/** Tie subsequent events to a user, keyed only by their Supabase auth UUID. */
export function identify(userId: string): void {
  run((m) => m.identify(userId))
}

/** Forget the current identity (call on sign-out). */
export function reset(): void {
  run((m) => m.reset())
}

export const analytics = { init, track, page, identify, reset }
export default analytics

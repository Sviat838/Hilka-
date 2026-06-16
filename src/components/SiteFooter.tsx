/**
 * Small app-wide footer. Its main job is to keep the public Privacy Policy one
 * click away from the places people land — the sign-in screen (reachable while
 * logged out) and the chains list. Plain anchors, full reload through the SPA
 * fallback, so no router is needed.
 */
export function SiteFooter() {
  return (
    <footer className="site-foot">
      <a href="/demo">Live demo</a>
      <span aria-hidden="true">·</span>
      <a href="/privacy">Privacy</a>
      <span aria-hidden="true">·</span>
      <a href="https://github.com/Sviat838/Hilka-" target="_blank" rel="noopener noreferrer">
        Source
      </a>
    </footer>
  )
}

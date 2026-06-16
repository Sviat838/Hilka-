/**
 * Branding for the MCP server: the Hilka tree glyph (same asset the web app uses
 * as its favicon — public/favicon.svg, served at https://hilka.pages.dev).
 *
 * Two delivery paths, because MCP clients disagree on where they look:
 *  1. `SERVER_ICONS` goes in the `initialize` response's `serverInfo.icons`
 *     (MCP spec SEP-973). This is the correct, future-proof way; clients that
 *     support it (and Claude, once anthropics/claude-ai-mcp#152 ships) show it.
 *  2. `serveFavicon` answers `/favicon.svg|.ico|.png` on the Worker origin, for
 *     clients that fall back to fetching a domain favicon.
 *
 * The data-URI SVG is self-contained (no external fetch/CORS); the hosted PNG is
 * a raster fallback for clients that don't render SVG.
 */

// public/favicon.svg verbatim (forest-green tile + cream branching-tree glyph).
const ICON_SVG = `<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Hilka — a branching thought tree">
  <rect width="100" height="100" rx="24" fill="#3a5a40"/>
  <g stroke="#fbf8f2" stroke-width="7" stroke-linecap="round" fill="none">
    <path d="M50 28 L28 71"/>
    <path d="M50 28 L72 71"/>
  </g>
  <g fill="#fbf8f2">
    <circle cx="50" cy="28" r="11"/>
    <circle cx="28" cy="71" r="10"/>
    <circle cx="72" cy="71" r="10"/>
  </g>
</svg>
`

// Precomputed base64 of ICON_SVG (kept static so we don't call btoa on the
// non-Latin1 em-dash at runtime). Regenerate with: base64 -i public/favicon.svg
const ICON_SVG_B64 =
  'PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJIaWxrYSDigJQgYSBicmFuY2hpbmcgdGhvdWdodCB0cmVlIj4KICA8IS0tIEZvcmVzdC1ncmVlbiB0aWxlLCBtYXRjaGluZyB0aGUgYXBwJ3MgcGFwZXItdGhlbWUgYWNjZW50ICgjM2E1YTQwKSAtLT4KICA8cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgcng9IjI0IiBmaWxsPSIjM2E1YTQwIi8+CiAgPCEtLSBCcmFuY2hpbmcgZGVjaXNpb24gdHJlZTogb25lIHJvb3QgYWJvdmUsIHR3byBjaGlsZHJlbiBiZWxvdy4KICAgICAgIE1pcnJvcnMgdGhlIGluLWFwcCBUcmVlLXZpZXcgZ2x5cGguIENyZWFtIG9uIGdyZWVuLiAtLT4KICA8ZyBzdHJva2U9IiNmYmY4ZjIiIHN0cm9rZS13aWR0aD0iNyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBmaWxsPSJub25lIj4KICAgIDxwYXRoIGQ9Ik01MCAyOCBMMjggNzEiLz4KICAgIDxwYXRoIGQ9Ik01MCAyOCBMNzIgNzEiLz4KICA8L2c+CiAgPGcgZmlsbD0iI2ZiZjhmMiI+CiAgICA8Y2lyY2xlIGN4PSI1MCIgY3k9IjI4IiByPSIxMSIvPgogICAgPGNpcmNsZSBjeD0iMjgiIGN5PSI3MSIgcj0iMTAiLz4KICAgIDxjaXJjbGUgY3g9IjcyIiBjeT0iNzEiIHI9IjEwIi8+CiAgPC9nPgo8L3N2Zz4K'

const ICON_DATA_URI = `data:image/svg+xml;base64,${ICON_SVG_B64}`

/** Icons advertised in `serverInfo.icons` (MCP spec). SVG first (scales to any
 *  size, self-contained), then a hosted PNG raster fallback. */
export const SERVER_ICONS = [
  { src: ICON_DATA_URI, mimeType: 'image/svg+xml', sizes: ['any'] },
  { src: 'https://hilka.pages.dev/apple-touch-icon.png', mimeType: 'image/png', sizes: ['180x180'] },
] as const

const SVG_HEADERS = {
  'content-type': 'image/svg+xml; charset=utf-8',
  'cache-control': 'public, max-age=86400',
}

/**
 * Favicon fallback for clients that fetch a domain favicon instead of reading
 * serverInfo.icons. Returns a Response for the favicon paths, or null otherwise.
 */
export function serveFavicon(pathname: string, cors: Record<string, string>): Response | null {
  if (pathname === '/favicon.svg') {
    return new Response(ICON_SVG, { status: 200, headers: { ...SVG_HEADERS, ...cors } })
  }
  // .ico / .png: hand off to the hosted brand assets on the Pages app.
  if (pathname === '/favicon.ico') {
    return Response.redirect('https://hilka.pages.dev/favicon.ico', 302)
  }
  if (pathname === '/favicon.png' || pathname === '/apple-touch-icon.png') {
    return Response.redirect('https://hilka.pages.dev/apple-touch-icon.png', 302)
  }
  return null
}

import type { Chain, TreeNode } from './types'

/**
 * Markdown export (D8) — abandonment insurance. Indented bullets, readable
 * forever, pastes straight into Obsidian.
 */
export function chainsToMarkdown(chains: Chain[]): string {
  const lines: string[] = []
  // reasons come from a textarea — flatten newlines or they split the bullet line
  const flat = (s: string) => s.trim().replace(/\s*\n+\s*/g, ' ')
  const marker = (n: TreeNode): string =>
    n.status === 'dropped' ? ` ~~[dropped: ${flat(n.decline_reason ?? '')}]~~` : ''
  for (const chain of chains) {
    // cross-link note: the other parents this thought also hangs off of
    const xlinkNote = (n: TreeNode): string => {
      const names = n.xparents.map((id) => chain.nodes[id]?.title).filter(Boolean)
      return names.length ? ` ↗ _also under: ${names.join(', ')}_` : ''
    }
    const walk = (id: string, depth: number) => {
      const n = chain.nodes[id]
      const indent = '  '.repeat(depth)
      const title = n.status === 'dropped' ? `~~${n.title}~~` : n.title
      lines.push(`${indent}- ${title}${marker(n)}${xlinkNote(n)}`)
      const desc = n.description.trim()
      if (desc) {
        for (const dl of desc.split('\n')) lines.push(`${indent}  ${dl.trim() ? `_${dl.trim()}_` : ''}`.trimEnd())
      }
      n.children.forEach((c) => walk(c, depth + 1))
    }
    lines.push(`# ${chain.nodes[chain.rootId].title}`, '')
    walk(chain.rootId, 0)
    lines.push('')
  }
  return lines.join('\n')
}

export function chainsToJson(chains: Chain[]): string {
  // strip client-only assembly fields — the backup mirrors the `nodes` table rows
  const rows = chains.flatMap((c) =>
    Object.values(c.nodes).map(({ children: _c, xparents: _xp, xchildren: _xc, ...row }) => row),
  )
  return JSON.stringify(rows, null, 2)
}

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // revoking synchronously races the async blob fetch (Safari yields empty
  // downloads) — defer it past the navigation
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const today = () => new Date().toISOString().slice(0, 10)

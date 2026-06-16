import { countByStatus } from '../lib/forest'
import type { Chain } from '../lib/types'

interface ChainListProps {
  chains: Chain[]
  onOpen: (rootId: string) => void
  onNew: () => void
}

export function ChainList({ chains, onOpen, onNew }: ChainListProps) {
  return (
    <div className="list-page">
      <header className="list-head">
        <h1 className="app-name">Hilka</h1>
        <p className="app-tag">Log your thinking, step by step.</p>
      </header>
      <div className="chain-list">
        {chains.map((c) => {
          const root = c.nodes[c.rootId]
          const { total, dropped } = countByStatus(c)
          const meta = [
            `${total} thought${total === 1 ? '' : 's'}`,
            dropped ? `${dropped} dropped` : '',
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <button key={c.rootId} className="chain-row" onClick={() => onOpen(c.rootId)}>
              <div className="chain-row-main">
                <span className="chain-row-title">{root.title}</span>
                <span className="chain-row-meta">{meta}</span>
              </div>
              <svg className="chain-row-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          )
        })}
        <button className="chain-row chain-row-new" onClick={onNew}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>New thought chain</span>
        </button>
      </div>
    </div>
  )
}

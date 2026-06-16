/**
 * ConnectGuide — the top of the "Connect your AI assistant" modal: copy the
 * Hilka MCP server URL (step 1), pick your tool and follow short, plain steps to
 * add it (step 2), then a tool-independent "just ask" section with example
 * prompts so it's clear what to actually DO once connected (step 3). This is the
 * primary, no-token path; the PAT section below it in ConnectAssistant stays as
 * the fallback.
 *
 * Reuses CopyButton from ConnectAssistant and the MCP_URL constant from
 * ../lib/pat. Steps are kept short and worded for non-technical users; the bold
 * labels mirror each tool's current setup UI (verified mid-2026). If a vendor
 * renames a menu, update the bold labels here only.
 */
import type { ReactNode } from 'react'
import { useState } from 'react'
import { MCP_URL } from '../lib/pat'
import { CopyButton } from './ConnectAssistant'

type Guide = {
  id: string
  label: string
  sub: string
  steps: ReactNode[]
  /** show a copyable command box under the steps */
  cmd?: boolean
  /** the command text for the box (required when cmd is true) */
  cmdText?: string
}

const GUIDES: Guide[] = [
  {
    id: 'claude',
    label: 'Claude',
    sub: 'claude.ai or the Claude desktop app',
    steps: [
      <>Open <b>Customize → Connectors</b>, click the <b>+</b>, then <b>Add custom connector</b>.</>,
      <>Name it <b>Hilka</b>, paste the server URL above, and click <b>Add</b>.</>,
      <>In any chat, click the <b>+</b> button (lower-left) → <b>Connectors</b>, and switch on <b>Hilka</b>. Log in to Hilka if it asks.</>,
      <>Now just say: <i>“Make me a Hilka chain about …”</i></>,
    ],
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    sub: 'the terminal coding assistant',
    cmd: true,
    cmdText: `claude mcp add --transport http hilka ${MCP_URL}`,
    steps: [
      <>In your terminal, run the command below.</>,
      <>Start Claude Code, type <b>/mcp</b>, pick <b>hilka</b>, and choose <b>Authenticate</b>.</>,
      <>A browser window opens — <b>log in to Hilka</b> to authorize it.</>,
      <>Back in Claude Code, ask it to create or edit a chain.</>,
    ],
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    sub: 'requires a Plus, Pro, or Business plan',
    steps: [
      <>Go to <b>Settings → Apps &amp; Connectors → Advanced</b> and turn on <b>Developer mode</b>.</>,
      <>Back in <b>Apps &amp; Connectors</b>, click <b>Create</b> (or <b>Add custom connector</b>).</>,
      <>Name it <b>Hilka</b>, paste the server URL above, then <b>log in</b> when prompted.</>,
      <>In a new chat, click <b>+</b> → <b>More</b> → <b>Developer mode</b>, switch on <b>Hilka</b>, and ask it to build a chain.</>,
    ],
  },
  {
    id: 'other',
    label: 'Other apps',
    sub: 'Cursor, Codex, Windsurf, Zed, and more',
    cmd: true,
    cmdText: `npx mcp-remote ${MCP_URL}`,
    steps: [
      <>If the app accepts a remote MCP URL, paste the server URL above and log in.</>,
      <>Otherwise, add a new MCP server using the command below as its “command”.</>,
      <>Log in to Hilka when the browser opens, then ask the app to make a chain.</>,
    ],
  },
]

export function ConnectGuide() {
  const [tool, setTool] = useState('claude')
  const g = GUIDES.find((x) => x.id === tool) ?? GUIDES[0]

  return (
    <>
    <div className="ca-section">
      <span className="ca-section-label">1 · Copy your Hilka server URL</span>
      <div className="ca-code-row">
        <code className="ca-code">{MCP_URL}</code>
        <CopyButton value={MCP_URL} label="Copy URL" />
      </div>

      <span className="ca-section-label" style={{ marginTop: 18 }}>
        2 · Add it to your AI tool
      </span>
      <div className="ca-tools" role="tablist" aria-label="Choose your AI tool">
        {GUIDES.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={x.id === tool}
            className={'ca-tool' + (x.id === tool ? ' ca-tool-on' : '')}
            onClick={() => setTool(x.id)}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div className="ca-guide">
        <p className="ca-guide-sub">{g.sub}</p>
        <ol className="ca-steps">
          {g.steps.map((s, i) => (
            <li key={i} className="ca-step">
              <span className="ca-step-num">{i + 1}</span>
              <span className="ca-step-txt">{s}</span>
            </li>
          ))}
        </ol>
        {g.cmd && g.cmdText && (
          <div className="ca-code-row ca-guide-cmd">
            <code className="ca-code ca-code-cmd">{g.cmdText}</code>
            <CopyButton value={g.cmdText} label="Copy" />
          </div>
        )}
      </div>
    </div>

    <div className="ca-section">
      <span className="ca-section-label">3 · Use it — just ask</span>
      <p className="ca-use-lead">
        No commands to learn. Talk to your assistant in plain words and it builds or edits the
        tree in your account. For example:
      </p>
      <ul className="ca-use">
        <li>“Make me a Hilka chain about <i>whether to switch jobs</i>.”</li>
        <li>“What chains do I have in Hilka?”</li>
        <li>“Add a <i>relocation</i> branch to my switch-jobs chain.”</li>
        <li>“Drop the <i>freelance</i> branch — the pay’s too unstable.”</li>
      </ul>
      <p className="ca-use-foot">Then open Hilka to see your tree.</p>
    </div>
    </>
  )
}

/**
 * Public privacy policy — reachable at /privacy without signing in (App routes
 * to it on that pathname; public/_redirects gives the SPA fallback so the URL is
 * stable). Written to match how Hilka actually works — see
 * business_analysis/plugin-architecture.md and worker/. A complete, public
 * privacy policy is a hard requirement for the Anthropic Connectors Directory.
 *
 * Navigation is plain anchors (full reload through the SPA fallback) so the page
 * needs no client-side router — it mirrors the rest of this deliberately
 * router-free app.
 */
const CONTACT_EMAIL = 'sviatoslav.nahirnyi@gmail.com'
const REPO_URL = 'https://github.com/Sviat838/Hilka-'

export function PrivacyPolicy() {
  return (
    <div className="legal-page">
      <article className="legal-card">
        <a className="legal-back" href="/">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          <span>Back to Hilka</span>
        </a>

        <header className="legal-head">
          <h1 className="app-name">Privacy Policy</h1>
          <p className="legal-meta">Hilka — a personal decision-tree journal · Last updated 15 June 2026</p>
        </header>

        <div className="legal-body">
          <p>
            This policy explains what Hilka stores, where it lives, and what it does — and does
            not — do with your data. It is written to match how Hilka actually works. The whole
            app is open source, so you can verify every claim here against the code at{' '}
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">github.com/Sviat838/Hilka-</a>.
          </p>

          <h2>The short version</h2>
          <ul>
            <li>Your journal is yours. We don’t sell, rent, share, or advertise against it.</li>
            <li>
              Everything you write is scoped to your account by database row-level security — no
              other user can read it.
            </li>
            <li>You can export everything (Markdown + JSON) or delete it at any time.</li>
            <li>
              Privacy-respecting product analytics — anonymous usage events only, never your
              journal content — and we honour your browser’s Do Not Track signal. No ad networks.
            </li>
          </ul>

          <h2>What Hilka stores</h2>
          <p>
            <strong>Account &amp; sign-in.</strong> When you create an account, Supabase Auth
            stores your email address — and, if you choose “Continue with Google,” the basic
            profile Google returns (your email and account id). Passwords are handled and hashed
            by Supabase; Hilka never sees or stores your raw password.
          </p>
          <p>
            <strong>Your journal content.</strong> The “thought chains” you create: node titles
            and descriptions, statuses (todo / doing / done / dropped), the reason you record
            when you drop a branch, the tree structure and cross-links, and timestamps. This is
            the intimate part — whatever you choose to write about your decisions. It is stored
            in a Supabase (PostgreSQL) database.
          </p>
          <p>
            <strong>AI-assistant credentials</strong> — only if you connect one. See “Connecting
            an AI assistant” below.
          </p>
          <p>
            <strong>Local preferences.</strong> Your theme and view choices, plus your login
            session, are kept in your browser’s local storage on your own device — not held as a
            profile on our servers.
          </p>

          <h2>Where it’s stored and who can see it</h2>
          <p>
            Hilka’s front end is hosted on Cloudflare Pages; your data lives in Supabase
            (PostgreSQL + Auth). Every table is protected by PostgreSQL Row-Level Security: each
            query is constrained to the signed-in user’s own rows, so one account can never read
            or modify another’s journal. There is no admin “read everyone’s chains” feature.
          </p>

          <h2>Product analytics</h2>
          <p>
            To understand how Hilka is used — which features help and where people get stuck —
            we record anonymous product-analytics events through{' '}
            <a href="https://mixpanel.com" target="_blank" rel="noopener noreferrer">Mixpanel</a>.
            This is deliberately limited to <em>behaviour</em>, never <em>content</em>:
          </p>
          <ul>
            <li>
              Structural events only — for example: a chain was created, a node’s status changed,
              a view was switched, an export was downloaded — with counts and statuses, but{' '}
              <strong>never your node titles, descriptions, or the reasons you record</strong>.
            </li>
            <li>
              You are identified to Mixpanel only by your account id (an opaque UUID). We do not
              send your email address or name.
            </li>
            <li>
              Plus the standard technical context any analytics collects (approximate device and
              browser, page views). We don’t use advertising or cross-site tracking cookies;
              analytics identity is kept in your browser’s local storage.
            </li>
          </ul>
          <p>
            We honour your browser’s <strong>Do Not Track</strong> setting — switch it on and
            Hilka sends no analytics at all. The data is used only to improve Hilka, never sold or
            used for advertising. See{' '}
            <a href="https://mixpanel.com/legal/privacy-policy/" target="_blank" rel="noopener noreferrer">Mixpanel’s privacy policy</a>.
          </p>

          <h2>Connecting an AI assistant (MCP)</h2>
          <p>
            Hilka offers an optional remote MCP server — a stateless Cloudflare Worker — so you
            can ask an AI assistant (Claude, ChatGPT, and others) to build or edit chains in your
            own account. There are two ways to authorize it:
          </p>
          <ul>
            <li>
              <strong>OAuth login (default).</strong> Your assistant sends you through Supabase’s
              OAuth login and a consent screen. The worker never sees your password and does not
              persist your OAuth tokens — it is stateless and simply forwards the token you already
              hold to the database on each request, where your identity is resolved server-side.
            </li>
            <li>
              <strong>Personal Access Token (fallback).</strong> If you generate a token instead,
              only its SHA-256 hash is stored — never the token itself, which is shown to you once
              and never again. The worker hashes the token you send and matches it against that
              hash.
            </li>
          </ul>
          <p>
            The worker holds no privileged database key — no service-role key, no token-signing
            key. It can only ever act as you, on your own data; it cannot write into another
            account.
          </p>

          <h2>What we don’t do</h2>
          <ul>
            <li>We don’t sell, rent, or trade your data.</li>
            <li>
              We don’t share it with anyone except the infrastructure providers needed to run the
              service (listed below).
            </li>
            <li>
              We don’t run advertising or cross-site behavioural ad-tracking, and we don’t use
              advertising cookies. (We do use privacy-respecting product analytics — anonymous
              usage events only — described under “Product analytics” above.)
            </li>
          </ul>

          <h2>Service providers</h2>
          <p>Hilka relies on a small number of processors, used only to operate the service:</p>
          <ul>
            <li><strong>Supabase</strong> — database and authentication (stores your account and journal).</li>
            <li><strong>Cloudflare</strong> — hosting (Pages) and the MCP worker.</li>
            <li><strong>Google</strong> — only if you choose “Continue with Google” to sign in.</li>
            <li><strong>Mixpanel</strong> — anonymous product analytics (see “Product analytics”).</li>
          </ul>

          <h2>Exporting and deleting your data</h2>
          <ul>
            <li>
              <strong>Export.</strong> Any time, download your whole journal as Markdown
              (human-readable) or as a JSON backup (a faithful copy of your chains) from the in-app
              export buttons. No request needed.
            </li>
            <li>
              <strong>Delete individual items.</strong> Delete any thought or a whole chain from
              within the app; deletions are permanent.
            </li>
            <li>
              <strong>Delete your account.</strong> To erase your account and all associated data,
              email the address below and we’ll delete it. You can revoke any AI-assistant tokens
              yourself from <em>Connect your AI assistant</em> in the app.
            </li>
          </ul>

          <h2>Children</h2>
          <p>Hilka is not directed to children and is not intended for anyone under 16.</p>

          <h2>Changes to this policy</h2>
          <p>
            If this policy changes in a material way, we’ll update the date above. Because the app
            is open source, the full history of this page is visible in the public repository.
          </p>

          <h2>Contact</h2>
          <p>
            Questions, data requests, or account deletion:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </div>

        <footer className="legal-foot">
          <a href="/">← Back to Hilka</a>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">Source on GitHub</a>
        </footer>
      </article>
    </div>
  )
}

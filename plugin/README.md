# Hilka plugin for Claude

Create [Hilka](https://github.com/Sviat838/Hilka-) thought chains — trees of
one-idea-per-card thoughts — in your own Hilka decision journal, straight from Claude.

The plugin bundles two things:

- the **`hilka` MCP server** (the remote `create_chain` tool), and
- a **`create-chain` skill** that designs a well-shaped tree (depth over width, 1–2 honest
  "dropped" dead-ends, your own reflective voice) before inserting it.

## Install (Claude Code)

```
/plugin marketplace add Sviat838/Hilka-
/plugin install hilka@hilka
```

On first use Claude opens a browser to log in to Hilka and approve access (Supabase OAuth)
— no token to copy. Then just ask:

> make me a Hilka chain about whether to switch jobs

## Before publishing (owner)

Edit `plugin/.claude-plugin/plugin.json` and replace the placeholder
`https://hilka-mcp.YOUR-SUBDOMAIN.workers.dev/mcp` with your deployed Worker URL (see
[`worker/`](../worker) and [`business_analysis/plugin-architecture.md`](../business_analysis/plugin-architecture.md)).

## Other assistants

No plugin needed — add the same MCP server URL as a custom connector in Claude Desktop,
claude.ai, ChatGPT, or Cursor and log in. The skill is Claude-specific; elsewhere the
`create_chain` tool's own description guides the model.

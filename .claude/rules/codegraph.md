---
paths:
  - "**/*"
---

# Codegraph - use the code-intelligence index first (when available)

**Optional / opt-in.** This rule only applies when the **codegraph MCP server**
is connected. It is per-dev and NOT in the committed `.mcp.json`: a dev who
wants it installs the `codegraph` binary and registers the server at local
scope - `claude mcp add codegraph --scope local -- codegraph serve --mcp`
(stored privately in `~/.claude.json`, never committed). If the
`mcp__codegraph__*` tools are NOT in your tool list, ignore this entire rule
and use the normal `Read` / `Grep` / `Glob` tools - nothing here is required.
A quick `codegraph_status` call confirms the index is live if you are unsure.

When it IS connected: it is a SQLite knowledge graph of every symbol, edge, and
file in the workspace (50k+ nodes across Python, TypeScript, TSX, Go). Reads
are sub-millisecond; the index lags writes by about a second through a file
watcher. It is the pre-built search index for this codebase - reach for it
BEFORE a grep+read loop or a file-reading subagent, not as an afterthought.

## When to use it

Any "how does X work", "where is X", "what calls X", "what breaks if I change
X", or "trace the flow from X to Y" question. Also before writing or editing
code that touches existing symbols - confirm the call sites, signature, and
blast radius up front instead of discovering them mid-edit.

## Answer directly - do not delegate exploration

For architecture / trace / where-is-X questions, answer DIRECTLY using 2-3
codegraph calls. Codegraph already did the indexing work, so spawning a
separate file-reading subagent, or running your own grep+read sweep, repeats
it and costs more for the same answer. A direct codegraph answer is a handful
of calls; a grep/read exploration is dozens. Drop to raw `Read`/`Grep` only to
confirm a specific detail codegraph did not cover.

## Tool selection by intent

| Intent | Tool |
|---|---|
| "What is the symbol named X?" | `codegraph_search` |
| "What's the deal with this feature/area?" (PRIMARY) | `codegraph_context` |
| "How does X reach Y / trace the flow" | `codegraph_trace` |
| "What calls this?" | `codegraph_callers` |
| "What does this call?" | `codegraph_callees` |
| "What would changing this break?" | `codegraph_impact` |
| "Show this symbol's source/signature" | `codegraph_node` |
| "Survey several related symbols at once" | `codegraph_explore` |
| "What's in directory X?" | `codegraph_files` |
| "Is the index ready / how big?" | `codegraph_status` |

Common chain: `codegraph_context` first to map an area, then ONE
`codegraph_explore` for the source of the symbols it surfaced. For a path
question, `codegraph_trace` from->to is one call that follows dynamic-dispatch
hops (callbacks, React re-render, JSX children) that grep cannot.

## Subagents do not inherit this

When you spawn a subagent for code work, it does NOT auto-load this rule and
may not know codegraph exists. If the subagent needs to explore the codebase,
say so in its prompt - point it at the codegraph tools, or hand it the symbols
and file:line anchors you already resolved so it skips the lookup entirely.
This mirrors the subagent caveat in `comment-discipline.md`.

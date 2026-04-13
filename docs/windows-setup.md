# Windows Setup Notes

Known issues and workarounds for Windows 11 development with this plugin.

## Context7 — remote MCP, not local

**Problem:** Local npx Context7 triggers Claude Code Marketplace refresh
loop. All MCP servers can freeze.

**Fix:** Use remote mode in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```

If you need rate-limit bypass, add API key:

```json
"context7": {
  "type": "http",
  "url": "https://mcp.context7.com/mcp",
  "headers": { "CONTEXT7_API_KEY": "your-key" }
}
```

## psmux — Windows tmux for OMC parallel

OMC `team` / `ultrawork` skills use tmux for parallel worker coordination.
Windows needs `psmux`:

```powershell
cargo install psmux
```

Without it, OMC parallel execution falls back to sequential.

## Node path issues

If `node` alias is broken in Git Bash / WSL:

```json
"hooks": [
  { "type": "command", "command": "cmd /c node ./.claude/hooks/check-spec.mjs" }
]
```

## Line endings

Hooks normalize CRLF/LF via `replace(/\\/g, "/")` in file paths. No manual
action required.

Git warning `LF will be replaced by CRLF` is benign — gitattributes can
suppress with:

```
# .gitattributes
*.mjs text eol=lf
*.yaml text eol=lf
```

## Windows file locks

If `init.mjs` fails with EBUSY on an open editor file, close editor,
retry. Idempotent — safe to run multiple times.

## Claude-Mem — DO NOT INSTALL

HTTP :37777 port has no authentication. Any local process can read
observations, API keys, inject memories. ChromaDB integration has
subprocess leak (184 orphan procs in 19h reported). Use OMC `/wiki`
instead for cross-session memory.

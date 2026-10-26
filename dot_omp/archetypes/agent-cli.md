# Archetype: agentic CLI, MCP servers, and web harnesses

## Goal
Small, predictable tool surfaces that are cheap in tokens and safe to run unattended.

## Rules
- **Compact tool schemas.** Short names, one-line descriptions, minimal required
  params. Every schema token is paid on every turn.
- **Child process safety.** Every spawned process has a timeout and an
  AbortSignal. Forward SIGINT/SIGTERM, kill the whole process group on abort, and
  never leave orphans.
- **stdout discipline.** For stdio MCP servers stdout is the wire. Logs go to stderr.
- **OpenTelemetry.** Preserve span context across tool calls and child processes
  (propagate trace headers/env). Never drop or re-root an existing span.
- Return structured errors (code + message) instead of throwing raw stack traces
  at the model.

## Verification
```bash
npm run build && npm test
```

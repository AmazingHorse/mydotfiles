# ADR 0006: Hook-Based Cross-Harness Enforcement

## Status
Accepted (supersedes mirroring rationale in ADR 0003)

## Context
When orchestrating multi-agent workflows across **omp**, **Claude Code**, and **Devin CLI**, sharing security policies through bidirectional allowlist mirroring presented structural limits:
- **Asymmetric capabilities:** Hard checks (`bash -c`, command substitutions `$()`, `git -c`, workspace escapes, protected paths) have no equivalent declarative schema in Claude or Devin permission files. Mirroring allowlists across harnesses without hard check enforcement left Claude and Devin weaker than omp.
- **Rule inversion risk:** Mirroring complex declarative rules (`Read`, `Edit`, `Write`, `Fetch`, `mcp__*`) across schemas risked misinterpreting or misplacing non-prefix rules (e.g. converting a deny into an allow).
- **Disk write side effects:** Eager mirroring caused disk writes to committed repo files on routine permission checks.

## Decision
Transition `command-guard` from an eager file-mirroring sync to a **unified policy engine with native PreToolUse hooks**:
1. **Unified Hook (`hook.ts`):** Register `command-guard/hook.ts` as a `PreToolUse` hook in `~/.claude/settings.json` (automatically imported by Devin CLI). It intercepts tool calls (`Bash` for Claude, `exec` for Devin).
2. **Never-Approve Policy:** The hook enforces `deny` rules and hard security checks (`bash -c`, `$()`, `git -c`, workspace escapes, protected config). It never approves plain prefixes, allowing each harness's native rules and interactive prompts to govern standard approvals.
3. **Allowlist Mirroring as Pure Convenience:** Mirroring is restricted strictly to `allow` command prefixes in machine-local files (`.claude/settings.local.json`, `.devin/config.local.json`, `.omp/permissions.local.json`). Committed files (`project` scope) are strictly read-only.
4. **Verbatim Preservation:** Non-prefix rules (`Read`, `Edit`, `Write`, `Fetch`, `WebFetch`, `mcp__*`, tool names) remain verbatim in their native files and are never translated across harnesses.
5. **Keyword Guard:** Refuse to persist shell keywords or builtins (`continue`, `break`, `read`, `return`, `exit`, `local`, `export`, `set`, `true`, `false`, `:`).

## Consequences
- Single security boundary: A deny rule or hard check defined in `command-guard` protects omp, Claude Code, and Devin CLI equally.
- Zero risk of rule inversion or corrupted harness settings.
- Tracked as architectural debt in `docs/debt.md` until native upstream agent frameworks standardize cross-harness hook protocols.

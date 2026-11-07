# `command-guard` — Interactive Permission Shim & Cross-Harness Policy Engine

`command-guard` is an [omp](https://github.com/oh-my-pi/pi-coding-agent) extension that intercepts agent shell executions (`bash`) and file-mutation tools (`write`, `edit`, `ast_edit`, `lsp`) to enforce layered allow/ask/deny policies, workspace sandbox boundaries, and self-modification protections.

Designed to be self-contained and dependency-free (`node:fs`, `node:path`, `node:os` only), `command-guard` can be dropped into `.omp/extensions/command-guard/` in any repository (or Copier template) or installed globally under `~/.omp/agent/extensions/command-guard/`.

---

## Key Features

1. **Interactive Whitelist Builder (Cross-Harness Shared)**
   - Unmatched or gated commands prompt once in the TUI with normalized command prefixes (e.g. `git push`, `npm run build`, `python3 -m pytest`).
   - Users choose scope at prompt time:
     - **Yes, once** (single execution)
     - **Allow for session** (in-memory across the main agent and spawned subagents)
     - **Save to project-local** (`.claude/settings.local.json` + `.devin/config.local.json` + `.omp/permissions.local.json` — gitignored)
     - **Save to project shared** (`.claude/settings.json` + `.devin/config.json` + `.omp/permissions.json` — committed for team collaboration)
     - **Save to user global** (`~/.claude/settings.json` + `~/.config/devin/config.json` + `~/.omp/agent/permissions.json`)
   - Path-escape prompts offer scoped root/command exceptions (`Allow <prefix> outside workspace (session)` or `Trust directory <dir> (project-local)`).

2. **5-Level Precedence Hierarchy Across Claude Code, Devin CLI, and omp**
   - Evaluated from highest to lowest priority:

     | Level | Git Status | Claude Code | Devin CLI | omp (`command-guard`) |
     | :--- | :--- | :--- | :--- | :--- |
     | `1. session` | In-memory | — | — | Runtime session sets |
     | `2. projectLocal` | **Gitignored** | `.claude/settings.local.json` | `.devin/config.local.json` | `.omp/permissions.local.json` |
     | `3. project` | **Committed** | `.claude/settings.json` | `.devin/config.json` | `.omp/permissions.json` |
     | `4. user` | `$HOME` | `~/.claude/settings.json` | `~/.config/devin/config.json` | `~/.omp/agent/permissions.json` |
     | `5. defaults` | `$HOME` | — | — | `~/.omp/agent/permissions.defaults.json` |

   - **Security invariants:**
     - `deny` rules at *any* level always win first.
     - Hard security checks (`bash -c`, `sh -c`, `find -exec`, `git -c`, command substitutions `$()`) always require interactive confirmation regardless of `allow` rules.
     - Committed `project` files can share workspace-local `allow`, `ask`, and `deny` rules with collaborators, but **cannot** grant `allowOutside` or `allowedPaths` sandbox escapes.

3. **Shell-Aware Tokenizer & Normalizer**
   - Splits compound pipelines (`&&`, `||`, `;`, `|`, `&`, `\n`) into individual command segments and evaluates every segment independently.
   - Strips leading environment assignments (`FOO=1`), shell flow keywords (`if`, `then`, `for x in ...; do`), and benign global flags (`git -C <dir> status` → `git status`, `chezmoi --source . data` → `chezmoi data`).
   - Consumes heredoc bodies (`<<EOF`, `<<'EOF'`, `<<-EOF`, `<<\EOF`) without misinterpreting multi-line payloads (such as inline Python scripts or template blocks) as shell segments.
   - Flags command substitutions (`$(...)`, `` `...` ``, `<(...)`) and unquoted heredoc expansions as `complex` (requiring single-run confirmation).

4. **Hard Security Guardrails (Non-Persistable)**
   - **Workspace Sandbox:** Commands referencing paths outside the active workspace, `~/.omp/scratch`, or system temp directories require explicit confirmation.
   - **Protected Agent Configs:** Blocks silent reads or writes to `.omp/permissions*.json`, `~/.omp/agent/**`, `.claude/**`, and `.devin/**` to prevent agent self-escalation.
   - **Interpreter & Flag Guards:** Gates `bash -c`, `sh -c`, `python -c`, `find -exec/-delete`, `git -c`, and dangerous flags (`--pre`, `--exec`, `--upload-pack`).

5. **Context Window Protection**
   - Automatically truncates oversized `toolResult` payloads (>20,000 chars) down to 10,000 chars with a `[bootstrap-guard: truncated N chars]` marker so runaway log dumps do not exhaust context.

---

## File Layout

| File | Responsibility |
| :--- | :--- |
| `index.ts` | omp extension entrypoint (`tool_call` & `tool_result` hooks, interactive prompt flow, `/permissions` command, write-target checks) |
| `parser.ts` | Single-pass shell lexer: quotes, escapes, redirections, heredocs, compound operators, substitution detection |
| `normalizer.ts` | Canonical token extraction, global flag skipping, 1/2/3-word command prefix computation, prefix matching |
| `rules.ts` | Hard security checks, workspace boundary resolution, protected-path detection, multi-level decision engine |
| `store.ts` | Multi-harness JSON rule loader, deduplicated non-destructive writer, level builder |
| `adapters.ts` | *(v2)* Canonical `Bash(<prefix> *)` / `Read(...)` / `Edit(...)` parser & serializer bridging Claude Code, Devin CLI, and omp |
| `types.ts` | Core TypeScript types (`PermissionRules`, `PermissionLevel`, `SegmentDecision`, `ShellParseResult`) |

---

## Rule Schema

### Standardized Cross-Harness Format (Claude Code & Devin CLI Native)

Both Claude Code (`.claude/settings.json`) and Devin CLI (`.devin/config.json`) natively consume the `permissions` object with `"Bash(<prefix> *)"` glob syntax:

```json
{
  "permissions": {
    "allow": [
      "Bash(git status *)",
      "Bash(just check *)",
      "Bash(bun test *)"
    ],
    "ask": [
      "Bash(git push *)",
      "Bash(rm *)"
    ],
    "deny": [
      "Bash(sudo *)",
      "Bash(rm -rf / *)",
      "Read(**/.env)",
      "Edit(~/.ssh/**)"
    ]
  },
  "omp": {
    "allowOutside": ["git status"],
    "allowedPaths": ["/usr/local/share"]
  }
}
```

### Legacy omp Format (`.omp/permissions*.json` — Backward Compatible)

```json
{
  "allow": ["git status", "npm test", "just check"],
  "ask": ["git push", "rm"],
  "deny": ["sudo", "rm -rf /"],
  "allowOutside": ["git status"],
  "allowedPaths": ["/usr/local/share"]
}
```

See [`docs/plans/part9-command-guard-v2-plan.md`](../../../../docs/plans/part9-command-guard-v2-plan.md) for the v2 implementation specification.

---

## Standalone / Copier Template Usage

To embed `command-guard` in another repository or Copier project template:

1. Copy `dot_omp/private_agent/extensions/command-guard/` to `.omp/extensions/command-guard/` (or distribute as an omp plugin package).
2. Set `tools.approval.bash: allow` in `.omp/config.yml` so omp delegates bash prompting to `command-guard`.
3. Commit shared project policies in `.claude/settings.json` (and/or `.devin/config.json`, `.omp/permissions.json`) and add `.claude/settings.local.json`, `.devin/config.local.json`, and `.omp/permissions.local.json` to `.gitignore`.

## Running Tests

```bash
bun test scripts/omp-permissions.test.ts
```

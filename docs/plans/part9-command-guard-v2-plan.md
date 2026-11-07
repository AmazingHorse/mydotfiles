# Plan: `command-guard` v2 — Cross-Harness Standard Format (Claude + Devin + omp), Lazy Async Mirroring, Bun-Native I/O, Double-Prompt Fix, and Heredoc Parser Hardening

> **Target Assignee:** SWE-2  
> **Scope:** `dot_omp/private_agent/extensions/command-guard/`, `dot_omp/private_agent/permissions.defaults.json`, `scripts/omp-permissions.test.ts`  
> **Runtime:** **Bun-native** (`omp` embeds Bun and loads extensions directly via Bun; `tsconfig.json` already specifies `"types": ["bun"]`).  
> **Non-Goals (Out of Scope for Now):** Packaging into external Copier templates (design keeps `command-guard` zero-NPM-dependency and self-contained so it can be copied directly later).

---

## Executive Summary

Four workstreams are planned for `command-guard` v2:

1. **Cross-Harness Permission Standardization & Lazy Asynchronous Mirroring:**
   - Standardize on the shared `{"permissions": {"allow": [...], "ask": [...], "deny": [...]}}` schema used natively by both **Claude Code** and **Devin CLI**, bridged with **omp**.
   - Support collaborative project-shared rules (`.claude/settings.json`, `.devin/config.json`, `.omp/permissions.json`) alongside gitignored project-local overrides (`.claude/settings.local.json`, `.devin/config.local.json`, `.omp/permissions.local.json`) and user-global configs.
   - Implement **lazy, mtime-cached reading + asynchronous background mirroring**: `command-guard` checks file `mtimeMs` lazily when needed, detects when a permission was modified in *any* of the three harnesses (Claude, Devin, or omp), merges the update, and mirrors it asynchronously in the background (`Bun.write`) without blocking the hot `tool_call` path.
2. **Bun-Native Efficiency Migration (Trivial & High-Impact):**
   - Because `omp` itself runs on Bun (`omp://extension-loading.md`: *"imports the modules concurrently with Bun"*) and this repo's `tsconfig.json` already targets `"types": ["bun"]`, migrating `command-guard` from blocking `node:fs` calls (`fs.readFileSync`, `fs.writeFileSync`, `fs.realpathSync` on every argument) to Bun-native APIs (`Bun.file`, `Bun.write`, `Bun.Glob`) + in-memory `mtimeMs` and `realpath` LRU caching is **trivial (~40 lines in `store.ts` and `rules.ts`)** and eliminates synchronous disk I/O from the hot path.
3. **Eliminate Occasional Double Approval Prompts:**
   - Fix all four root causes of back-to-back prompts: per-target write loops, combined outside-path + unapproved-prefix commands, parallel `tool_call` race conditions, and subagent session-set isolation.
4. **Heredoc & Subshell Lexer Hardening:**
   - Fix all six heredoc parser bugs in `parser.ts` and `normalizer.ts` (`python3 - << 'EOF'`, `<< \EOF`, heredocs followed by `&&` or `|`, `"$(cat << 'EOF' ...)"` nested quotes, `0<<EOF` FD prefixes, and closing `EOF` without trailing newline).

---

## Workstream 1: Cross-Harness Standardization & Lazy Asynchronous Mirroring

### 1.1 Official File Locations Across Claude Code, Devin CLI, and omp

Both Claude Code (`code.claude.com/docs/en/permissions`) and Devin CLI (`docs.devin.ai/cli/reference/permissions`) natively use the exact same top-level `permissions` object:

| Scope | Git Status | Claude Code | Devin CLI | omp (`command-guard`) |
| :--- | :--- | :--- | :--- | :--- |
| **Project Shared (Team / Repo)** | **Committed** | `.claude/settings.json` | `.devin/config.json` | `.omp/permissions.json` |
| **Project Personal (Machine-Local)** | **Gitignored** | `.claude/settings.local.json` | `.devin/config.local.json` | `.omp/permissions.local.json` |
| **User Global** | User `$HOME` | `~/.claude/settings.json` | `~/.config/devin/config.json` (Linux/macOS)<br>`%APPDATA%\devin\config.json` (Windows) | `~/.omp/agent/permissions.json` |
| **Managed Defaults** | Dotfiles `$HOME` | — | — | `~/.omp/agent/permissions.defaults.json` |

### 1.2 Exact Rule Grammar Translation (`Claude` vs `Devin` vs `omp`)
Both Claude Code and Devin CLI use the exact same top-level `permissions: { allow: [], ask: [], deny: [] }` structure and identical `Read(glob)` and `mcp__server__tool` rules, with **one key matcher name difference** that `adapters.ts` must translate when reading/mirroring:

| Rule Category | Claude Code Syntax (`.claude/settings*.json`) | Devin CLI Syntax (`.devin/config*.json`) | Internal `PermissionRules` (`omp`) |
| :--- | :--- | :--- | :--- |
| **Shell Command Prefix** | `"Bash(git status *)"` or `"Bash(git status:*)"` or `"Bash(pwd)"` | `"Exec(git status)"` *(matches `git status` and `git status ...` at word boundary)* | `allow/ask/deny: ["git status"]` |
| **File Read Glob** | `"Read(**/.env)"`, `"Read(/usr/local/share/**)"` | `"Read(**/.env)"`, `"Read(/usr/local/share/**)"` | `allowedPaths` / `readRules` |
| **File Write/Edit Glob** | `"Edit(~/.ssh/**)"`, `"Write(/tmp/out/**)"` | `"Write(~/.ssh/**)"`, `"Write(/tmp/out/**)"` | `allowedPaths` / `writeRules` |
| **MCP Tool Rule** | `"mcp__server__tool"`, `"mcp__server__*"` | `"mcp__server__tool"`, `"mcp__server__*"` | `mcpRules` |

> **Note on Devin CLI `read_config_from`:** Devin CLI also supports `"read_config_from": ["claude"]` in `~/.config/devin/config.json` (which imports Claude Code's `CLAUDE.md`, skills, and MCP servers), **but** per official Devin CLI docs (`docs.devin.ai/cli/reference/configuration/read-config-from`), Devin intentionally does **not** import permissions via `read_config_from`. Therefore, our `adapters.ts` lazy mirror writing `"Exec(<prefix>)"` + `"Write(<glob>)"` into `.devin/config[.local].json` and `"Bash(<prefix> *)"` + `"Edit(<glob>)"` into `.claude/settings[.local].json` is essential and fills an exact upstream gap!
Currently `store.ts:110` drops `allow` rules from committed project files (`allow: []`). To support team collaboration in `.claude/settings.json` / `.devin/config.json` / `.omp/permissions.json` safely:
1. **Permit `allow`, `ask`, and `deny` at the `project` level**, while **keeping `allowOutside: []` and `allowedPaths: []` stripped at `project` level** (so a committed repo config can never grant sandbox escapes outside `cwd`).
2. **Non-Bypassable Invariants:**
   - Step 1 (`deny` across all levels) and Step 2 (`hardCheckReason`: `bash -c`, `sh -c`, `find -exec`, `git -c`, `complex` command substitutions, `isProtectedPath`) always run *before* `project` `allow` rules.
   - Therefore, a committed `.claude/settings.json` can pre-approve project commands like `just test`, `bun test`, or `pytest`, but can **never** silence `deny` rules, shell `-c` execution, or outside-workspace writes.

### 1.4 Lazy Mtime-Cached Loading & Automatic Asynchronous Mirroring (`store.ts` & `adapters.ts`)

Instead of reading 4+ JSON files synchronously on every single `bash` or `write` tool call or running a heavy file-watcher daemon:

```mermaid
sequenceDiagram
    participant Agent as omp tool_call
    participant Cache as Mtime Level Cache (RAM)
    participant Disk as .claude / .devin / .omp files
    participant Mirror as Async Mirror Queue (Bun.write)

    Agent->>Cache: getLevels(cwd, home)
    Cache->>Disk: Stat mtimeMs of [claude, devin, omp] files per scope
    alt No mtimeMs changed since last check
        Cache-->>Agent: Return cached PermissionLevel[] immediately (0 JSON parses)
    else One or more files changed (via Claude, Devin, or omp)
        Cache->>Disk: Read changed file(s) via Bun.file().json()
        Cache->>Cache: Merge rules (newest mtime wins on conflict; union of newly added rules)
        Cache-->>Agent: Return updated PermissionLevel[] immediately
        Cache-)Mirror: Fire-and-forget scheduleMirror(scope)
        Mirror-)Disk: Atomic Bun.write to peer harness files whose permissions differ
    end
```

1. **Lazy Evaluation on Demand (`getLevels`):**
   - Maintain an in-memory `ScopeCacheEntry` per scope (`projectLocal`, `project`, `user`, `defaults`) keyed by directory path:
     ```ts
     type ScopeCacheEntry = {
         mtimes: Record<string, number>; // filePath -> last seen mtimeMs (-1 if absent)
         mergedRules: PermissionRules;
         lastSyncedHash: string;         // canonical hash of mergedRules
     };
     ```
   - On `tool_call`, stat the candidate files for each scope.
   - **Fast path (99% of calls):** All `mtimeMs` match `entry.mtimes` → return `entry.mergedRules` in `<0.05ms` with zero JSON parsing.
2. **Automatic Change Detection Across All Three Harnesses:**
   - When a user approves a rule in **Claude Code** (updating `.claude/settings.local.json`), **Devin CLI** (updating `.devin/config.local.json`), or **omp** (updating via `saveRule`), the changed file's `mtimeMs` advances.
   - On the next check, `command-guard` sees the new `mtimeMs`, reads the modified file(s), merges the permission sets, updates `entry.mergedRules`, and **triggers `scheduleAsyncMirror(scope)`**.
   - **Conflict / Deletion Semantics:**
     - If **only one** harness file's `mtimeMs` changed since the last sync snapshot (`lastSyncedRules`), treat that file's `permissions` block as the authoritative delta (so if a user manually *removes* a rule from `.claude/settings.local.json`, that removal propagates to `.omp` and `.devin` instead of being re-added by the stale peer file!).
     - If multiple harness files changed concurrently while omp was closed, compute the union of their rules (with `deny` taking precedence).
3. **Asynchronous Background Mirroring (`scheduleAsyncMirror`):**
   - Runs off the critical path via `queueMicrotask` / debounced async promise (`mirrorInFlight: Map<string, Promise<void>>`).
   - Uses `await Bun.file(targetPath).json()` + `await Bun.write(tmpPath, ...)` + `fs.promises.rename(tmpPath, targetPath)` to non-destructively update only the `permissions` (and `omp`) keys in peer files while preserving all unrelated Claude/Devin settings (`hooks`, `env`, `model`, `theme_mode`, etc.).
   - Updates `entry.mtimes[targetPath]` after writing so `command-guard` does not re-trigger on its own mirror write!
   - **Always Create & Mirror All Three Harness Files:**
     - Whenever a permission is saved or mirrored at a given scope (`projectLocal`, `project`, or `user`), **always create/update all three harness files** for that scope (`mkdir -p` parent directories `.claude`, `.devin`, `.omp` or `~/.config/devin` as needed):
       - `projectLocal`: `.claude/settings.local.json`, `.devin/config.local.json`, `.omp/permissions.local.json`
       - `project`: `.claude/settings.json`, `.devin/config.json`, `.omp/permissions.json`
       - `user`: `~/.claude/settings.json`, `~/.config/devin/config.json`, `~/.omp/agent/permissions.json`
---

## Workstream 2: Bun-Native Efficiency Migration

### Is Migrating `command-guard` to Bun Trivial or Involved?
**It is trivial (~40 LOC across `store.ts` and `rules.ts`) and 100% compatible:**
- `omp` is built on the Bun runtime and loads extensions natively via Bun (`omp://extension-loading.md`).
- Our unit tests already run under `bun test scripts/omp-permissions.test.ts`.
- Our root `tsconfig.json` already configures `"types": ["bun"]`.

### Concrete Bun Optimizations for SWE-2:
1. **Async Atomic File Writes with `Bun.write()` (`store.ts` & `adapters.ts`):**
   - Replace synchronous `fs.writeFileSync` in `saveRule()` / `savePathRule()` and background mirroring with `await Bun.write(tmpFile, JSON.stringify(data, null, 2) + "\n")` + `await fs.promises.rename(tmpFile, filePath)`.
2. **In-Memory `realpath` Cache (`rules.ts`):**
   - Currently, `realpathOrSelf()` (`rules.ts:81-87`) calls `fs.realpathSync(target)` **multiple times per word for every single argument** of every command segment (`isProtectedPath` calls it 6 times per path, and `isWithinRoots` calls it `2 * roots.length` times per path — up to ~30 synchronous `realpathSync` syscalls per `bash` call!).
   - Replace uncached `fs.realpathSync` with a bounded module-level `Map<string, string>` cache (e.g. max 512 entries, cleared on `cwd` change) so `home`, `cwd`, `~/.omp/agent`, `/tmp`, and repeated workspace paths resolve in `O(1)` from memory without hitting the OS VFS on every command.
3. **`Bun.Glob` for `Read(...)` / `Edit(...)` Pattern Matching (`adapters.ts`):**
   - Both Claude Code and Devin CLI use glob patterns inside `Read(**/.env)` and `Edit(src/**)`.
   - Instead of pulling in `minimatch` or `picomatch` from npm, use Bun's built-in C++ **`new Bun.Glob(pattern).match(targetPath)`**! This keeps `command-guard` zero-dependency while supporting full Claude/Devin glob rules at native speed.

---

## Workstream 3: Fix Occasional Double Approval Prompts

### Root Causes & Fixes

#### Cause 3A: Non-`bash` Write Tools (`write`, `edit`, `ast_edit`, `lsp`) Prompting Per Target Without Session Memory
- **Where:** `index.ts:301-334`
- **Bug:** Loops `for (const target of outsideTargets)` calling `ctx.ui.select()` per target, ignores `sessionAllowedPaths` and configured `allowedPaths`, and never saves session trust.
- **Fix:**
  - Deduplicate `resolvedTargets` (`[...new Set(resolvedTargets)]`).
  - Pass `[...sessionAllowedPaths, ...configuredAllowedPaths]` into `workspaceRoots(ctx.cwd, home, extraRoots)`.
  - Prompt **once** per tool call and offer `Yes, once`, `Trust directory <dir> (session)`, and `Trust directory <dir> (save to project-local)`.

#### Cause 3B: Single Command with Both an Unapproved Prefix AND an Outside-Workspace Path
- **Where:** `index.ts:116-247` & `rules.ts:288-323`
- **Bug:** `decideSegment()` returns early at step 3 (`path outside workspace`) before checking if the command prefix is allowed. Choosing `"Trust directory /opt"` adds `/opt` to `sessionAllowedPaths` but leaves the command prefix unapproved, causing the very next command to prompt a second time for the prefix (and vice versa when `"Allow for session: <prefix>"` is chosen).
- **Fix:**
  - Attach `unapprovedPrefix?: string` to `path outside workspace` decisions in `decideSegment()`.
  - When `"Trust directory <dir>"` or `"Allow <prefix> outside workspace"` is chosen, also add the command's `persistablePrefixes` to `sessionAllow`.
  - When `"Allow for session: <prefix>"` is chosen on a command with `outsidePaths`, also add `<prefix>` to `sessionAllowOutside`.

#### Cause 3C: Parallel `tool_call` Invocations Racing Into `ctx.ui.select()`
- **Where:** `index.ts:296`
- **Bug:** Parallel `bash` or `edit` calls in the same turn enter `handleBashCall` concurrently before the first prompt resolves.
- **Fix:**
  - Serialize prompts with a module-level async mutex `withApprovalLock(fn)`.
  - Re-run `getLevels()` and `decideSegment()` *after* acquiring the lock; if the sibling call just approved the prefix or directory, return `undefined` without prompting again.

#### Cause 3D: Subagent Session Isolation (`sessionAllow` Per-Factory vs Shared Runtime)
- **Where:** `index.ts:285-287`
- **Bug:** `omp` rebinds extension factories for each spawned subagent (`task` tool). Because `sessionAllow`, `sessionAllowOutside`, and `sessionAllowedPaths` are inside `export default function`, subagents don't inherit `"Allow for session"` rules granted in the main agent (or sibling subagents).
- **Fix:**
  - Hoist `sessionAllow`, `sessionAllowOutside`, `sessionAllowedPaths`, and `approvalLock` to **module scope** in `index.ts`.

---

## Workstream 4: Fix Heredoc & Subshell Parser Breakage

### Root Causes & Fixes in `parser.ts` & `normalizer.ts`

1. **Bug 4A — Heredoc Followed by `&&`, `|`, `||`, or `\<newline>` (`parser.ts:151, 300-358`):**
   - Extract `consumePendingHeredocs()` and invoke it on every unescaped newline when `pendingHeredocs.length > 0` (including after `|`, `&&`, `||`). Ensure backslash-newline continuations on the header line finish the logical command line before consuming the heredoc body.
2. **Bug 4B — Backslash-Escaped Heredoc Delimiters (`python3 << \EOF`, `cat <<\EOF`) (`parser.ts:229-256`):**
   - In `parseHeredocDelimiter()`, treat any `'...'`, `"..."`, or `\c` in the delimiter token as setting `heredocQuoted = true` and strip the quote/backslash characters so `delimiter` is `"EOF"` (not `"\\EOF"`).
3. **Bug 4C — Closing `EOF` Without Trailing Newline & Escaped `\$` in Unquoted Heredocs (`parser.ts:324-354`):**
   - Check `compareLine === heredoc.delimiter` when `index === command.length` (EOF without trailing `\n`).
   - In unquoted heredocs, only flag `complex = true` when `$(`, `${`, or `` ` `` is not preceded by `\` (`line[i - 1] !== "\\"`).
4. **Bug 4D — Double Quotes Inside `"$(cat << 'EOF' ...)"` & Stray `")"` Segments (`parser.ts:109-145, 190-195`):**
   - Track nested quote/substitution states on a stack so entering `$(` inside `"..."` lexes the inner command (and its `<< 'EOF'` heredoc and inner `"..."` strings) independently without closing the outer `"..."` quote!
   - When `)` closes `substitutionDepth > 0` at the start of a line (after `EOF\n`), do not emit a standalone `[")"]` segment.
5. **Bug 4E — FD-Prefixed Heredocs (`0<<EOF`) (`parser.ts:224`):**
   - If `/^\d+$/.test(currentText) && !currentQuoted`, clear `currentText = ""` before `<<` instead of flushing `"0"` as a command argument.
6. **Bug 4F — `python` / `python3` Prefix Normalization (`normalizer.ts:3-189`):**
   - Remove `python` / `python3` from `SUBCOMMAND_TOOLS` so `python3 script.py` and `python3 - << 'EOF'` normalize to `"python3"` (while `python3 -m <module>` normalizes to `"python3 -m <module>"`).

---

## Verification & Acceptance Criteria

SWE-2 must verify all changes using `bun test scripts/omp-permissions.test.ts` and `just test-fast`:

1. **Heredoc Test Suite (`scripts/omp-permissions.test.ts`)**:
   - `python3 - << 'EOF'\nimport os\nprint("hello")\nEOF` → `segments: [["python3", "-"]]`, `complex: false`, prefix: `"python3"`.
   - `python3 << \EOF\nprint("$HOME")\nEOF` → `segments: [["python3"]]`, `complex: false`.
   - `python3 - << 'EOF' && echo ok\nprint("a && b")\nEOF` → `segments: [["python3", "-"], ["echo", "ok"]]`, `complex: false`.
   - `python3 - << 'EOF' |\nprint("a | b")\nEOF\ngrep a` → `segments: [["python3", "-"], ["grep", "a"]]`, `complex: false`.
   - `python3 -c "$(cat << 'EOF'\nprint("double quotes && rm -rf /")\nEOF\n)"` → does not leak inner Python lines into top-level shell segments.
   - `x=$(python3 << 'EOF'\nprint(1)\nEOF\n)` → does not produce a stray `[")"]` segment.
   - Closing `EOF` without trailing newline (`cat << 'EOF'\nhello\nEOF`) → consumes body completely.
2. **Double-Prompt Prevention Tests**:
   - Concurrent `handleBashCall` calls for the same unapproved prefix prompt only once.
   - Subagent extension instances share `sessionAllow` and `sessionAllowedPaths` with the parent session.
   - Command with both unapproved prefix and outside path (`cp /tmp/a /opt/b`) prompts only once across subsequent runs.
3. **Cross-Harness Lazy Cache & Async Mirroring Tests**:
   - Modifying `.claude/settings.local.json` (or `.devin/config.local.json`) updates `mtimeMs`, is picked up lazily on the next `getLevels()` call, and asynchronously mirrors the updated `"Bash(<prefix> *)"` rules to `.omp/permissions.local.json` (and `.devin/config.local.json`) while preserving unrelated JSON keys.
   - Removing a rule in one file propagates the deletion to peer files on the next lazy sync rather than resurrecting the deleted rule.
   - `Bun.Glob` matches `Read(**/.env)` and `Edit(src/**)` rules accurately.
4. **CI Check**:
   - `just test-fast` passes with 0 errors.

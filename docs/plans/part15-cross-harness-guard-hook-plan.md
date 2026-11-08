# Plan: `command-guard` as a Cross-Harness PreToolUse Hook + Adapter Safety Fix (`part15`)

> **Target Assignee:** SWE-2
> **Scope:** `dot_omp/private_agent/extensions/command-guard/`, `dot_omp/private_agent/permissions.defaults.json`, `scripts/omp-permissions.test.ts`, chezmoi-managed Claude settings, `.gitignore`, `docs/`
> **Goal:** One policy engine (command-guard) enforces deny rules and hard checks in omp, Claude Code, and Devin. Allowlist mirroring shrinks to a convenience feature and can no longer weaken policy.

---

## Order and checkpoint

Phases run in this order: **0 → 1 → checkpoint → 2 → 3 → 4**. After Phase 1, stop and report back. The report is what decides how much of `store.ts` Phase 3 removes.

## Known defects driving this plan

- **Mirroring inverts deny rules.** `adapters.ts` sorts `Read`/`Edit`/`Write`/`mcp__` rules into buckets without recording which list they came from, then writes them all back as **allow**. Unknown rules (`Fetch(...)`, `WebFetch(...)`, Devin tool names like `exec`) get wrapped as command prefixes, e.g. `Exec(WebFetch(...))` or `Bash(exec *)`. Reproduced: a Claude deny of `Read(**/.env)` becomes a Devin allow of `Read(**/.env)`.
- **Mirroring can't carry hard checks.** Hard checks (`bash -c`, `$()`, `git -c`, workspace escape, protected config) have no equivalent in the other harnesses, so copied allowlists end up weaker there.
- **Loading rules has write side effects.** `loadPermissionLevels` → `getScopeRules` may call `scheduleAsyncMirror`.
- **`doas` was dropped** from `permissions.defaults.json` `ask` by accident.

---

## Phase 0: Spike (gates the `ask` mapping)

Find out whether Devin honours Claude-format PreToolUse output when the hook comes from `~/.claude/settings.json`:

```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "ask", "permissionDecisionReason": "..." } }
```

- **Test 1:** register a throwaway hook in a scratch repo's `.claude/settings.local.json` that always returns `ask`. Run Devin, confirm it appears in `/hooks`, and check whether a command forces a prompt even when it matches an `Exec(...)` allow.
- **Test 2:** repeat with `permissionDecision: "deny"`.
- **Record** both results in the Phase 1 report.
- **Fallback if `ask` isn't honoured:** in Devin, hard-check `ask` maps to `{"decision":"block","reason":"needs human approval: <reason>"}`.

## Phase 1: Shared evaluator + hook entrypoint

1. **New `evaluate.ts`:** move the logic from `handleBashCall`'s `evaluateDecisions` in `index.ts` into a pure function.
   ```ts
   export type CommandVerdict = {
     verdict: "allow" | "ask" | "deny" | "unmatched";
     reasons: string[];
     persistable: boolean;
     decisions: Array<{ words: ParsedWord[]; decision: SegmentDecision }>;
     complex: boolean;
   };
   export function evaluateCommand(command: string, cwd: string, home: string, levels: PermissionLevel[]): CommandVerdict;
   ```
   - The verdict precedence must match today's behaviour: deny, then ask (complex syntax or hard check), then unmatched, then allow.
   - `index.ts` calls this function. omp's behaviour must not change, and the existing tests must pass untouched.
2. **Read-only loader:** add `{ mirror: false }` to `getScopeRules` / `loadPermissionLevels`. With it set, the loader never calls `scheduleAsyncMirror` and never writes files. The hook always uses `mirror: false`.
3. **New `hook.ts`:** a CLI that only runs under `import.meta.main`, so importing it does nothing. Before relying on that, confirm omp's loader only loads `index.ts` from the extension directory.
   - **Input:** stdin JSON. `tool_name === "exec"` means Devin, `"Bash"` means Claude.
   - **Command and cwd:** command is `tool_input.command`. cwd is the first of `tool_input.workdir`, `tool_input.cwd`, `DEVIN_PROJECT_DIR`, `CLAUDE_PROJECT_DIR`, `process.cwd()`.
   - **Output policy:** the hook **never approves**. Approving plain prefixes stays with each harness's native rules and prompts.

     | Verdict | Claude output | Devin output |
     | :--- | :--- | :--- |
     | `deny` | `permissionDecision: "deny"` | `{"decision":"block","reason":...}` |
     | `ask` (hard check or complex syntax) | `permissionDecision: "ask"` | depends on Phase 0 result |
     | `allow` / `unmatched` | no output, exit 0 | no output, exit 0 |
   - **Errors:** on an internal error, print to stderr and exit 1. Both harnesses log this and don't block, so the hook fails open. Native deny lists still apply.
4. **Registration:** register only in `~/.claude/settings.json`, with matcher `^(Bash|exec)$`, command `bun "$HOME/.omp/agent/extensions/command-guard/hook.ts"` and `timeout: 5`.
   - Devin imports Claude hooks, so this one entry covers both harnesses. Do **not** also register in Devin config, or the hook fires twice.
   - Manage the file with a chezmoi `modify_` script, following the pattern in `dot_omp/private_agent/modify_config.yml`. It must merge the `hooks` key and keep user-written `permissions` and other keys.
   - Use a templated Windows path (`%USERPROFILE%`).
5. **Tests** in `scripts/omp-permissions.test.ts`:
   - `evaluateCommand` gives the same verdicts as the current `handleBashCall` cases.
   - `hook.ts` run as a subprocess with Devin and Claude payloads. Cover `sudo ls` (deny), `bash -c 'x'` (ask), `git status` (no output), and a malformed stdin (exit 1, no stdout).
   - With `mirror: false`, no file mtimes change.

**Checkpoint report:** Phase 0 results, the diff, test output, and a list of every `store.ts` export with how it's used now. Lead then decides the Phase 3 scope.

## Phase 2: Adapter safety fix

- **Translate only command prefixes.** Only `Bash(...)` ↔ `Exec(...)` ↔ bare omp prefixes cross between harnesses.
- **Leave everything else alone.** `Read`, `Edit`, `Write`, `Fetch`, `WebFetch`, `mcp__*` and bare tool names stay **verbatim in their original list, in their own harness file**. They are never translated to another harness and never moved between allow, ask and deny.
- **omp may still read paths.** omp may read Claude `Edit(...)` and Devin `Write(...)` **allow** entries as `allowedPaths` for its own checks, read-only.
- **Mirror writes:** `rec.permissions.<list> = [...existing non-prefix entries of that list, ...translated prefixes]`.
- **Restore `doas`** to `ask` in `permissions.defaults.json`.
- **Regression tests:**
  - Deny round trips for `Read`, `Edit`, `Write` and `mcp__`.
  - `Fetch`, `WebFetch` and tool names pass through unchanged.
  - Non-prefix entries already in a file survive a mirror write.
  - Nothing ever lands in a different list from the one it started in.

## Phase 3: Shrink mirroring (scope set at checkpoint)

Default proposal unless the lead changes it:
- **Allow only:** mirror only `allow` prefixes. `ask` and `deny` live in each harness natively and in command-guard via the hook.
- **Never write committed files:** never write the `project` scope (`.claude/settings.json`, `.devin/config.json`, `.omp/permissions.json`). It is read-only, so committed files don't change on every run.
- **Reject keyword prefixes:** in `saveRule`, refuse to save shell keywords and builtins (`continue`, `break`, `read`, `return`, `exit`, `local`, `export`, `set`, `true`, `false`, `:`).
- **Remove dead code:** delete whatever conflict-resolution code in `getScopeRules` becomes unused.

## Phase 4: Hygiene and docs

- **`.gitignore`:** add `.claude/settings.local.json`, `.devin/config.local.json`, `.devin/mcp_config.local.json`, `.omp/permissions.local.json`, `AGENTS.local.md`.
- **command-guard README:**
  - Devin uses `Exec(prefix)`, `Read`, `Write`, `Fetch`, tool names and `mcp__*`. It does not use `Bash(...)`.
  - Document the hook, the never-approve policy, and the new mirror scope.
- **ADR 0006 "Hook-based cross-harness enforcement":** supersedes the mirroring rationale in ADR 0003.
- **`docs/debt.md`:** update entry 1. Retirement now depends on native hook support in each harness, not on omp alone.

## Verification

- `bun test scripts/omp-permissions.test.ts`
- `just test-fast` after each phase. `just test` once at the end.
- Smoke test:
  ```bash
  printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"exec","tool_input":{"command":"sudo ls"}}' \
    | bun dot_omp/private_agent/extensions/command-guard/hook.ts
  ```

## Out of scope (separate follow-ups)

- Cleaning `~/.config/devin/config.json` (user action, outside the repo)
- Retiring `~/.codeium/windsurf/memories/global_rules.md`
- `AGENTS.md` wording
- Devin Cloud environment blueprint
- Deduplicating the `wt` resolver
- bun global-bin PATH in `run_onchange_after_link-agent-skills.sh.tmpl`

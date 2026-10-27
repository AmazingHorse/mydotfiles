# Part 3: harden the bootstrap-guard permission shim

Run after Part 2: `omp @plans/part3-permission-hardening.md`. One phase at a time; run the
phase's verification before moving on. Do not run `chezmoi apply` or `scripts/ci-check.sh`.

## Files (touch nothing else)
- `dot_omp/private_agent/extensions/bootstrap-guard.ts`
- `scripts/omp-permissions.test.ts`
- `dot_omp/private_agent/permissions.defaults.json`
- `dot_justfile` (Phase 4 only)

## Phase 1: protect the agent's own config (self-escalation)
Today `~/.omp` is an allowed root for both the write/edit guard and bash path checks, and
workspace writes are auto-approved, so the agent can grant itself permissions with
`edit .omp/permissions.local.json` or `echo ... > ~/.omp/agent/permissions.json` (`echo` is allowed).
- Add `isProtectedPath(resolved, cwd, home)`: true for anything under `<home>/.omp/agent/`,
  and for `<cwd>/.omp/permissions.json` and `<cwd>/.omp/permissions.local.json`.
- Narrow the `~/.omp` exemption to `<home>/.omp/scratch/` only (both guards).
- Write/edit guard: protected targets always prompt `Yes, once` / `No` (no session option).
- Bash: a protected path word (including redirection targets and `--flag=` values) is a
  non-persistable ask: `protected agent config: <word>`.
- Tests: `echo x > ~/.omp/agent/permissions.json` → non-persistable ask;
  `cat .omp/permissions.local.json` → non-persistable ask; `ls ~/.omp/scratch/x` → allow.

## Phase 2: don't let a cloned repo grant itself allows
`.omp/permissions.json` is committed by repo authors and currently outranks your user rules.
- Load the `project` level with `allow: []`: honor only its `ask`/`deny` entries.
  `projectLocal` (gitignored, written by you) keeps full allow semantics.
- Update the SHIM header comment accordingly.
- Test: project level `{allow:["curl"]}` + defaults `ask:["curl"]` → ask.

## Phase 3: make fail-open visible
`tools.approval.bash: allow` means if this extension fails to load, bash runs unprompted
(omp's critical patterns are the only backstop).
- On `session_start` (verify the event name in omp's ExtensionAPI types before using it),
  `ctx.ui.notify` (or equivalent; verify) a one-line "bootstrap-guard: permission shim active".
- Verify whether subagents (task tool) have `ctx.hasUI`; if not, document in the SHIM header
  that subagents can only run pre-allowed commands.

## Phase 4: `just -g omp-sandbox` (real boundary, optional)
`bwrap` is installed and works on this WSL host. Add a recipe that runs omp with the
filesystem read-only except the workspace, `~/.omp`, and tool caches:
`bwrap --ro-bind / / --bind "$PWD" "$PWD" --bind "$HOME/.omp" "$HOME/.omp"
 --bind "$HOME/.cache" "$HOME/.cache" --bind "$HOME/.local/share/mise" "$HOME/.local/share/mise"
 --dev /dev --proc /proc --tmpfs /tmp --die-with-parent omp "$@"`.
Fail with a clear message if `bwrap` is missing. Do not change the default `run-omp`.

## Verification
```bash
bun test scripts/omp-permissions.test.ts
just --justfile dot_justfile --show omp-sandbox
chezmoi diff ~/.omp/agent/extensions/bootstrap-guard.ts
```
Plus the strict tsc check from Part 1: temp dir, symlink `node_modules` to the omp install's
`node_modules`, `npx -y -p typescript@5.6.3 tsc -p .` must exit 0.

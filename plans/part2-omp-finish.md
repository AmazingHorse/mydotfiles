# Part 2: finish the omp control plane (chezmoi repo `mydotfiles`)

Run from the repo root: `omp @.agent-spec.md` (omp 18.x has no `--prompt-file`;
`@file` attaches the spec). Execute the phases in order. Each phase is atomic: finish
it, run its verification command, then report before starting the next phase.

## Ground truth (do not re-derive)

- chezmoi source = this repo. `dot_omp/` deploys to `~/.omp/`; `dot_justfile` deploys to
  `~/.justfile` (Linux/WSL only, ignored on Windows) and is invoked as `just -g <recipe>`.
- omp reads `~/.omp/agent/{config.yml,AGENTS.md,mcp.json,extensions/}`. Part 1 already
  manages these. Do not touch `dot_omp/private_agent/**` or `.chezmoitemplates/**`.
- Existing assets to reuse, not duplicate: `dot_omp/archetypes/*.md` (domain profiles),
  `dot_omp/prompts/plan-spec.md` (planner prompt), the `agent_home` variable and the
  `agent-init`, `plan`, `omp-run`, `doctor`, `devin-worktree`, `devin-clean` recipes in
  `dot_justfile`.
- omp 18.x has **no `omp reset` command**. A fresh session is any `omp` invocation without
  `-c/--continue` or `-r/--resume`; that is what "reset" means below.
- Do NOT run `scripts/ci-check.sh`: it overwrites `~/.config/chezmoi/chezmoi.toml`.
- Do NOT run `chezmoi apply`. Verification is read-only.

## Files (touch nothing else)

- `dot_omp/templates/plan-template.md` (new)
- `dot_omp/seeds/typescript-node.md` (new)
- `dot_omp/seeds/python.md` (new)
- `dot_omp/seeds/systems-shell.md` (new)
- `dot_omp/seeds/minimal.md` (new)
- `dot_justfile` (modify: merge, keep every existing recipe working)

## Phase 1: plan template

Create `dot_omp/templates/plan-template.md`, the standard shape for every `.agent-spec.md`:

- Sections, in order: `## Task` (one sentence + one assumption line), `## Files` (exact
  repo-relative paths, `(new)` marker), `## Steps`, `## Verification Commands`, `## Out of scope`.
- `## Steps`: a numbered list where every step is 1–3 tool calls, names the file(s)
  and symbol(s) it touches, and has its own one-line check.
- `## Verification Commands`: fenced `bash` block of exact commands, narrowest first,
  final full gate last. No prose verification ("looks right").
- Use `<placeholder>` tokens, no example project content. Keep it under 50 lines.

Verify: `test -s dot_omp/templates/plan-template.md && rg -c '^## ' dot_omp/templates/plan-template.md` (expect 5).

## Phase 2: project seeds

Create the four seeds in `dot_omp/seeds/`. Each one is a language/tooling profile that
`just -g seed` writes into a project's `.agent-profile.md`. Same section layout as the
archetypes (`# Seed: <name>`, `## Goal`, `## Rules`, `## Verification`), each ≤ 30 lines:

- `typescript-node.md`: strict TS, no `any`; LSP-first; verification
  `npx tsc --noEmit` then `npm test`; lint via `npm run lint` when present.
- `python.md`: type hints on public APIs; `pytest`; `ruff check` / `mypy` only if configured
  in `pyproject.toml`; venv via mise/uv, never global `pip install`.
- `systems-shell.md`: POSIX `sh` unless bash is required; `set -eu`; idempotent;
  verification `shellcheck <changed scripts>` + `bash -n`.
- `minimal.md`: language-agnostic floor: obey the global contract, name the
  verification command in the spec, no extra rules.

Verify: `ls dot_omp/seeds/ && rg -L '^## Verification' dot_omp/seeds/` (second command must print nothing).

## Phase 3: `dot_justfile` recipes

Merge these recipes into `dot_justfile`, keeping its existing style: `[no-cd]`, bash
shebang bodies with `set -euo pipefail`, `{{quote(...)}}` for interpolation, clear stderr
messages, non-zero exit on failure. "Quota-flexible" means every omp-invoking recipe
accepts a `model=""` parameter and falls back to `$OMP_MODEL`, passing `--model` only when
one of the two is non-empty, so the user can switch providers when a quota runs out.

- `seed lang archetype=""`: write `./.agent-profile.md` from `$agent_home/seeds/<lang>.md`,
  then append `$agent_home/archetypes/<archetype>.md` under a `## Archetype` heading if given.
  List the available seeds when `lang` is unknown. Refuse to overwrite an existing profile.
  Leave `agent-init` in place.
- `git-guard`: fail unless inside a git work tree, not on `main`/`master`, and
  `git check-ignore -q .agent-spec.md .agent-profile.md` succeeds. Print the dirty-file
  count as a warning (not a failure).
- `plan-agy +task`: build the same prompt as the existing `plan` recipe, then run
  `agy --mode plan --print "<prompt>"` and write stdout to `./.agent-spec.md`
  (refuse to overwrite a non-empty spec unless `FORCE=1`). Uses Antigravity credits.
- `plan-omp model="" +task`: the existing `plan` behavior with the model fallback. Keep
  `plan` working as an alias (just `alias` or a thin recipe).
- `run-omp model="" *args`: run `git-guard`, require a non-empty `.agent-spec.md`, then start
  a **fresh** omp session (never `-c`/`-r`; this is the "reset"): `omp [--model M] "$@" @.agent-spec.md`.
  Keep `omp-run` working as an alias.
- `worktree-new branch`: the `devin-worktree` logic without devin: `git worktree add`
  to `../wt-<branch with / → ->`, create the branch if missing, copy `.agent-spec.md` and
  `.agent-profile.md` if present, print the path. Do not launch omp.
- `worktree-rm branch`: `git worktree remove` that same path, no `--force`, with a hint on failure.
- `doctor`: extend the existing recipe. Add a report line for whether
  `$agent_home/agent/config.yml` contains `approvalMode: write`, whether
  `$agent_home/agent/extensions/bootstrap-guard.ts` exists, and the seed count in
  `$agent_home/seeds`. Keep every existing line.

Verify:
```bash
just --justfile dot_justfile --summary
just --justfile dot_justfile --show run-omp
just --justfile dot_justfile --dry-run seed minimal
```

## Phase 4: final verification

```bash
chezmoi status
chezmoi diff --exclude=scripts
chezmoi execute-template < dot_config/agent-env.sh.tmpl
chezmoi execute-template < dot_config/mise/config.toml.tmpl
chezmoi cat ~/.omp/agent/config.yml
chezmoi managed --include=files | rg '^\.omp/(templates|seeds)/'
```

Done = all commands exit 0, `chezmoi managed` lists the plan template and the four seeds,
and `chezmoi diff` shows only the files listed above plus Part 1 changes. Report each command
and its result. Do not run `chezmoi apply`; the user applies.

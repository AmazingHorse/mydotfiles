# Agent Guidelines (mydotfiles)

Cross-agent instructions for this repository. Applies to omp, Claude Code, agy, Cursor, and Devin.

## Key Commands
- `just test` — Run full CI verification suite (shellcheck, templates, dry-run, pin reachability).
- `just test-fast` — Run CI verification skipping network calls (`CI_SKIP_NETWORK=1`).
- `just render-rules` — Render canonical `.chezmoitemplates/agent-core.md` to `agent/cursor-user-rules.md`.
- `just apply` — Apply chezmoi changes locally.

## Rules Agents Break
1. **Always verify via CLI:** Run `just test` before reporting done. Never eyeball or assume syntax is correct.
2. **Workspace boundaries:** All file modifications and commands must remain inside this checkout. Never touch `~/.config`, `/etc`, or paths outside the repository root.
3. **Conventional Commits:** Every commit message must follow `type(scope): description`.
4. **Tool manifest convention:** Tools are added via `dot_config/mise/config.toml.tmpl` and pinned in `.chezmoidata.toml`. Do not write custom shell installers for binaries available in aqua/mise.
5. **Targeted edits:** Touch only files directly related to the objective. No drive-by formatting churn or unsolicited refactors.

## Canonical Docs
- `CONTRIBUTING.md` — Commit conventions, PR rules, how-to-add-a-tool.
- `docs/adr/` — Architectural Decision Records.
- `docs/debt.md` — Tracked shims and technical debt.

# Portable agent guidance

Canonical source: [`.chezmoitemplates/agent-core.md`](../.chezmoitemplates/agent-core.md).
Render via `just render-rules` to [`cursor-user-rules.md`](cursor-user-rules.md) → paste into
Cursor → Settings → Rules → **User Rules**.
`chezmoi apply` renders the same core template into `~/.omp/agent/AGENTS.md` (omp) and `~/.gemini/GEMINI.md` (Antigravity).

## Rule inventory (avoid triple-loading)

| File | Role | Keep? |
|------|------|--------|
| `agent/cursor-user-rules.md` | Global habits (platform/shell, agency, …) | **Source of truth** — paste to User Rules |
| `~/.cursor/plugins/local/platform-shell/.../platform-shell.mdc` | Same platform/shell text as a local plugin | **Retire** once User Rules pasted (duplicate) |
| Other repos’ `.cursor/rules/platform-shell.mdc` | Same again, per project | **Delete** or replace with one-line pointer |
| This repo `.cursor/rules/dotfiles-bootstrap.mdc` | Chezmoi/bootstrap pins for **mydotfiles only** | Keep |
| This repo `.cursor/rules/wsl-bootstrap.mdc` | WSL path/TTY/ABI for bootstrap scripts | Keep (glob-scoped) |

Do **not** copy `platform-shell` into this repo — it already lives in User Rules.

## Refreshing User Rules

- **Edit:** Update `.chezmoitemplates/agent-core.md`, then run `just render-rules` and `just apply`.
- **Cursor UI:** Paste updated `agent/cursor-user-rules.md` into Settings → Rules → User Rules.
- **Linux Cursor DB:** `~/.config/Cursor/User/globalStorage/state.vscdb`, key `aicontext.personalContext`
- **Windows Cursor DB:** `%APPDATA%\Cursor\User\globalStorage\state.vscdb`, key `aicontext.personalContext`

## Layout

| What | Where |
|------|--------|
| Canonical template | `.chezmoitemplates/agent-core.md` |
| omp | `dot_omp/` → `~/.omp/agent/AGENTS.md` (+ seeds, archetypes, prompts, `command-guard`) |
| Antigravity | `dot_gemini/GEMINI.md.tmpl` → `~/.gemini/GEMINI.md` |
| Cursor Global | User Rules ← `agent/cursor-user-rules.md` (`just render-rules`) |
| This repo | `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*.mdc` |
| Other repos | `AGENTS.md` + `.agent-profile.md` (via `just -g new` / `just -g seed`) |

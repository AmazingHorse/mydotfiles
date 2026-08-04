# Portable agent guidance

Canonical **Cursor User Rules**: [`cursor-user-rules.md`](cursor-user-rules.md) → paste into
Cursor → Settings → Rules → **User Rules**. Antigravity: `dot_gemini/GEMINI.md` → `~/.gemini/GEMINI.md`.

## Rule inventory (avoid triple-loading)

| File | Role | Keep? |
|------|------|--------|
| `agent/cursor-user-rules.md` | Global habits (platform/shell, agency, …) | **Source of truth** — paste to User Rules |
| `~/.cursor/plugins/local/platform-shell/.../platform-shell.mdc` | Same platform/shell text as a local plugin | **Retire** once User Rules pasted (duplicate) |
| Other repos’ `.cursor/rules/platform-shell.mdc` | Same again, per project | **Delete** or replace with one-line pointer |
| This repo `.cursor/rules/dotfiles-bootstrap.mdc` | Chezmoi/bootstrap pins for **mydotfiles only** | Keep |
| This repo `.cursor/rules/wsl-bootstrap.mdc` | WSL path/TTY/ABI for bootstrap scripts | Keep (glob-scoped) |

Do **not** copy `platform-shell` into this repo — it already lives in User Rules.

## Find / refresh User Rules

- **UI:** Settings → Rules → User Rules → sync into `cursor-user-rules.md`
- **Windows DB:** `%APPDATA%\Cursor\User\globalStorage\state.vscdb`, key `aicontext.personalContext` (see dump snippet in git history / prior notes if needed)

## Layout

| What | Where |
|------|--------|
| Global | User Rules ← `cursor-user-rules.md` |
| This repo | `.cursor/rules/*.mdc` |
| Other repos | their project rules only (no platform-shell clone) |
| Antigravity | `chezmoi apply` → `~/.gemini/GEMINI.md` |

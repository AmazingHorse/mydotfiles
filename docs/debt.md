# Technical and Architectural Debt

Tracked shims, temporary bridges, and planned upstream replacements.

## 1. Cross-Harness Bash Permission Shim and PreToolUse Hook (`command-guard`)
- **Location:** `dot_omp/private_agent/extensions/command-guard/`
- **Why it exists:** AI coding harnesses (omp, Claude Code, Devin CLI) have fragmented and uneven security primitives. Hard security checks (`bash -c`, command substitution `$()`, `git -c`, workspace escapes, protected agent configs) lack declarative schema representation in Claude and Devin settings. `command-guard` provides a unified policy engine in omp and a `PreToolUse` hook CLI (`hook.ts`) for Claude and Devin.
- **Retirement criteria:** Retire when native PreToolUse hook protocols and granular per-command approval rules are standardized and natively supported across all three coding agent harnesses, or when all runs are sandboxed at the OS container layer.
## 2. Windows WSL Font Propagation
- **Location:** `dot_local/share/mydotfiles/configure-terminal-fonts.ps1`
- **Why it exists:** Windows Terminal configuration lives on the Windows host filesystem while dev environments run inside WSL2.
- **Mitigation:** Extracted to an explicit host PowerShell script with non-blocking `SendMessageTimeout` and JSON comments protection.

## 3. Template Tokens in Command Approval Guard (Resolved 2026-10-30)
- **Location:** `dot_omp/private_agent/extensions/command-guard/`
- **Resolution:** Decomposed into modular `command-guard/` package. The lexer ignores quoted heredoc bodies (`<< 'EOF'`), strips shell flow keywords and comments, normalizes canonical `<binary> <subcommand>` tokens past benign global flags, and skips template expressions (`{{ ... }}`) and single-quoted literals from false-positive path escaping.

## 4. Heredoc Quoting and Duplicate Session Approvals in `command-guard` (Resolved 2026-11-08)
- **Location:** `dot_omp/private_agent/extensions/command-guard/`
- **Resolution:** Hardened in `command-guard` v2 (ADR 0006). Lexer stack supports nested quotes inside `$()`, backslash-escaped delimiters (`\EOF`), line continuations (`\<newline>`), and multi-command lines (`&&`, `|`). Normalized Python prefixes (`python3 script.py` -> `python3`, `python3 -m <mod>` -> `python3 -m <mod>`). Hoisted session approval sets to module scope to eliminate duplicate prompts across subagents and sibling instances.
## 5. GitHub CLI (`gh`) Cross-Platform Manifest and PR Workflows
- **Location:** `.chezmoiscripts/run_onchange_after_install-packages.ps1.tmpl`, `dot_config/mise/config.toml.tmpl`, `.chezmoidata.toml`
- **Why it exists:** Windows currently installs `GitHub.cli` via an ad-hoc `winget` call in package install scripts, while Linux/WSL lacks `gh` entirely. It is not declared in the declarative mise manifest or pinned in `.chezmoidata.toml`, and there is no automated PR creation recipe for developer/agent workflows.
- **Planned implementation:**
  - Pin `gh` in `.chezmoidata.toml` under `[packages]`.
  - Add `"aqua:cli/cli" = "{{ .packages.gh }}"` to `dot_config/mise/config.toml.tmpl` per ADR 0002.
  - Remove the legacy winget `GitHub.cli` installation from `run_onchange_after_install-packages.ps1.tmpl`.
  - Wire up PR generation recipes (e.g. in `justfile` / `dot_justfile`) if needed.

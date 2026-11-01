# Technical and Architectural Debt

Tracked shims, temporary bridges, and planned upstream replacements.

## 1. Devin-Style Bash Permission Shim (`command-guard`)
- **Location:** `dot_omp/private_agent/extensions/command-guard/`
- **Why it exists:** Upstream omp lacks granular per-command approval persistence. The extension intercepts bash tool executions to enforce allow/ask/deny lists and workspace path confinement.
- **Retirement criteria:** Retire when upstream omp provides native rule-based permission gating or when agent runs are sandboxed at the OS container layer.

## 2. Windows WSL Font Propagation
- **Location:** `dot_local/share/mydotfiles/configure-terminal-fonts.ps1`
- **Why it exists:** Windows Terminal configuration lives on the Windows host filesystem while dev environments run inside WSL2.
- **Mitigation:** Extracted to an explicit host PowerShell script with non-blocking `SendMessageTimeout` and JSON comments protection.

## 3. Template Tokens in Command Approval Guard (Resolved 2026-10-30)
- **Location:** `dot_omp/private_agent/extensions/command-guard/`
- **Resolution:** Decomposed into modular `command-guard/` package. The lexer ignores quoted heredoc bodies (`<< 'EOF'`), strips shell flow keywords and comments, normalizes canonical `<binary> <subcommand>` tokens past benign global flags, and skips template expressions (`{{ ... }}`) and single-quoted literals from false-positive path escaping.

## 4. Heredoc Quoting and Duplicate Session Approvals in `command-guard`
- **Location:** `dot_omp/private_agent/extensions/command-guard/`
- **Why it exists:** Edge cases in the shell parser and session approval tracking:
  - **Heredoc string quoting:** Empty quotes (e.g. `""` or `''`) inside a Python heredoc body improperly trip approval gating in the command parser.
  - **Duplicate session approvals for Python scripts:** Granting session approval for Python script runs (which trigger on the binary and script name, e.g. `python <script>`) sometimes prompts for approval a second time within the same session.
- **Mitigation / Next steps:**
  - Audit `parser.ts` to ensure quoted strings and empty quotes inside heredoc payloads are ignored or properly lexed within the heredoc body rather than bleeding into command segment boundaries.
  - Investigate prefix normalization and session allowlist persistence in `index.ts` / `rules.ts` when matching two-token Python script invocations across tool calls.

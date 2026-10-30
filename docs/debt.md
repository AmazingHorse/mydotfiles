# Technical and Architectural Debt

Tracked shims, temporary bridges, and planned upstream replacements.

## 1. Devin-Style Bash Permission Shim (`bootstrap-guard.ts`)
- **Location:** `dot_omp/private_agent/extensions/bootstrap-guard.ts`
- **Why it exists:** Upstream omp lacks granular per-command approval persistence. The extension intercepts bash tool executions to enforce allow/ask/deny lists and workspace path confinement.
- **Retirement criteria:** Retire when upstream omp provides native rule-based permission gating or when agent runs are sandboxed at the OS container layer.

## 2. Windows WSL Font Propagation
- **Location:** `dot_local/share/mydotfiles/configure-terminal-fonts.ps1`
- **Why it exists:** Windows Terminal configuration lives on the Windows host filesystem while dev environments run inside WSL2.
- **Mitigation:** Extracted to an explicit host PowerShell script with non-blocking `SendMessageTimeout` and JSON comments protection.

## 3. Template Tokens in Command Approval Guard
- **Location:** `dot_omp/private_agent/extensions/bootstrap-guard.ts`
- **Why it exists:** Evaluating or referencing chezmoi templates in shell invocations causes the command approval process to evaluate template syntax/tokens as valid command approval targets rather than skipping them as template content.
- **Mitigation / Next steps:** Teach `bootstrap-guard.ts` command parser to recognize template execution invocations or skip embedded template blocks rather than parsing inner template expressions as raw commands.

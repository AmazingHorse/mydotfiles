# ADR 0004: Bitwarden Secret Injection and Betterleaks Scanning

## Status
Accepted

## Context
AI developer workflows require access to API keys (Anthropic, Gemini, OpenAI, GitHub tokens). Hardcoding secrets or storing them in shell histories creates severe security exposure. Dotfiles must neither commit secrets nor fail when running on headless servers or unattended CI containers.

## Decision
1. **Secret Storage & Rendering:**
   - Secrets originate in Bitwarden.
   - On workstation profiles, chezmoi template `dot_config/private_agent-secrets.env.tmpl` injects secrets only when Bitwarden CLI (`bw`) is installed and unlocked (`BW_SESSION`).
   - Unmanaged override fallback supported via `~/.config/agent-env.local.sh` and `~/.config/powershell/agent-env.local.ps1`.
   - Server and ephemeral profiles skip secret rendering.
2. **Secret Detection:**
   - Standardize on **Betterleaks** (Zach Rice's successor to Gitleaks) for active feature support and superior container layer scanning.
   - Run secrets scanning in CI and pre-commit hooks.

## Consequences
- Zero plaintext secrets committed to dotfiles repository.
- Graceful degradation when Bitwarden is unavailable.
- Container images and repository trees scanned before merging.

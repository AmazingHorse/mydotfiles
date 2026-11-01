# Secret delivery and isolation

## Global agent credentials

Chezmoi renders custom fields from Bitwarden's `ai-agent-keys` item into private `~/.config/agent-secrets.env`. The managed agent environment loads that file; local overrides belong in `~/.config/agent-env.local.sh`. Global keys are not migrated into fnox.

Linux/WSL uses rbw. After applying the dotfiles, run interactively:

```bash
rbw config set email YOUR_EMAIL
rbw login
rbw unlock
```

Windows uses bw and an exported `BW_SESSION`. If the required vault is unavailable or locked, chezmoi ignores `agent-secrets.env`, preserving any existing file. Unlock and apply again to refresh credentials. This protection deliberately leaves previously rendered keys available; it is not credential revocation.

## Project credentials

Store a Bitwarden item named after the project slug in folder `proj`; use one custom field per environment variable. Commit only references in `fnox.toml`, with `provider = "vault"` on each secret. Use `fnox exec -- COMMAND` to inject values into that child process rather than the parent shell's environment. `fnox check` verifies references and `fnox doctor` diagnoses provider configuration.

## Sandbox boundary

A sandbox receiving the agent environment can read global agent keys. Do not mount the rbw cache, session material, or the workstation's entire home into untrusted containers. Project processes launched through fnox, and their children, can read the injected project credentials. Environment injection is scoped delivery, not a security boundary against those processes or the host account. Never log secret values or commit rendered environment files.

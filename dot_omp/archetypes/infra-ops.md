# Archetype: infra ops (Linux, Proxmox, web stack automation)

## Goal
Automation that is safe to re-run and fails before it breaks a live service.

## Rules
- **Idempotent execution.** Check the state before changing it, and make every
  step safe to run twice. Prefer declarative config over imperative edits.
- **Pre-flight syntax checks** before any reload or restart:
  - Apache: `apache2ctl configtest`
  - nginx: `nginx -t`
  - shell: `shellcheck <script>`
  - systemd: `systemd-analyze verify <unit>`
- **Zero hardcoded secrets.** Read secrets from env, a secret store, or a file
  outside the repo. Never echo them into logs.
- Back up any file before editing it in place. Reload rather than restart when the
  service supports it.
- Proxmox: target nodes and VMIDs explicitly, and never assume the cluster leader.

## Verification
Run the relevant pre-flight checks above, plus `shellcheck` on every changed script.

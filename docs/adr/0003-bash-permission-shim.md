# ADR 0003: Devin-Style Bash Permission Shim for AI Coding Agents

## Status
Accepted (with documented debt)

## Context
Autonomous coding agents (such as omp) need to run shell commands to inspect files, execute builds, and run tests. However:
- Native execution without guardrails risks destructive actions (`rm -rf`, `git reset --hard`, `git push`).
- Prompting for every single `ls` or `git status` creates unbearable friction and breaks unattended runs.
- omp lacks granular, per-command remembered approval rules natively.

## Decision
Implement a layered permission extension (`command-guard`):
1. **Tiered permissions:** `allow` (read-only and safe inspection), `ask` (mutating, network, or destructive operations), `deny` (hard blockers).
2. **Precedence order:** Session -> Project-local -> Project -> User -> Defaults.
3. **Safety invariants:** Never allow path traversal outside workspace; protect agent configuration files; prompt before destructive branch modifications (`git branch -D`).
4. **Threat Model Trade:** Repo-defined auto-allows (`just`, `npm test`, `pytest`) assume trusted workspaces; untrusted repositories should be run inside isolated devcontainers or `omp-sandbox`.

## Consequences
- Frictionless local agent development while guarding against common failure modes.
- Tracked as architectural debt (`docs/debt.md`) until native upstream agent frameworks support granular cached approvals.

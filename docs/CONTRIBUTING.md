# Contributing Guidelines

## Conventional Commits
All commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat(scope): ...` — New features, tools, or templates
- `fix(scope): ...` — Bug fixes or installation adjustments
- `docs(scope): ...` — Documentation updates
- `chore(scope): ...` — Pin bumps, Renovate updates, housekeeping
- `test(scope): ...` — CI checks or test additions

Examples:
- `feat(mise): add opentofu to infra toolset`
- `fix(wsl): handle windows terminal font broadcast timeout`
- `chore(pins): bump mise to 2026.8.0`

## How to Add a Tool

1. Add the tool pin to `.chezmoidata.toml` with a Renovate annotation:
   ```toml
   # renovate: datasource=github-releases depName=owner/repo
   tool_name = "1.2.3"
   ```
2. Add the tool declaration to `dot_config/mise/config.toml.tmpl`:
   ```toml
   "aqua:owner/repo" = "{{ .packages.tool_name }}"
   ```
3. Classify the tool's Renovate tier in `.github/renovate.json`:
   - Low-risk leaf CLIs require no extra rule — they join the weekly `cli-tools-non-major` PR automatically.
   - High-blast-radius bootstrap, prompt, or agent harness tools (like `chezmoi`, `mise`, `oh-my-posh`, `omp`, `t3`, `friend-programmer`) should be added to the isolated `matchPackageNames` rule so every bump gets its own PR.
4. Run verification:
   ```bash
   just test
   ```

## Version & Dependency Update Process

- **Supply-chain gate:** Renovate enforces `minimumReleaseAge: "7 days"` with `internalChecksFilter: "strict"` and `automerge: false` — no release enters a PR until it has aged 7 days, and every bump is human-audited.
- **Tiered weekly PRs (Monday before 06:00):**
  - Low-risk `minor`/`patch` CLI updates amalgamate into a single weekly `cli-tools-non-major` PR.
  - All `major` updates and all high-blast-radius bootstrap/prompt/agent harness updates open as individual PRs for clean changelog review and independent revertability.
- **Pre-merge audit:** PRs that modify `.chezmoidata.toml` or `scripts/bootstrap.sh` automatically run live download reachability checks (`CI_SKIP_NETWORK=0`) in GitHub Actions CI before merge.
- **Restore points:** After auditing, merging, and verifying with `just apply` on a host, tag clean milestones with annotated calver tags (`vYYYY.MM.N`, e.g. `v2026.11.1`).

## Pull Request Process
1. Verify all tests pass locally: `just test`.
2. Ensure PR template checkboxes are completed.

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

1. Add the tool pin to `.chezmoidata.toml` with Renovate annotation:
   ```toml
   # renovate: datasource=github-releases depName=owner/repo
   tool_name = "1.2.3"
   ```
2. Add the tool declaration to `dot_config/mise/config.toml.tmpl`:
   ```toml
   "aqua:owner/repo" = "{{ .packages.tool_name }}"
   ```
3. Run verification:
   ```bash
   just test
   ```

## Pull Request Process
1. Verify all tests pass locally: `just test`.
2. Ensure PR template checkboxes are completed.

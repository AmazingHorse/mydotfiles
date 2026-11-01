# Start or adopt a project

Requires the workstation dotfiles profile, Git, Bash, mise and pinned Copier 9.19.1. Run `just apply` in mydotfiles and `mise install` first. Templates are public: [copier-base](https://github.com/AmazingHorse/copier-base) and [copier-infra-ops](https://github.com/AmazingHorse/copier-infra-ops), initially released as `v0.1.0`.

## New project

```bash
just -g new ~/projects/example --archetype infra-ops
```

The destination must be absent or empty. This initializes Git, renders the base underlay, then the optional archetype. It uses defaults; infra-ops selects Ansible initially. To select OpenTofu or both, edit the `iac` answer in `.copier-answers.infra-ops.yml` and update that layer with Copier after committing the generated project. No tool installation, hooks, vault lookup or live operation runs during generation. Review the files, commit them, then run `just setup` and `just check`.

Copier normally chooses the newest stable template tag. Pin a reproducible rendering with `--ref v0.1.0`. The same ref applies to every selected layer.

## Existing project

```bash
just -g adopt ~/projects/existing --archetype infra-ops
```

Commit or back up the project first. Existing README, project recipes, project agent context, sandbox, permissions and `fnox.toml` survive adoption. Copier asks about other collisions: review them instead of blindly overwriting. Move project-specific recipes into `project.just` before adopting if replacing an existing root justfile. Do not run `setup` until you review the merged files.

`CLAUDE.md` is a relative link to `AGENTS.md`. On Windows, enable Developer Mode or use WSL so Git/Copier can preserve symlinks.

## Company configuration

```bash
just -g new ~/projects/example --archetype infra-ops --company example-org
```

The company sets the base Bitwarden folder and profile, then adds a private third layer from `gh:example-org/copier-company`. That repository must already exist and be accessible. Override its source with `COPIER_COMPANY_URL`. It must not claim base/archetype-owned files. On Linux/WSL the base uses `rbw`; on Windows it uses `bw`.

## Template updates

```bash
just -g sync-template ~/projects/example
```

Requires a clean Git worktree. Updates present `.copier-answers.base.yml`, `.copier-answers.infra-ops.yml` and `.copier-answers.company.yml` layers in order without re-asking answered questions. Each changed layer is committed as `chore(template): update <layer> layer` so the next layer sees a clean tree; stops on merge conflicts or `.rej` files. Pass `--ref` when testing a specific tag or branch across the selected layers.

## Template development

```bash
just -g dev-clone
export COPIER_BASE_URL=~/projects/templates/copier-base
export COPIER_INFRA_OPS_URL=~/projects/templates/copier-infra-ops
just -g new ~/projects/example-dev --archetype infra-ops --ref HEAD
```

Clones missing template repositories under `~/projects/templates` without resetting existing clones. Local overrides use `COPIER_BASE_URL` and `COPIER_INFRA_OPS_URL`; without `--ref HEAD`, Copier still prefers stable tags. Commit template changes before rendering. Test each repository with `bash tests/render.sh` after installing its tools with `mise install`.

## Ownership and secrets

| Layer | Owns |
|---|---|
| `copier-base` | `justfile`, `.config/just/base.just`, `mise.toml`, `.config/fnox/provider.toml`, `AGENTS.md`, `CLAUDE.md`, `.pre-commit-config.yaml`, `.github/workflows/ci.yml`, `.github/pull_request_template.md`, `.gitignore`, `.editorconfig`, `CONTRIBUTING.md`, `docs/adr/0000-template.md`, `docs/debt.md` |
| `copier-infra-ops` | `archetype.just`, `.config/mise/conf.d/infra-ops.toml`, `.agents/archetype.md`, `.agents/skills/infra-ops-*`, `ansible/*`, `opentofu/.gitignore`, `docs/runbooks/README.md` |
| Project (`_skip_if_exists`) | `README.md`, `project.just`, `fnox.toml`, `.agents/project.md`, `.agents/sandbox.toml`, `.omp/permissions.json` |

Git stores only secret references in `fnox.toml`, using `{ provider = "vault", value = "<project_slug>/<ENV_VAR>" }`. Values live in Bitwarden folder `proj` or the company folder, under an item named after the project slug, with one custom field per environment variable. `just check` stays offline and secret-free; live commands use `fnox exec --`.

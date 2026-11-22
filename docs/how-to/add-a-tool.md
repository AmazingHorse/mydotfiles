# How-To: Add a Tool

Step-by-step checklist to introduce a new CLI tool to mydotfiles.

## 1. Check if the tool is supported by mise / aqua
Mise supports `aqua:`, `github:`, `npm:`, `cargo:`, and `go:` backends.
Search the aqua registry:
```bash
mise registry | grep <tool>
```

## 2. Add version pin to `.chezmoidata.toml`
Open `.chezmoidata.toml` and add the pin with a Renovate comment:
```toml
# renovate: datasource=github-releases depName=owner/repo
mytool = "1.0.0"
```

## 3. Declare tool in `dot_config/mise/config.toml.tmpl`
Add the tool entry under `[tools]`:
```toml
"aqua:owner/repo" = "{{ .packages.mytool }}"
```
If the tool belongs to an optional profile or toolset (e.g. `infra` or `containers`), wrap it in a template condition:
```gotemplate
{{ if .toolsets.infra -}}
"aqua:owner/repo" = "{{ .packages.mytool }}"
{{ end -}}
```

## 4. Check Renovate grouping tier
Review `.github/renovate.json`:
- Low-risk leaf CLIs need no config change — their `minor`/`patch` bumps join the weekly `cli-tools-non-major` batch automatically (and `major` bumps stay isolated).
- High-blast-radius bootstrap, prompt, or agent harness tools (e.g. `chezmoi`, `mise`, `oh-my-posh`, `omp`, `t3`, `friend-programmer`) should be added to the isolated `matchPackageNames` rule so each bump opens its own PR.
- If the tool has a direct download or npm URL tested in `scripts/ci-check.sh`, add its pin and reachability check there too.

## 5. Run verification
Run local CI checks:
```bash
just test
```
If the tool renders cleanly in `mise-config.toml` and passes reachability checks, test passes!

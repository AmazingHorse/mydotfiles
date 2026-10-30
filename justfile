# Cross-platform task runner for this checkout (not applied into $HOME).
# Install the pinned `just` binary via bootstrap / chezmoi apply, then:
#   just            # list recipes
#   just check      # CI checks (needs bash + chezmoi)
#   just apply      # chezmoi apply
#
# Windows recipes use PowerShell; Unix recipes use bash. Do not force bash
# globally — that breaks `just` on PATH under PowerShell.

set windows-shell := ["pwsh", "-NoLogo", "-Command"]
set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

# Run the full CI / local validation suite (bash required; use Git Bash or WSL).
check:
    bash ./scripts/ci-check.sh

# Alias test to check
test: check

# Run CI check skipping network reachability
test-fast:
    CI_SKIP_NETWORK=1 bash ./scripts/ci-check.sh

# Render agent core rules into agent/cursor-user-rules.md
render-rules:
    chezmoi execute-template --source={{justfile_directory()}} '{{ "{{" }} includeTemplate "agent-core.md" . {{ "}}" }}' > {{justfile_directory()}}/agent/cursor-user-rules.md

# Initialize or regenerate chezmoi configuration from .chezmoi.toml.tmpl
init:
    chezmoi init --source={{justfile_directory()}}

# Apply managed dotfiles from this source.
apply:
    chezmoi apply --source={{justfile_directory()}}

# Preview destination changes without writing.
diff:
    chezmoi diff --source={{justfile_directory()}}

# Pull latest source commits, then apply.
update:
    chezmoi update --init --source={{justfile_directory()}}

# Print the in-shell cheat sheet if present.
[unix]
dots:
    #!/usr/bin/env bash
    set -euo pipefail
    cheatsheet="${HOME}/.config/mydotfiles/cheatsheet"
    if [[ -f "${cheatsheet}" ]]; then
        cat "${cheatsheet}"
    else
        echo "cheatsheet missing; run: just apply" >&2
        exit 1
    fi

[windows]
dots:
    #!pwsh
    $CheatsheetPath = Join-Path $HOME '.config\mydotfiles\cheatsheet'
    if (-not (Test-Path -LiteralPath $CheatsheetPath)) {
        Write-Error 'cheatsheet missing; run: just apply'
        exit 1
    }
    Get-Content -LiteralPath $CheatsheetPath

# Clean temporary scratch workspace while preserving empty directory structure.
[unix]
clean:
    find .scratch -mindepth 1 ! -name '.gitkeep' -delete 2>/dev/null || true
    mkdir -p .scratch
    touch .scratch/.gitkeep

[windows]
clean:
    #!pwsh
    if (Test-Path '.scratch') {
        Get-ChildItem -Path '.scratch' -Exclude '.gitkeep' -Force | Remove-Item -Recurse -Force
    } else {
        New-Item -ItemType Directory -Path '.scratch' -Force | Out-Null
    }
    if (-not (Test-Path '.scratch\.gitkeep')) {
        New-Item -ItemType File -Path '.scratch\.gitkeep' -Force | Out-Null
    }

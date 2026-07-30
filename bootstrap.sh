#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${DOTFILES_REPO_URL:-https://github.com/AmazingHorse/mydotfiles.git}"
SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_SETUP_SSH=0

for argument in "$@"; do
    case "$argument" in
        --ssh)
            RUN_SETUP_SSH=1
            ;;
        -h|--help)
            cat <<'EOF'
Usage: bootstrap.sh [--ssh]

  Installs chezmoi if needed, then init/apply or update this dotfiles repo.
  Pass --ssh to also run the lean setup-ssh helper afterward.
EOF
            exit 0
            ;;
        *)
            echo "Unknown argument: $argument" >&2
            exit 1
            ;;
    esac
done

install_chezmoi() {
    if command -v chezmoi >/dev/null 2>&1; then
        return
    fi

    echo "Installing chezmoi..."
    sh -c "$(curl -fsLS https://get.chezmoi.io)" -- -b "$HOME/.local/bin"
    export PATH="$HOME/.local/bin:$PATH"
}

if [ -n "${XDG_RUNTIME_DIR:-}" ] &&
    { [ ! -d "${XDG_RUNTIME_DIR}" ] || [ ! -w "${XDG_RUNTIME_DIR}" ]; }; then
    unset XDG_RUNTIME_DIR
fi

install_chezmoi

if [ -f "$SCRIPT_DIRECTORY/dot_zshrc" ] && [ -f "$SCRIPT_DIRECTORY/.chezmoiignore" ]; then
    echo "Using local checkout: $SCRIPT_DIRECTORY"
    chezmoi init --source="$SCRIPT_DIRECTORY"
    chezmoi apply --source="$SCRIPT_DIRECTORY"
elif [ -d "$HOME/.local/share/chezmoi/.git" ]; then
    echo "Updating existing chezmoi source..."
    chezmoi update --init
else
    echo "Initializing from $REPO_URL"
    chezmoi init --apply "$REPO_URL"
fi

if [ "$RUN_SETUP_SSH" -eq 1 ]; then
    if [ -f "$SCRIPT_DIRECTORY/setup-ssh.sh" ]; then
        bash "$SCRIPT_DIRECTORY/setup-ssh.sh"
    elif [ -f "$HOME/.local/share/chezmoi/setup-ssh.sh" ]; then
        bash "$HOME/.local/share/chezmoi/setup-ssh.sh"
    else
        echo "setup-ssh.sh not found." >&2
        exit 1
    fi
fi

echo "Done. Open a new shell or run: exec zsh"

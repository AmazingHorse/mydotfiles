#!/usr/bin/env bash
set -euo pipefail

# Lean SSH helper: create a local Ed25519 key if missing, then print or upload the public key.
# Password-manager SSH agents (1Password/Bitwarden) are intentionally not wired here yet.

ssh_directory="${HOME}/.ssh"
private_key_path="${ssh_directory}/id_ed25519"
public_key_path="${private_key_path}.pub"
upload_with_gh=0

for argument in "$@"; do
    case "$argument" in
        --gh)
            upload_with_gh=1
            ;;
        -h|--help)
            cat <<'EOF'
Usage: setup-ssh.sh [--gh]

  Creates ~/.ssh/id_ed25519 when missing.
  Prints the public key path and contents.
  With --gh, uploads via `gh ssh-key add` when authenticated.
EOF
            exit 0
            ;;
        *)
            echo "Unknown argument: $argument" >&2
            exit 1
            ;;
    esac
done

mkdir -p "$ssh_directory"
chmod 700 "$ssh_directory"

if [ ! -f "$private_key_path" ]; then
    key_comment="${USER}@$(hostname -s 2>/dev/null || hostname)"
    ssh-keygen -t ed25519 -a 100 -f "$private_key_path" -C "$key_comment" -N ""
    echo "Created ${private_key_path}"
else
    echo "Key already exists: ${private_key_path}"
fi

chmod 600 "$private_key_path" 2>/dev/null || true
chmod 644 "$public_key_path" 2>/dev/null || true

echo "Public key: ${public_key_path}"
cat "$public_key_path"

if [ "$upload_with_gh" -eq 1 ]; then
    if ! command -v gh >/dev/null 2>&1; then
        echo "gh not found. Install GitHub CLI, then re-run with --gh." >&2
        exit 1
    fi
    if ! gh auth status >/dev/null 2>&1; then
        echo "gh is not authenticated. Run: gh auth login" >&2
        exit 1
    fi
    key_title="$(hostname -s 2>/dev/null || hostname)-$(date +%Y%m%d)"
    gh ssh-key add "$public_key_path" --title "$key_title"
    echo "Uploaded public key to GitHub as ${key_title}"
else
    cat <<EOF

Next steps:
  gh auth login
  $(basename "$0") --gh
  # or paste the public key into GitHub → Settings → SSH keys
EOF
fi

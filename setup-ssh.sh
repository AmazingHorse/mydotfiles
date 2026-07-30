#!/usr/bin/env bash
set -euo pipefail

# Lean SSH helper: create a local Ed25519 key if missing, then print or install the public key.
# Password-manager SSH agents (1Password/Bitwarden) are intentionally not wired here yet.

ssh_directory="${HOME}/.ssh"
private_key_path="${ssh_directory}/id_ed25519"
public_key_path="${private_key_path}.pub"
upload_with_gh=0
upload_with_gl=0
copy_targets=()

while [ "$#" -gt 0 ]; do
    case "$1" in
        --gh)
            upload_with_gh=1
            shift
            ;;
        --gl)
            upload_with_gl=1
            shift
            ;;
        --copy)
            if [ "$#" -lt 2 ]; then
                echo "Usage: setup-ssh.sh --copy <host-or-alias>" >&2
                exit 1
            fi
            copy_targets+=("$2")
            shift 2
            ;;
        --copy=*)
            copy_targets+=("${1#--copy=}")
            shift
            ;;
        -h|--help)
            cat <<'EOF'
Usage: setup-ssh.sh [--gh] [--gl] [--copy <host-or-alias>]...

  Creates ~/.ssh/id_ed25519 when missing.
  Prints the public key path and contents.
  With --gh, uploads via `gh ssh-key add` when authenticated.
  With --gl, uploads via `glab ssh-key add` when authenticated.
  With --copy, installs the public key on a remote host/alias
  using ssh-copy-id when available, otherwise a portable SSH append.
EOF
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
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

key_title="$(hostname -s 2>/dev/null || hostname)-$(date +%Y%m%d)"

install_public_key_on_host() {
    local target_host="$1"
    local public_key_contents
    public_key_contents="$(tr -d '\r\n' < "$public_key_path")"

    if command -v ssh-copy-id >/dev/null 2>&1; then
        ssh-copy-id -i "$public_key_path" "$target_host"
        return
    fi

    # Portable fallback for hosts without ssh-copy-id (common on Windows/minimal images).
    # shellcheck disable=SC2029
    ssh "$target_host" "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF '${public_key_contents}' ~/.ssh/authorized_keys || printf '%s\n' '${public_key_contents}' >> ~/.ssh/authorized_keys"
}

if [ "$upload_with_gh" -eq 1 ]; then
    if ! command -v gh >/dev/null 2>&1; then
        echo "gh not found. Install GitHub CLI, then re-run with --gh." >&2
        exit 1
    fi
    if ! gh auth status >/dev/null 2>&1; then
        echo "gh is not authenticated. Run: gh auth login" >&2
        exit 1
    fi
    gh ssh-key add "$public_key_path" --title "$key_title"
    echo "Uploaded public key to GitHub as ${key_title}"
fi

if [ "$upload_with_gl" -eq 1 ]; then
    if ! command -v glab >/dev/null 2>&1; then
        echo "glab not found. Install GitLab CLI, then re-run with --gl." >&2
        exit 1
    fi
    if ! glab auth status >/dev/null 2>&1; then
        echo "glab is not authenticated. Run: glab auth login" >&2
        exit 1
    fi
    glab ssh-key add "$public_key_path" -t "$key_title"
    echo "Uploaded public key to GitLab as ${key_title}"
fi

for copy_target in "${copy_targets[@]+"${copy_targets[@]}"}"; do
    echo "Installing public key on ${copy_target}..."
    install_public_key_on_host "$copy_target"
    echo "Installed public key on ${copy_target}"
done

if [ "$upload_with_gh" -eq 0 ] && [ "$upload_with_gl" -eq 0 ] && [ "${#copy_targets[@]}" -eq 0 ]; then
    cat <<EOF

Next steps:
  gh auth login
  glab auth login
  $(basename "$0") --gh --gl
  $(basename "$0") --copy ansible.gbtel.ca
EOF
fi

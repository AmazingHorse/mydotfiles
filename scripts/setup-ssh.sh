#!/usr/bin/env bash
set -euo pipefail

# Lean SSH helper: create a local Ed25519 key if missing, then print or install the public key.
# Password-manager SSH agents (1Password/Bitwarden) are intentionally not wired here yet.

ssh_directory="${HOME}/.ssh"
private_key_path="${ssh_directory}/id_ed25519"
upload_with_gh=0
upload_with_gl=0
custom_title=""
ssh_port=""
force_overwrite=0
copy_targets=()
expand_identity_path() {
    local raw_path="$1"
    # shellcheck disable=SC2088 # Match literal user input; expand it below.
    case "${raw_path}" in
        '~'|'~/'*)
            printf '%s\n' "${HOME}${raw_path:1}"
            ;;
        *)
            printf '%s\n' "${raw_path}"
            ;;
    esac
}
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
        -i|--identity)
            if [ "$#" -lt 2 ]; then
                echo "Usage: setup-ssh.sh -i <private-key-path>" >&2
                exit 1
            fi
            private_key_path="$(expand_identity_path "$2")"
            shift 2
            ;;
        --identity=*)
            private_key_path="$(expand_identity_path "${1#--identity=}")"
            shift
            ;;
        -p|--port)
            if [ "$#" -lt 2 ]; then
                echo "Usage: setup-ssh.sh -p <port>" >&2
                exit 1
            fi
            ssh_port="$2"
            shift 2
            ;;
        --port=*)
            ssh_port="${1#--port=}"
            shift
            ;;
        -t|--title)
            if [ "$#" -lt 2 ]; then
                echo "Usage: setup-ssh.sh -t <title>" >&2
                exit 1
            fi
            custom_title="$2"
            shift 2
            ;;
        --title=*)
            custom_title="${1#--title=}"
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
        -f|--force)
            force_overwrite=1
            shift
            ;;
        --)
            shift
            while [ "$#" -gt 0 ]; do
                copy_targets+=("$1")
                shift
            done
            break
            ;;
        -h|--help)
            cat <<'EOF'
Usage: setup-ssh.sh [-i <private-key>] [-p <port>] [-f] [--gh] [--gl] [--copy <host>] [host...]

Cross-platform SSH key helper and ssh-copy-id shim.

  host...                 Remote hosts/aliases to copy the public key to (like ssh-copy-id)
  -i, --identity <path>   Use/create that key instead of default (~/.ssh/id_ed25519)
  -f, --force             Overwrite/regenerate key if it already exists (backs up first)
  -p, --port <port>       SSH port to connect to on target host(s)
  -t, --title <title>     Custom title for GitHub/GitLab keys
  --gh                    Upload public key via `gh ssh-key add`
  --gl                    Upload public key via `glab ssh-key add`
  --copy <host>           Alternative syntax for target host(s)
EOF
            exit 0
            ;;
        -*)
            echo "Unknown option: $1" >&2
            echo "Run 'setup-ssh.sh --help' for usage." >&2
            exit 1
            ;;
        *)
            # Positional argument: treat as target host (ssh-copy-id style)
            copy_targets+=("$1")
            shift
            ;;
    esac
done
# Accept either the private key path or its .pub sibling.
case "${private_key_path}" in
    *.pub)
        private_key_path="${private_key_path%.pub}"
        ;;
esac

public_key_path="${private_key_path}.pub"
key_basename="$(basename "${private_key_path}")"
key_parent_directory="$(dirname "${private_key_path}")"

mkdir -p "${key_parent_directory}"
chmod 700 "${ssh_directory}" 2>/dev/null || true
if [ "${key_parent_directory}" != "${ssh_directory}" ]; then
    chmod 700 "${key_parent_directory}" 2>/dev/null || true
fi

if [ "${force_overwrite}" -eq 1 ] && [ -f "${private_key_path}" ]; then
    backup_timestamp="$(date +%Y%m%d%H%M%S)"
    echo "Backing up existing key to ${private_key_path}.bak.${backup_timestamp}..."
    cp -a "${private_key_path}" "${private_key_path}.bak.${backup_timestamp}"
    if [ -f "${public_key_path}" ]; then
        cp -a "${public_key_path}" "${public_key_path}.bak.${backup_timestamp}"
    fi
    rm -f "${private_key_path}" "${public_key_path}"
fi

if [ -f "${private_key_path}" ]; then
    echo "Using existing key: ${private_key_path}"
    if command -v ssh-keygen >/dev/null 2>&1; then
        if ! ssh-keygen -y -P "" -f "${private_key_path}" >/dev/null 2>&1; then
            echo "Notice: ${private_key_path} is encrypted with a passphrase." >&2
            echo "To replace it with an unencrypted key, re-run with: -f (or --force)" >&2
        fi
    fi
elif [ -f "${public_key_path}" ] && [ "${force_overwrite}" -eq 0 ]; then
    echo "Public key exists but private key missing: ${public_key_path}" >&2
    echo "To regenerate, re-run with: -f (or --force)" >&2
    exit 1
else
    key_comment="${USER}@$(hostname -s 2>/dev/null || hostname)"
    if [ "${key_basename}" != 'id_ed25519' ]; then
        key_comment="${key_comment}-${key_basename}"
    fi
    ssh-keygen -t ed25519 -a 100 -f "${private_key_path}" -C "${key_comment}" -N ""
    echo "Created new key (no passphrase): ${private_key_path}"
fi

chmod 600 "${private_key_path}" 2>/dev/null || true
chmod 644 "${public_key_path}" 2>/dev/null || true

echo "Public key: ${public_key_path}"
cat "${public_key_path}"

host_label="$(hostname -s 2>/dev/null || hostname)"
date_label="$(date +%Y%m%d)"
if [ -n "${custom_title}" ]; then
    key_title="${custom_title}"
elif [ "${key_basename}" = 'id_ed25519' ]; then
    key_title="${host_label}-${date_label}"
else
    key_title="${host_label}-${key_basename}-${date_label}"
fi

install_public_key_on_host() {
    local target_host="$1"
    local public_key_contents
    public_key_contents="$(tr -d '\r\n' < "${public_key_path}")"

    local port_args=()
    if [ -n "${ssh_port}" ]; then
        port_args=("-p" "${ssh_port}")
    fi

    if command -v ssh-copy-id >/dev/null 2>&1; then
        ssh-copy-id ${port_args[@]+"${port_args[@]}"} -i "${public_key_path}" "${target_host}"
        return
    fi

    # Portable fallback for hosts without ssh-copy-id (common on Windows/minimal images).
    # shellcheck disable=SC2029
    ssh ${port_args[@]+"${port_args[@]}"} "${target_host}" "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF '${public_key_contents}' ~/.ssh/authorized_keys || printf '%s\n' '${public_key_contents}' >> ~/.ssh/authorized_keys"
}

if [ "${upload_with_gh}" -eq 1 ]; then
    if ! command -v gh >/dev/null 2>&1; then
        echo "gh not found. Install GitHub CLI, then re-run with --gh." >&2
        exit 1
    fi
    if ! gh auth status >/dev/null 2>&1; then
        echo "gh is not authenticated. Run: gh auth login" >&2
        exit 1
    fi
    gh ssh-key add "${public_key_path}" --title "${key_title}"
    echo "Uploaded public key to GitHub as ${key_title}"
fi

if [ "${upload_with_gl}" -eq 1 ]; then
    if ! command -v glab >/dev/null 2>&1; then
        echo "glab not found. Install GitLab CLI, then re-run with --gl." >&2
        exit 1
    fi
    if ! glab auth status >/dev/null 2>&1; then
        echo "glab is not authenticated. Run: glab auth login" >&2
        exit 1
    fi
    glab ssh-key add "${public_key_path}" -t "${key_title}"
    echo "Uploaded public key to GitLab as ${key_title}"
fi

for copy_target in "${copy_targets[@]+"${copy_targets[@]}"}"; do
    echo "Installing public key on ${copy_target}..."
    install_public_key_on_host "${copy_target}"
    echo "Installed public key on ${copy_target}"
done

if [ "${upload_with_gh}" -eq 0 ] && [ "${upload_with_gl}" -eq 0 ] && [ "${#copy_targets[@]}" -eq 0 ]; then
    cat <<EOF

Next steps:
  gh auth login
  glab auth login
  $(basename "$0") --gh --gl
  $(basename "$0") user@host                     # copy key to host (ssh-copy-id)
  $(basename "$0") -i ~/.ssh/other_key user@host # copy specific key to host
EOF
fi

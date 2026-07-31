#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${DOTFILES_REPO_URL:-https://github.com/AmazingHorse/mydotfiles.git}"
SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_SETUP_SSH=0
DEFAULT_CHEZMOI_VERSION='2.71.1'

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

read_pinned_chezmoi_version() {
    local data_file="${SCRIPT_DIRECTORY}/.chezmoidata.toml"
    if [ -f "${data_file}" ]; then
        awk -F'"' '/^chezmoi[[:space:]]*=/ { print $2; exit }' "${data_file}"
        return 0
    fi
    printf '%s\n' "${DEFAULT_CHEZMOI_VERSION}"
}

download_with_retries() {
    local destination_path="$1"
    local source_url="$2"
    local attempt=1
    local partial_path="${destination_path}.partial"

    while [ "${attempt}" -le 5 ]; do
        echo "Downloading ${source_url} (attempt ${attempt}/5)..."
        if curl \
            --fail \
            --location \
            --connect-timeout 20 \
            --max-time 300 \
            --output "${partial_path}" \
            "${source_url}"; then
            mv "${partial_path}" "${destination_path}"
            return 0
        fi
        rm -f "${partial_path}"
        attempt=$((attempt + 1))
        sleep 2
    done

    echo "Failed to download ${source_url} after 5 attempts." >&2
    return 1
}

verify_sha256() {
    local archive_path="$1"
    local checksums_path="$2"
    local archive_basename
    local expected_hash
    local actual_hash

    archive_basename="$(basename "${archive_path}")"
    expected_hash="$(
        grep -E "[[:space:]]${archive_basename}\$" "${checksums_path}" |
            awk '{ print $1 }' |
            head -n1
    )"
    if [ -z "${expected_hash}" ]; then
        echo "No checksum entry for ${archive_basename}." >&2
        return 1
    fi

    if command -v sha256sum >/dev/null 2>&1; then
        actual_hash="$(sha256sum "${archive_path}" | awk '{ print $1 }')"
    elif command -v shasum >/dev/null 2>&1; then
        actual_hash="$(shasum -a 256 "${archive_path}" | awk '{ print $1 }')"
    else
        echo "sha256sum/shasum not found; cannot verify chezmoi download." >&2
        return 1
    fi

    if [ "${actual_hash}" != "${expected_hash}" ]; then
        echo "Checksum mismatch for ${archive_basename}." >&2
        echo "expected ${expected_hash}" >&2
        echo "got      ${actual_hash}" >&2
        return 1
    fi
}

host_uses_musl() {
    [ -e /lib/ld-musl-x86_64.so.1 ] ||
        [ -e /lib/libc.musl-x86_64.so.1 ] ||
        [ -e /lib/ld-musl-aarch64.so.1 ]
}

# Chezmoi glibc amd64 builds ship from Ubuntu 22.04+ runners and need
# GLIBC_2.32/2.34. Ubuntu 20.04 (glibc 2.31) and older must use musl.
host_glibc_supports_chezmoi_glibc_build() {
    local glibc_version=''
    if command -v ldd >/dev/null 2>&1; then
        glibc_version="$(ldd --version 2>&1 | awk 'NR==1 { print $NF; exit }')"
    fi
    if [ -z "${glibc_version}" ]; then
        return 1
    fi

    local lowest_version
    lowest_version="$(printf '%s\n%s\n' "${glibc_version}" '2.32' | sort -V | head -n1)"
    [ "${lowest_version}" = '2.32' ]
}

resolve_chezmoi_asset_name() {
    local pinned_version="$1"
    local architecture
    architecture="$(uname -m)"

    case "${architecture}" in
        x86_64|amd64)
            if host_uses_musl || ! host_glibc_supports_chezmoi_glibc_build; then
                printf 'chezmoi_%s_linux-musl_amd64.tar.gz\n' "${pinned_version}"
            else
                printf 'chezmoi_%s_linux-glibc_amd64.tar.gz\n' "${pinned_version}"
            fi
            ;;
        aarch64|arm64)
            printf 'chezmoi_%s_linux_arm64.tar.gz\n' "${pinned_version}"
            ;;
        *)
            echo "Unsupported architecture for chezmoi install: ${architecture}" >&2
            return 1
            ;;
    esac
}

install_chezmoi() {
    local install_directory="${HOME}/.local/bin"
    export PATH="${install_directory}:${PATH}"

    local pinned_version
    pinned_version="$(read_pinned_chezmoi_version)"
    if [ -z "${pinned_version}" ]; then
        pinned_version="${DEFAULT_CHEZMOI_VERSION}"
    fi

    if command -v chezmoi >/dev/null 2>&1; then
        local installed_version
        installed_version="$(chezmoi --version 2>/dev/null | head -n1 || true)"
        if [[ "${installed_version}" == *"v${pinned_version}"* ]] ||
            [[ "${installed_version}" == *" ${pinned_version}"* ]]; then
            echo "chezmoi already at pinned version ${pinned_version}"
            return 0
        fi
        echo "chezmoi ${installed_version:-unknown} does not match pin ${pinned_version}; reinstalling..."
    fi

    if ! command -v curl >/dev/null 2>&1; then
        echo "curl is required to install chezmoi." >&2
        exit 1
    fi
    if ! command -v tar >/dev/null 2>&1; then
        echo "tar is required to install chezmoi." >&2
        exit 1
    fi

    local cache_directory="${HOME}/.cache/mydotfiles/downloads"
    local work_directory
    local asset_name
    local archive_path
    local checksums_path
    local release_base
    local extracted_binary

    mkdir -p "${install_directory}" "${cache_directory}"
    work_directory="$(mktemp -d "${cache_directory}/chezmoi.XXXXXX")"
    cleanup_chezmoi_work() {
        rm -rf "${work_directory}"
    }
    trap cleanup_chezmoi_work EXIT

    asset_name="$(resolve_chezmoi_asset_name "${pinned_version}")"
    archive_path="${work_directory}/${asset_name}"
    checksums_path="${work_directory}/chezmoi_${pinned_version}_checksums.txt"
    release_base="https://github.com/twpayne/chezmoi/releases/download/v${pinned_version}"

    echo "Installing pinned chezmoi ${pinned_version} (${asset_name})..."
    download_with_retries "${checksums_path}" "${release_base}/chezmoi_${pinned_version}_checksums.txt"
    download_with_retries "${archive_path}" "${release_base}/${asset_name}"
    verify_sha256 "${archive_path}" "${checksums_path}"

    tar -xzf "${archive_path}" -C "${work_directory}"
    extracted_binary="${work_directory}/chezmoi"
    if [ ! -x "${extracted_binary}" ]; then
        echo "chezmoi binary missing from ${asset_name}." >&2
        exit 1
    fi

    if ! "${extracted_binary}" --version >/dev/null 2>&1; then
        echo "Downloaded ${asset_name} is not runnable on this host (often GLIBC_2.32/2.34)." >&2
        if [[ "${asset_name}" == *linux-glibc_amd64* ]]; then
            echo "Retrying with statically linked musl build..." >&2
            asset_name="chezmoi_${pinned_version}_linux-musl_amd64.tar.gz"
            archive_path="${work_directory}/${asset_name}"
            download_with_retries "${archive_path}" "${release_base}/${asset_name}"
            verify_sha256 "${archive_path}" "${checksums_path}"
            tar -xzf "${archive_path}" -C "${work_directory}"
            if ! "${extracted_binary}" --version >/dev/null 2>&1; then
                echo "musl chezmoi binary is also not runnable." >&2
                exit 1
            fi
        else
            exit 1
        fi
    fi

    mv "${extracted_binary}" "${install_directory}/chezmoi"
    chmod 755 "${install_directory}/chezmoi"

    if ! command -v chezmoi >/dev/null 2>&1; then
        echo "chezmoi installed to ${install_directory}/chezmoi but is not on PATH." >&2
        exit 1
    fi

    echo "chezmoi $(chezmoi --version | head -n1) installed to ${install_directory}/chezmoi"
    trap - EXIT
    cleanup_chezmoi_work
}

sanitize_runtime_directory() {
    if [ -n "${XDG_RUNTIME_DIR:-}" ] &&
        { [ ! -d "${XDG_RUNTIME_DIR}" ] || [ ! -w "${XDG_RUNTIME_DIR}" ]; }; then
        unset XDG_RUNTIME_DIR
    fi
}

wait_for_systemd_if_needed() {
    if [ ! -d /run/systemd/system ]; then
        return 0
    fi

    if ! command -v systemctl >/dev/null 2>&1; then
        return 0
    fi

    local state
    state="$(systemctl is-system-running 2>/dev/null || true)"
    case "${state}" in
        running|degraded)
            return 0
            ;;
    esac

    echo "Waiting for systemd to finish starting (current: ${state:-unknown})..."
    if command -v timeout >/dev/null 2>&1; then
        timeout 90 systemctl is-system-running --wait >/dev/null 2>&1 || true
    else
        local attempt=0
        while [ "${attempt}" -lt 45 ]; do
            state="$(systemctl is-system-running 2>/dev/null || true)"
            case "${state}" in
                running|degraded)
                    return 0
                    ;;
            esac
            sleep 2
            attempt=$((attempt + 1))
        done
    fi

    state="$(systemctl is-system-running 2>/dev/null || true)"
    case "${state}" in
        running|degraded)
            ;;
        *)
            echo "Continuing with systemd state '${state:-unknown}'." >&2
            ;;
    esac
}

sanitize_runtime_directory
wait_for_systemd_if_needed
# User session / runtime dir may appear only after systemd is ready.
sanitize_runtime_directory

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

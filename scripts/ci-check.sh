#!/usr/bin/env bash
# Local/CI checks for template render, shell syntax, and pin reachability.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repository_root}"

if ! command -v chezmoi >/dev/null 2>&1; then
    echo "chezmoi is required for CI checks." >&2
    exit 1
fi

echo "==> Shell syntax"
bash -n bootstrap.sh
bash -n setup-ssh.sh
bash -n dot_local/bin/executable_preferred-editor
bash -n dot_config/shell/helpers.sh

if command -v shellcheck >/dev/null 2>&1; then
    echo "==> shellcheck"
    shellcheck \
        --severity=warning \
        bootstrap.sh \
        setup-ssh.sh \
        dot_local/bin/executable_preferred-editor \
        dot_config/shell/helpers.sh
else
    echo "shellcheck not installed; skipping"
fi

echo "==> Chezmoi dry-run (exclude scripts)"
config_directory="${HOME}/.config/chezmoi"
mkdir -p "${config_directory}"
cat > "${config_directory}/chezmoi.toml" <<'EOF'
umask = 0o022

[data]
gitName = "CI User"
gitEmail = "ci@example.com"
EOF

destination_directory="$(mktemp -d)"
cleanup() {
    rm -rf "${destination_directory}"
}
trap cleanup EXIT

chezmoi apply \
    --dry-run \
    --source="${repository_root}" \
    --destination="${destination_directory}" \
    --exclude=scripts \
    >/dev/null

echo "==> Verify SSH config migration"
rendered_migration_script="${destination_directory}/migrate-ssh-config.sh"
chezmoi execute-template \
    < run_once_before_migrate-ssh-config.sh.tmpl \
    > "${rendered_migration_script}"
bash -n "${rendered_migration_script}"
if command -v shellcheck >/dev/null 2>&1; then
    shellcheck --severity=warning "${rendered_migration_script}"
fi

migration_home="${destination_directory}/migration-home"
mkdir -p "${migration_home}/.ssh"
cat > "${migration_home}/.ssh/config" <<'EOF'
Host legacy-server
    HostName legacy.example.com
    User deploy
    IdentityFile ~/.ssh/id_ed25519
EOF
printf 'private-key-sentinel\n' > "${migration_home}/.ssh/id_ed25519"
cp "${migration_home}/.ssh/config" "${destination_directory}/original-ssh-config"

HOME="${migration_home}" bash "${rendered_migration_script}" >/dev/null

cmp \
    "${destination_directory}/original-ssh-config" \
    "${migration_home}/.ssh/config.pre-chezmoi.bak"
cmp \
    "${destination_directory}/original-ssh-config" \
    "${migration_home}/.ssh/config.d/private.conf"
if [ "$(cat "${migration_home}/.ssh/id_ed25519")" != 'private-key-sentinel' ]; then
    echo "SSH migration modified the existing private key." >&2
    exit 1
fi

echo "==> Verify SSH migration does not recurse managed Include"
recurse_home="${destination_directory}/recurse-home"
mkdir -p "${recurse_home}/.ssh/config.d"
# Simulate CRLF managed config already applied, empty/missing real private hosts.
printf '%s\r\n' \
    '# Private / sensitive hosts first so they win over defaults below.' \
    'Include config.d/*.conf' \
    '' \
    'Host *' \
    '    IdentitiesOnly yes' \
    > "${recurse_home}/.ssh/config"
cp "${recurse_home}/.ssh/config" "${recurse_home}/.ssh/config.d/private.conf"
HOME="${recurse_home}" bash "${rendered_migration_script}" >/dev/null
if grep -Eq '^[[:space:]]*Include[[:space:]].*config\.d' \
    "${recurse_home}/.ssh/config.d/private.conf"; then
    echo "SSH migration left a recursive Include in private.conf" >&2
    exit 1
fi

echo "==> Verify template data"
rendered_identity="$(chezmoi execute-template '{{ .gitName }} <{{ .gitEmail }}>')"
if [ "${rendered_identity}" != 'CI User <ci@example.com>' ]; then
    echo "Unexpected rendered identity: ${rendered_identity}" >&2
    exit 1
fi

# Target-state templates (including .packages from .chezmoidata.toml) are
# already exercised by the dry-run apply above.

echo "==> Verify pinned Oh My Posh release asset"
oh_my_posh_version="$(
    awk -F'"' '/^oh_my_posh[[:space:]]*=/ { print $2; exit }' .chezmoidata.toml
)"
if [ -z "${oh_my_posh_version}" ]; then
    echo "Could not read packages.oh_my_posh from .chezmoidata.toml" >&2
    exit 1
fi

asset_url="https://github.com/JanDeDobbeleer/oh-my-posh/releases/download/v${oh_my_posh_version}/posh-linux-amd64"
http_status="$(curl -fsIL -o /dev/null -w '%{http_code}' "${asset_url}")"
case "${http_status}" in
    200|302) ;;
    *)
        echo "Pinned Oh My Posh asset not reachable (${http_status}): ${asset_url}" >&2
        exit 1
        ;;
esac

echo "==> Verify pinned chezmoi release asset"
chezmoi_version="$(
    awk -F'"' '/^chezmoi[[:space:]]*=/ { print $2; exit }' .chezmoidata.toml
)"
if [ -z "${chezmoi_version}" ]; then
    echo "Could not read packages.chezmoi from .chezmoidata.toml" >&2
    exit 1
fi

chezmoi_checksums_url="https://github.com/twpayne/chezmoi/releases/download/v${chezmoi_version}/chezmoi_${chezmoi_version}_checksums.txt"
chezmoi_glibc_url="https://github.com/twpayne/chezmoi/releases/download/v${chezmoi_version}/chezmoi_${chezmoi_version}_linux-glibc_amd64.tar.gz"
chezmoi_musl_url="https://github.com/twpayne/chezmoi/releases/download/v${chezmoi_version}/chezmoi_${chezmoi_version}_linux-musl_amd64.tar.gz"
for url in "${chezmoi_checksums_url}" "${chezmoi_glibc_url}" "${chezmoi_musl_url}"; do
    http_status="$(curl -fsIL -o /dev/null -w '%{http_code}' "${url}")"
    case "${http_status}" in
        200|302) ;;
        *)
            echo "Pinned chezmoi asset not reachable (${http_status}): ${url}" >&2
            exit 1
            ;;
    esac
done

echo "==> Verify pinned Tier-1 CLI release assets"
read_pin() {
    local pin_name="$1"
    awk -F'"' -v pin_name="${pin_name}" \
        '$0 ~ ("^" pin_name "[[:space:]]*=") { print $2; exit }' .chezmoidata.toml
}

zoxide_version="$(read_pin zoxide)"
ripgrep_version="$(read_pin ripgrep)"
fd_version="$(read_pin fd)"
git_delta_version="$(read_pin git_delta)"
mise_version="$(read_pin mise)"
for required_pin in \
    zoxide_version \
    ripgrep_version \
    fd_version \
    git_delta_version \
    mise_version; do
    if [ -z "${!required_pin}" ]; then
        echo "Could not read packages pin for ${required_pin}" >&2
        exit 1
    fi
done

tier1_urls=(
    "https://github.com/ajeetdsouza/zoxide/releases/download/v${zoxide_version}/zoxide-${zoxide_version}-x86_64-unknown-linux-musl.tar.gz"
    "https://github.com/BurntSushi/ripgrep/releases/download/${ripgrep_version}/ripgrep-${ripgrep_version}-x86_64-unknown-linux-musl.tar.gz"
    "https://github.com/sharkdp/fd/releases/download/v${fd_version}/fd-v${fd_version}-x86_64-unknown-linux-musl.tar.gz"
    "https://github.com/dandavison/delta/releases/download/${git_delta_version}/delta-${git_delta_version}-x86_64-unknown-linux-musl.tar.gz"
    "https://github.com/jdx/mise/releases/download/v${mise_version}/mise-v${mise_version}-linux-x64-musl.tar.gz"
)
for url in "${tier1_urls[@]}"; do
    http_status="$(curl -fsIL -o /dev/null -w '%{http_code}' "${url}")"
    case "${http_status}" in
        200|302) ;;
        *)
            echo "Pinned Tier-1 asset not reachable (${http_status}): ${url}" >&2
            exit 1
            ;;
    esac
done

echo "==> CI checks passed"

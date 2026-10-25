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
bash -n dot_config/shell/wsl-windows-path.sh
sh -n dot_config/shell/wsl-windows-path.sh

if command -v shellcheck >/dev/null 2>&1; then
    echo "==> shellcheck"
    shellcheck \
        --severity=warning \
        bootstrap.sh \
        setup-ssh.sh \
        dot_local/bin/executable_preferred-editor \
        dot_config/shell/helpers.sh \
        dot_config/shell/wsl-windows-path.sh
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

echo "==> Verify WSL interop config"
wsl_interop_directory="${destination_directory}/wsl-interop"
mkdir -p "${wsl_interop_directory}"
wsl_template_override='{"chezmoi":{"os":"linux","kernel":{"osrelease":"5.15.0-microsoft-standard-WSL2"}}}'
native_linux_template_override='{"chezmoi":{"os":"linux","kernel":{"osrelease":"6.8.0-generic"}}}'
rendered_wsl_interop="${wsl_interop_directory}/configure-wsl-interop.sh"
rendered_native_wsl_interop="${wsl_interop_directory}/configure-wsl-interop.native.sh"
chezmoi execute-template --file --source="${repository_root}" \
    --override-data "${wsl_template_override}" \
    "${repository_root}/run_onchange_after_configure-wsl-interop.sh.tmpl" \
    > "${rendered_wsl_interop}"
chezmoi execute-template --file --source="${repository_root}" \
    --override-data "${native_linux_template_override}" \
    "${repository_root}/run_onchange_after_configure-wsl-interop.sh.tmpl" \
    > "${rendered_native_wsl_interop}"
if [ -n "$(tr -d '[:space:]' < "${rendered_native_wsl_interop}")" ]; then
    echo "WSL interop script should render empty on native Linux." >&2
    exit 1
fi
bash -n "${rendered_wsl_interop}"
if command -v shellcheck >/dev/null 2>&1; then
    shellcheck --severity=warning "${rendered_wsl_interop}"
fi

wsl_fixture_directory="${wsl_interop_directory}/fixtures"
mkdir -p "${wsl_fixture_directory}"
run_wsl_interop_fixture() {
    local config_path="$1"
    local output_path="$2"
    MYDOTFILES_WSL_CONF="${config_path}" \
        bash "${rendered_wsl_interop}" > "${output_path}"
}

missing_wsl_conf="${wsl_fixture_directory}/missing/wsl.conf"
mkdir -p "$(dirname "${missing_wsl_conf}")"
printf '[interop]\nappendWindowsPath = false\n' \
    > "${wsl_fixture_directory}/missing.expected"
run_wsl_interop_fixture \
    "${missing_wsl_conf}" \
    "${wsl_fixture_directory}/missing.stdout"
cmp "${wsl_fixture_directory}/missing.expected" "${missing_wsl_conf}"

boot_wsl_conf="${wsl_fixture_directory}/boot-only/wsl.conf"
mkdir -p "$(dirname "${boot_wsl_conf}")"
printf '[boot]\nsystemd=true\n' > "${boot_wsl_conf}"
printf '[boot]\nsystemd=true\n\n[interop]\nappendWindowsPath = false\n' \
    > "${wsl_fixture_directory}/boot-only.expected"
run_wsl_interop_fixture \
    "${boot_wsl_conf}" \
    "${wsl_fixture_directory}/boot-only.stdout"
cmp "${wsl_fixture_directory}/boot-only.expected" "${boot_wsl_conf}"

existing_wsl_conf="${wsl_fixture_directory}/existing-interop/wsl.conf"
mkdir -p "$(dirname "${existing_wsl_conf}")"
printf '[interop]\nappendWindowsPath=true\nenabled=true\n[network]\nhostname=x\n' \
    > "${existing_wsl_conf}"
cp "${existing_wsl_conf}" "${wsl_fixture_directory}/existing-interop.original"
printf '[interop]\nappendWindowsPath = false\nenabled=true\n[network]\nhostname=x\n' \
    > "${wsl_fixture_directory}/existing-interop.expected"
printf "Updated %s: appendWindowsPath = false. Run 'wsl.exe --shutdown' from Windows PowerShell to apply.\n" \
    "${existing_wsl_conf}" > "${wsl_fixture_directory}/existing-interop.stdout.expected"
run_wsl_interop_fixture \
    "${existing_wsl_conf}" \
    "${wsl_fixture_directory}/existing-interop.stdout"
cmp "${wsl_fixture_directory}/existing-interop.expected" "${existing_wsl_conf}"
cmp "${wsl_fixture_directory}/existing-interop.original" \
    "${existing_wsl_conf}.mydotfiles.bak"
cmp "${wsl_fixture_directory}/existing-interop.stdout.expected" \
    "${wsl_fixture_directory}/existing-interop.stdout"
run_wsl_interop_fixture \
    "${existing_wsl_conf}" \
    "${wsl_fixture_directory}/existing-interop.second.stdout"
if [ -s "${wsl_fixture_directory}/existing-interop.second.stdout" ]; then
    echo "Second WSL interop run unexpectedly produced output." >&2
    exit 1
fi
cmp "${wsl_fixture_directory}/existing-interop.expected" "${existing_wsl_conf}"

missing_key_wsl_conf="${wsl_fixture_directory}/missing-key/wsl.conf"
mkdir -p "$(dirname "${missing_key_wsl_conf}")"
printf '[interop]\nenabled=true\n\n[boot]\nsystemd=true\n' \
    > "${missing_key_wsl_conf}"
printf '[interop]\nenabled=true\nappendWindowsPath = false\n\n[boot]\nsystemd=true\n' \
    > "${wsl_fixture_directory}/missing-key.expected"
run_wsl_interop_fixture \
    "${missing_key_wsl_conf}" \
    "${wsl_fixture_directory}/missing-key.stdout"
cmp "${wsl_fixture_directory}/missing-key.expected" "${missing_key_wsl_conf}"

already_false_wsl_conf="${wsl_fixture_directory}/already-false/wsl.conf"
mkdir -p "$(dirname "${already_false_wsl_conf}")"
printf '[interop]\nappendWindowsPath = false\n' > "${already_false_wsl_conf}"
cp "${already_false_wsl_conf}" "${wsl_fixture_directory}/already-false.expected"
run_wsl_interop_fixture \
    "${already_false_wsl_conf}" \
    "${wsl_fixture_directory}/already-false.stdout"
if [ -s "${wsl_fixture_directory}/already-false.stdout" ] ||
    [ -e "${already_false_wsl_conf}.mydotfiles.bak" ]; then
    echo "Unchanged WSL interop config should produce no output or backup." >&2
    exit 1
fi
cmp "${wsl_fixture_directory}/already-false.expected" "${already_false_wsl_conf}"

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
just_version="$(read_pin just)"
for required_pin in \
    zoxide_version \
    ripgrep_version \
    fd_version \
    git_delta_version \
    mise_version \
    just_version; do
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
    "https://github.com/casey/just/releases/download/${just_version}/just-${just_version}-x86_64-unknown-linux-musl.tar.gz"
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

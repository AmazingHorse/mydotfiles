# shellcheck shell=sh
# Unified PATH initialization for login and interactive shells.
# Idempotently prepends managed tool directories in precedence order:
#   1. $HOME/.local/bin               (standalone pinned CLIs: chezmoi, agy, custom bins)
#   2. $HOME/.local/share/mise/shims  (fallback shims for mise-managed CLIs)
#   3. $HOME/bin                      (legacy/user bin directory, if present)

for _dir in "$HOME/bin" "$HOME/.local/share/mise/shims" "$HOME/.local/bin"; do
    if [ -d "$_dir" ]; then
        case ":$PATH:" in
            *":$_dir:"*) ;;
            *) PATH="$_dir:$PATH" ;;
        esac
    fi
done
unset _dir
export PATH

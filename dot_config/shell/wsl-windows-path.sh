# shellcheck shell=sh

if [ -n "${WSL_DISTRO_NAME:-}" ]; then
    _mydotfiles_append_path_end() {
        [ -d "$1" ] || return 0
        case ":${PATH:-}:" in
            *":$1:"*) ;;
            *) PATH="${PATH:+${PATH}:}$1"; export PATH ;;
        esac
    }

    _mydotfiles_append_path_end /mnt/c/Windows/System32

    if [ -n "${XDG_CACHE_HOME:-${HOME:-}}" ]; then
        _mydotfiles_wsl_cache_root="${XDG_CACHE_HOME:-${HOME:-}/.cache}"
        _mydotfiles_wsl_cache_dir="${_mydotfiles_wsl_cache_root}/mydotfiles"
        _mydotfiles_wsl_cache_file="${_mydotfiles_wsl_cache_dir}/windows-localappdata"
        _mydotfiles_wsl_localappdata=""

        if [ -s "${_mydotfiles_wsl_cache_file}" ]; then
            if _mydotfiles_wsl_localappdata="$(cat "${_mydotfiles_wsl_cache_file}" 2>/dev/null)"; then
                :
            else
                _mydotfiles_wsl_localappdata=""
            fi
        elif [ -x /mnt/c/Windows/System32/cmd.exe ]; then
            if _mydotfiles_wsl_localappdata_windows="$(
                (cd /mnt/c && /mnt/c/Windows/System32/cmd.exe /d /c 'echo %LOCALAPPDATA%') 2>/dev/null |
                    tr -d '\r' 2>/dev/null
            )"; then
                :
            else
                _mydotfiles_wsl_localappdata_windows=""
            fi
            if [ -n "${_mydotfiles_wsl_localappdata_windows}" ] &&
                command -v wslpath >/dev/null 2>&1 &&
                _mydotfiles_wsl_localappdata="$(wslpath -u "${_mydotfiles_wsl_localappdata_windows}" 2>/dev/null)" &&
                [ -n "${_mydotfiles_wsl_localappdata}" ] &&
                [ -d "${_mydotfiles_wsl_localappdata}" ]; then
                if mkdir -p "${_mydotfiles_wsl_cache_dir}" 2>/dev/null &&
                    [ -d "${_mydotfiles_wsl_cache_dir}" ]; then
                    printf '%s\n' "${_mydotfiles_wsl_localappdata}" \
                        > "${_mydotfiles_wsl_cache_file}" 2>/dev/null || :
                fi
            else
                _mydotfiles_wsl_localappdata=""
            fi
        fi

        if [ -n "${_mydotfiles_wsl_localappdata}" ]; then
            _mydotfiles_append_path_end "${_mydotfiles_wsl_localappdata}/Programs/cursor/resources/app/bin"
            _mydotfiles_append_path_end "${_mydotfiles_wsl_localappdata}/Programs/Microsoft VS Code/bin"
        fi
    fi

    unset -f _mydotfiles_append_path_end 2>/dev/null || :
    unset _mydotfiles_wsl_cache_root \
        _mydotfiles_wsl_cache_dir \
        _mydotfiles_wsl_cache_file \
        _mydotfiles_wsl_localappdata \
        _mydotfiles_wsl_localappdata_windows 2>/dev/null || :
fi

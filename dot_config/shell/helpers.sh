# Shared interactive shell helpers. Soft-sourced from zshrc/bashrc.
# shellcheck shell=sh disable=SC3043


if command -v preferred-editor >/dev/null 2>&1; then
    export EDITOR="preferred-editor"
    export VISUAL="preferred-editor"
elif [ -z "${EDITOR:-}" ]; then
    export EDITOR="vi"
    export VISUAL="vi"
fi

export PAGER="${PAGER:-less}"
export LESS="${LESS:--FRX}"

if [ -f "$HOME/.config/ripgrep/config" ]; then
    export RIPGREP_CONFIG_PATH="$HOME/.config/ripgrep/config"
fi
if command -v ssh-copy-id >/dev/null 2>&1; then
    alias copy-ssh-id="ssh-copy-id"
fi


dots() {
    local cheatsheet_path="$HOME/.config/mydotfiles/cheatsheet"
    if [ ! -f "${cheatsheet_path}" ]; then
        printf 'dots: cheatsheet missing at %s (run chezmoi apply)\n' "${cheatsheet_path}" >&2
        return 1
    fi
    if [ -t 1 ] && command -v less >/dev/null 2>&1; then
        less -FRX "${cheatsheet_path}"
    else
        cat "${cheatsheet_path}"
    fi
}

git_fuzzy_branch() {
    local git_command="$1"

    if ! command -v git >/dev/null 2>&1; then
        printf 'git_fuzzy_branch: git not found\n' >&2
        return 1
    fi

    if ! command -v fzf >/dev/null 2>&1; then
        printf 'git_fuzzy_branch: fzf not found\n' >&2
        return 1
    fi

    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        printf 'git_fuzzy_branch: not a git repository\n' >&2
        return 1
    fi

    local selected_branch
    selected_branch="$(
        git for-each-ref --format='%(refname:short)' refs/heads refs/remotes 2>/dev/null |
            sed 's#^origin/##' |
            awk 'NF && !seen[$0]++' |
            fzf --height=40% --reverse --prompt="${git_command}> "
    )" || return 1

    if [ -z "${selected_branch}" ]; then
        return 1
    fi

    git "${git_command}" "${selected_branch}"
}

gsw() {
    git_fuzzy_branch switch
}

gco() {
    git_fuzzy_branch checkout
}

bins() {
    if ! command -v fzf >/dev/null 2>&1; then
        printf 'bins: fzf not found\n' >&2
        return 1
    fi

    local selected_command
    selected_command="$(
        printf '%s\n' "$PATH" | tr ':' '\n' |
            while IFS= read -r path_entry; do
                [ -n "${path_entry}" ] || continue
                [ -d "${path_entry}" ] || continue
                find "${path_entry}" -maxdepth 1 -type f -executable -printf '%f\n' 2>/dev/null
                find "${path_entry}" -maxdepth 1 -type l -executable -printf '%f\n' 2>/dev/null
            done |
            awk 'NF && !seen[$0]++' |
            sort |
            fzf --height=40% --reverse --prompt='bins> '
    )" || return 1

    if [ -z "${selected_command}" ]; then
        return 1
    fi

    printf '%s\n' "${selected_command}"
}

# shellcheck source=/dev/null
if [ -r "$HOME/.config/shell/wsl-windows-path.sh" ]; then
    . "$HOME/.config/shell/wsl-windows-path.sh"
fi

# Worktrunk (wt) shell wrapper with Windows Terminal clash guard
_resolve_worktrunk() {
    if [ -x "${HOME}/.local/share/mise/shims/wt" ]; then
        printf '%s\n' "${HOME}/.local/share/mise/shims/wt"
        return 0
    fi
    wt_candidate="$(command -v wt 2>/dev/null || true)"
    case "${wt_candidate}" in
        /mnt/c/*|[A-Za-z]:/*) return 1 ;;
        *)
            if [ -n "${wt_candidate}" ] && "${wt_candidate}" --version 2>/dev/null | grep -qE '^wt |worktrunk'; then
                printf '%s\n' "${wt_candidate}"
                return 0
            fi
            ;;
    esac
    return 1
}

if wt_bin="$(_resolve_worktrunk 2>/dev/null)"; then
    _wt_shell="bash"
    if [ -n "${ZSH_VERSION:-}" ]; then
        _wt_shell="zsh"
    elif [ -n "${BASH_VERSION:-}" ]; then
        _wt_shell="bash"
    fi
    eval "$("${wt_bin}" config shell init "${_wt_shell}" 2>/dev/null)" || true
    unset _wt_shell
fi

# Multi-agent auto-worktree launcher & lifecycle manager
_wt_agent_exec() {
    local harness="$1"
    shift

    if ! command -v "$harness" >/dev/null 2>&1; then
        printf '%s: command not found\n' "$harness" >&2
        return 127
    fi

    # 1. Non-interactive or explicit opt-out
    if [ ! -t 0 ] || [ ! -t 1 ] || [ "${AGENT_NO_WT:-0}" = "1" ] || [ "${OMP_NO_WT:-0}" = "1" ]; then
        command "$harness" "$@"
        return $?
    fi

    # 2. Informational, headless, or subcommand flags that should not spawn a worktree
    local arg
    for arg in "$@"; do
        case "$arg" in
            -h|--help|-v|--version|--no-tui|-p|--print|-w|--worktree|mcp|auth|config)
                command "$harness" "$@"
                return $?
                ;;
        esac
    done

    # 3. Not inside a git repository
    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        command "$harness" "$@"
        return $?
    fi

    # 4. Worktrunk binary not available
    local wt_bin
    if ! wt_bin="$(_resolve_worktrunk 2>/dev/null)"; then
        command "$harness" "$@"
        return $?
    fi

    # 5. Already inside a linked worktree (git-dir != git-common-dir)
    local git_dir git_common
    git_dir="$(git rev-parse --path-format=absolute --git-dir 2>/dev/null || git rev-parse --git-dir 2>/dev/null || true)"
    git_common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || git rev-parse --git-common-dir 2>/dev/null || true)"
    if [ -n "$git_dir" ] && [ -n "$git_common" ] && [ "$git_dir" != "$git_common" ]; then
        command "$harness" "$@"
        return $?
    fi

    # 6. Primary checkout: setup agent-bus and branch name
    mkdir -p "${git_common}/agent-bus" 2>/dev/null || true

    local base_branch
    base_branch="$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "main")"
    local timestamp
    timestamp="$(date +%Y%m%d-%H%M%S)"
    local branch="${AGENT_BRANCH:-${OMP_BRANCH:-agent/${harness}-${timestamp}}}"

    local orig_dir
    orig_dir="$(pwd)"

    printf '==> Spawning isolated worktree for %s (%s)...\n' "$harness" "$branch"
    if ! wt switch --create "$branch"; then
        command "$harness" "$@"
        return $?
    fi

    # Execute the harness in the new worktree
    local status=0
    command "$harness" "$@" || status=$?

    # Self-cleaning on exit: check if untouched/zero-diff
    local commits_ahead dirty_count
    commits_ahead="$(git rev-list --count HEAD "^${base_branch}" 2>/dev/null || echo "0")"
    dirty_count="$(git status --porcelain --untracked-files=no 2>/dev/null | wc -l || echo "0")"

    if [ "$commits_ahead" = "0" ] && [ "$dirty_count" = "0" ]; then
        printf '==> Zero commits or tracked modifications; cleaning up worktree %s...\n' "$branch"
        cd "$orig_dir" 2>/dev/null || true
        wt switch "$base_branch" 2>/dev/null || true
        wt remove "$branch" --yes 2>/dev/null || true
    else
        printf '\n==> Worktree %s has %s commit(s) ahead of %s.\n' "$branch" "$commits_ahead" "$base_branch"
        printf '==> Review & merge: wt merge  (or: wt switch %s && wt remove %s)\n' "$base_branch" "$branch"
    fi

    return $status
}

omp() {
    _wt_agent_exec omp "$@"
}

claude() {
    _wt_agent_exec claude "$@"
}

devin() {
    _wt_agent_exec devin "$@"
}

wtr() {
    if [ $# -lt 1 ]; then
        printf 'Usage: wtr <branch> [harness]\n' >&2
        return 1
    fi
    local target_branch="$1"
    local review_harness="${2:-}"

    if ! wt switch "$target_branch"; then
        return 1
    fi

    local common_dir base_branch
    common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || git rev-parse --git-common-dir 2>/dev/null || true)"
    base_branch="$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null | sed 's|^origin/||')"
    [ -n "$base_branch" ] || base_branch="main"

    printf '\n=== Branch: %s (vs %s) ===\n' "$target_branch" "$base_branch"
    git log --oneline "${base_branch}..HEAD" 2>/dev/null || git log --oneline -5
    printf '\n=== Changed Files ===\n'
    git diff --stat "${base_branch}...HEAD" 2>/dev/null || true

    local safe_branch
    safe_branch="$(printf '%s' "$target_branch" | tr '/' '_')"
    local bus_note="${common_dir}/agent-bus/${safe_branch}.md"
    if [ ! -f "${bus_note}" ]; then
        bus_note="${common_dir}/agent-bus/${target_branch}.md"
    fi
    if [ -f "${bus_note}" ]; then
        printf '\n=== Agent Bus Handoff Note (%s) ===\n' "${bus_note}"
        cat "${bus_note}"
    fi

    if [ -n "$review_harness" ]; then
        printf '\n==> Launching review session in %s...\n' "$review_harness"
        AGENT_NO_WT=1 OMP_NO_WT=1 command "$review_harness"
    else
        printf '\n==> Next steps:\n  wt merge          (verify & merge into %s)\n  wt switch -       (back to previous)\n  wt remove %s   (discard)\n' "$base_branch" "$target_branch"
    fi
}

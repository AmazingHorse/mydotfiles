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

# Multi-agent auto-worktree launcher & lifecycle manager (claude, devin).
# omp manages its own session worktrees natively (worktree.onStart/onExit in
# ~/.omp/agent/config.yml), so bare `omp` is intentionally NOT wrapped here.

# Post-session epilogue: runs in whatever directory the session left behind.
# Auto-removes pristine worktrees, honors an agent-bus policy marker
# (<git-common>/agent-bus/.policy-<worktree-basename> containing "keep"/"drop",
# written by the omp wt-session extension or by hand), and otherwise prompts
# keep/rename/discard. Works the same whether the harness ended normally or
# was interrupted — the interactive shell survives the child's SIGINT.
#   $1 original cwd  $2 base branch  $3 resumed flag  $4 harness exit code
_wt_agent_epilogue() {
    local orig_dir="$1" base_branch="$2" resumed="$3" exit_code="$4"

    # Only apply worktree lifecycle inside a linked worktree (git-dir != git-common-dir)
    local git_dir git_common
    git_dir="$(git rev-parse --path-format=absolute --git-dir 2>/dev/null || git rev-parse --git-dir 2>/dev/null || true)"
    git_common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || git rev-parse --git-common-dir 2>/dev/null || true)"
    if [ -z "$git_dir" ] || [ -z "$git_common" ] || [ "$git_dir" = "$git_common" ]; then
        return "$exit_code"
    fi

    # Re-resolve the branch at exit: it may have been renamed (/wt-name) or
    # switched in place (/wt-switch) during the session.
    local cur_branch wt_root policy_file="" policy=""
    cur_branch="$(git branch --show-current 2>/dev/null || true)"
    wt_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
    [ -n "$cur_branch" ] || cur_branch="(detached)"
    if [ -n "$wt_root" ]; then
        policy_file="${git_common}/agent-bus/.policy-$(basename "$wt_root")"
        [ -f "$policy_file" ] && policy="$(cat "$policy_file" 2>/dev/null || true)"
    fi

    local commits_ahead dirty_count
    # A missing base ref must never read as "0 commits": force the non-pristine
    # path so nothing is auto-removed on a bad comparison.
    if ! commits_ahead="$(git rev-list --count HEAD "^${base_branch}" 2>/dev/null)"; then
        commits_ahead="?"
    fi
    dirty_count="$(git status --porcelain --untracked-files=no 2>/dev/null | wc -l | tr -d '[:space:]')"
    [ -n "$dirty_count" ] || dirty_count="0"

    if [ "$commits_ahead" = "0" ] && [ "$dirty_count" = "0" ]; then
        if [ "$resumed" = "1" ] && [ "$policy" != "drop" ]; then
            printf '==> Worktree %s unchanged; leaving in place.\n' "$cur_branch"
        else
            printf '==> No commits or tracked modifications; removing worktree %s...\n' "$cur_branch"
            cd "$orig_dir" 2>/dev/null || true
            wt remove "$cur_branch" --yes 2>/dev/null || true
        fi
        rm -f "$policy_file" 2>/dev/null || true
        return "$exit_code"
    fi

    printf '\n==> Worktree %s: %s commit(s) ahead of %s, %s modified tracked file(s).\n' \
        "$cur_branch" "$commits_ahead" "$base_branch" "$dirty_count"

    local action="$policy"
    if [ -z "$action" ] && [ -t 0 ] && [ "${AGENT_WT_ASK:-1}" != "0" ]; then
        printf '    [Enter]=keep  r=rename branch  d=discard worktree+branch: '
        local reply=""
        read -r reply || reply=""
        case "$reply" in
            r|R)
                local new_name=""
                printf '    New branch name: '
                read -r new_name || new_name=""
                if [ -n "$new_name" ] && git branch -m "$new_name" 2>/dev/null; then
                    local old_safe new_safe
                    old_safe="$(printf '%s' "$cur_branch" | tr '/' '_')"
                    new_safe="$(printf '%s' "$new_name" | tr '/' '_')"
                    if [ -f "${git_common}/agent-bus/${old_safe}.md" ]; then
                        mv "${git_common}/agent-bus/${old_safe}.md" \
                            "${git_common}/agent-bus/${new_safe}.md" 2>/dev/null || true
                    fi
                    cur_branch="$new_name"
                    printf '==> Renamed to %s; worktree kept at %s\n' "$new_name" "$wt_root"
                else
                    printf '==> Rename skipped; keeping %s\n' "$cur_branch"
                fi
                action="keep"
                ;;
            d|D) action="drop" ;;
            *) action="keep" ;;
        esac
    fi
    [ -n "$action" ] || action="keep"

    if [ "$action" = "drop" ]; then
        printf '==> Discarding worktree %s...\n' "$cur_branch"
        cd "$orig_dir" 2>/dev/null || true
        wt remove "$cur_branch" --yes -f -D 2>/dev/null || true
    else
        printf '==> Review & merge: wt merge  (or: wt switch %s && wt remove %s)\n' "$base_branch" "$cur_branch"
    fi
    rm -f "$policy_file" 2>/dev/null || true
    return "$exit_code"
}

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

    # 6. Primary checkout: setup agent-bus and resolve the target branch.
    # AGENT_BRANCH / OMP_BRANCH name an explicit target: an existing local
    # branch resumes into a worktree, anything else is created.
    mkdir -p "${git_common}/agent-bus" 2>/dev/null || true

    local base_branch
    base_branch="$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "main")"
    local requested="${AGENT_BRANCH:-${OMP_BRANCH:-}}"
    local branch resumed=0
    if [ -n "$requested" ]; then
        branch="$requested"
        if git show-ref --verify --quiet "refs/heads/${branch}"; then
            resumed=1
        else
            printf '==> Branch %s not found; creating it.\n' "$branch"
        fi
    else
        branch="agent/${harness}-$(date +%Y%m%d-%H%M%S)"
    fi

    local orig_dir
    orig_dir="$(pwd)"

    # -x runs the harness inside the worktree with full terminal control and
    # propagates its exit code; the shell lands in the worktree afterwards.
    local exit_code=0
    if [ "$resumed" = "1" ]; then
        printf '==> Resuming branch %s in a worktree for %s...\n' "$branch" "$harness"
        wt switch "$branch" -x "$harness" -- "$@" || exit_code=$?
    else
        printf '==> Spawning isolated worktree for %s (%s)...\n' "$harness" "$branch"
        wt switch --create "$branch" -x "$harness" -- "$@" || exit_code=$?
    fi

    # Switch failed before reaching a worktree (create path only): run in place
    if [ "$resumed" = "0" ] && [ "$exit_code" != "0" ] && [ "$(pwd -P)" = "$(cd "$orig_dir" && pwd -P)" ]; then
        command "$harness" "$@"
        return $?
    fi

    _wt_agent_epilogue "$orig_dir" "$base_branch" "$resumed" "$exit_code"
    return $?
}

claude() {
    _wt_agent_exec claude "$@"
}

devin() {
    _wt_agent_exec devin "$@"
}

# omp manages session worktrees natively (worktree.onStart=create in
# ~/.omp/agent/config.yml); this shim only preserves the OMP_NO_WT/AGENT_NO_WT
# opt-out by layering a no-worktree config overlay for that invocation.
omp() {
    if [ "${OMP_NO_WT:-0}" = "1" ] || [ "${AGENT_NO_WT:-0}" = "1" ]; then
        command omp --config "$HOME/.omp/agent/no-worktree.yml" "$@"
    else
        command omp "$@"
    fi
}

# Interactive picker: open an existing worktree or branch in an agent session.
# Usage: wta [omp|claude|devin] [args...]   (default harness: omp)
wta() {
    local harness="omp"
    case "${1:-}" in
        omp|claude|devin) harness="$1"; shift ;;
    esac

    if ! command -v "$harness" >/dev/null 2>&1; then
        printf '%s: command not found\n' "$harness" >&2
        return 127
    fi
    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        printf 'wta: not a git repository\n' >&2
        return 1
    fi
    if ! _resolve_worktrunk >/dev/null 2>&1; then
        printf 'wta: worktrunk (wt) is required\n' >&2
        return 1
    fi

    local git_common base_branch orig_dir exit_code=0
    git_common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
    if [ -n "$git_common" ]; then
        mkdir -p "${git_common}/agent-bus" 2>/dev/null || true
    fi
    base_branch="$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "main")"
    orig_dir="$(pwd)"

    wt switch --branches -x "$harness" -- "$@" || exit_code=$?
    _wt_agent_epilogue "$orig_dir" "$base_branch" 1 "$exit_code"
    return $?
}

# Pull uncommitted work (tracked modifications + untracked files; gitignored
# excluded) from another worktree into the CURRENT one, via a temporary stash —
# refs/stash is shared across linked worktrees and `stash apply` performs a
# real merge, so diverged bases get proper conflict markers instead of patch
# rejects. Move by default (source ends clean, which unblocks `wt merge`);
# --copy keeps the source checkout's changes by popping the stash back.
# Usage: wtpull [--copy] [source]   (source: worktree path or branch; default: primary checkout)
wtpull() {
    local move=1 src=""
    while [ $# -gt 0 ]; do
        case "$1" in
            -m|--move) move=1 ;;
            -c|--copy) move=0 ;;
            -h|--help)
                printf 'Usage: wtpull [--copy] [worktree-path|branch]\n'
                return 0
                ;;
            *) src="$1" ;;
        esac
        shift
    done

    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        printf 'wtpull: not a git repository\n' >&2
        return 1
    fi
    local dst
    dst="$(git rev-parse --show-toplevel)"

    # Resolve source: default = primary checkout (first worktree-list entry)
    local src_root=""
    if [ -z "$src" ]; then
        src_root="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"
    elif [ -d "$src" ]; then
        src_root="$(cd "$src" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)"
    else
        src_root="$(git worktree list --porcelain | awk -v b="refs/heads/$src" \
            '/^worktree /{wt=$2} /^branch /{if($2==b){print wt; exit}}')"
    fi
    if [ -z "$src_root" ]; then
        printf 'wtpull: cannot resolve source worktree for %s\n' "${src:-<primary>}" >&2
        return 1
    fi
    if [ "$src_root" = "$dst" ]; then
        printf 'wtpull: source and target are the same worktree\n' >&2
        return 1
    fi

    # Anything to pull? (tracked diff or untracked non-ignored files)
    local has_changes=1
    if git -C "$src_root" diff --quiet HEAD -- 2>/dev/null &&
        [ -z "$(git -C "$src_root" ls-files -o --exclude-standard)" ]; then
        has_changes=0
    fi
    if [ "$has_changes" = "0" ]; then
        printf '==> Nothing to pull; %s is clean.\n' "$src_root"
        return 0
    fi

    printf '==> Pulling uncommitted changes from %s ...\n' "$src_root"
    if ! git -C "$src_root" stash push -u -m wtpull --quiet; then
        printf 'wtpull: could not stash source changes\n' >&2
        return 1
    fi
    # stash@{0} is ours (push just ran); verify by SHA before drop/pop.
    local our_stash
    our_stash="$(git -C "$src_root" rev-parse -q --verify refs/stash 2>/dev/null || true)"

    local applied=0
    if git stash apply --quiet 'stash@{0}' >/dev/null 2>&1; then
        applied=1
        printf '==> Pulled changes into %s\n' "$dst"
    else
        printf 'wtpull: applied with conflicts — resolve in this worktree.\n' >&2
    fi

    # Restore or retire the stash entry; only touch stash@{0} if it is still ours.
    if [ "$(git -C "$src_root" rev-parse -q --verify 'refs/stash' 2>/dev/null || true)" != "$our_stash" ]; then
        printf 'wtpull: stash stack changed underneath; leaving stash entries alone.\n' >&2
        return 1
    fi
    if [ "$move" = "1" ]; then
        if [ "$applied" = "1" ]; then
            git -C "$src_root" stash drop -q 'stash@{0}' >/dev/null &&
                printf '==> Moved; source checkout is clean.\n'
        else
            printf 'wtpull: kept stash@{0} as backup — drop it after resolving.\n' >&2
            return 1
        fi
    else
        if [ "$applied" = "1" ]; then
            git -C "$src_root" stash pop -q 'stash@{0}' >/dev/null &&
                printf '==> Copied; source restored (default is --move to transfer).\n'
        else
            git -C "$src_root" stash pop -q 'stash@{0}' >/dev/null 2>&1 || true
            printf 'wtpull: source restored; conflicts remain in this worktree.\n' >&2
            return 1
        fi
    fi
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

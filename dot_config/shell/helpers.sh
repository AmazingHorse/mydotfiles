# Shared interactive shell helpers. Soft-sourced from zshrc/bashrc.

export PATH="$HOME/.local/bin:$PATH"

if command -v preferred-editor >/dev/null 2>&1; then
    export EDITOR="preferred-editor"
    export VISUAL="preferred-editor"
elif [ -z "${EDITOR:-}" ]; then
    export EDITOR="vi"
    export VISUAL="vi"
fi

export PAGER="${PAGER:-less}"
export LESS="${LESS:--FRX}"

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

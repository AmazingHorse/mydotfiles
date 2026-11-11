# Managed PowerShell 7 profile. Windows $PROFILE should dot-source this file.

$AgentEnvironmentPath = Join-Path $HOME '.config/powershell/agent-env.ps1'
if (Test-Path -LiteralPath $AgentEnvironmentPath) {
    . $AgentEnvironmentPath
}

$LocalBinDirectory = Join-Path $HOME '.local\bin'
if (Test-Path -LiteralPath $LocalBinDirectory) {
    if (-not (($env:Path -split ';') -contains $LocalBinDirectory)) {
        $env:Path = "$LocalBinDirectory;$env:Path"
    }
}
$MiseShimsDirectory = Join-Path $env:LOCALAPPDATA 'mise\shims'
if (Test-Path -LiteralPath $MiseShimsDirectory) {
    if (-not (($env:Path -split ';') -contains $MiseShimsDirectory)) {
        $env:Path = "$MiseShimsDirectory;$env:Path"
    }
}
$PythonUserScripts = Join-Path $env:APPDATA 'Python\Python*\Scripts'
$ResolvedPythonScripts = Get-ChildItem -Path $PythonUserScripts -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
if ($ResolvedPythonScripts -and (Test-Path -LiteralPath $ResolvedPythonScripts)) {
    if (-not (($env:Path -split ';') -contains $ResolvedPythonScripts)) {
        $env:Path = "$ResolvedPythonScripts;$env:Path"
    }
}

function Resolve-PreferredEditorCommand {
    $WaitCapableEditors = @(
        @{ Name = 'cursor'; Arguments = @('--wait') }
        @{ Name = 'antigravity'; Arguments = @('--wait') }
        @{ Name = 'agy'; Arguments = @('--wait') }
        @{ Name = 'code'; Arguments = @('--wait') }
    )
    foreach ($EditorCandidate in $WaitCapableEditors) {
        if (Get-Command $EditorCandidate.Name -ErrorAction SilentlyContinue) {
            return $EditorCandidate
        }
    }

    foreach ($TerminalEditorName in @('nvim', 'vim', 'vi')) {
        if (Get-Command $TerminalEditorName -ErrorAction SilentlyContinue) {
            return @{ Name = $TerminalEditorName; Arguments = @() }
        }
    }

    return $null
}

$PreferredEditor = Resolve-PreferredEditorCommand
if ($PreferredEditor) {
    $EditorInvocation = $PreferredEditor.Name
    if ($PreferredEditor.Arguments.Count -gt 0) {
        $EditorInvocation = "$($PreferredEditor.Name) $($PreferredEditor.Arguments -join ' ')"
    }
    $env:EDITOR = $EditorInvocation
    $env:VISUAL = $EditorInvocation
}

if (-not $env:PAGER) {
    if (Get-Command less -ErrorAction SilentlyContinue) {
        $env:PAGER = 'less'
        if (-not $env:LESS) {
            $env:LESS = '-FRX'
        }
    } else {
        $env:PAGER = 'more.com'
    }
}

$PSReadLineCommand = Get-Command Set-PSReadLineOption -ErrorAction SilentlyContinue
if ($PSReadLineCommand) {
    Set-PSReadLineOption -BellStyle Audible -DingTone 660 -DingDuration 30
    Set-PSReadLineKeyHandler -Key Backspace -ScriptBlock {
        param($Key, $Argument)

        $CurrentLine = $null
        $CursorPosition = 0
        $SelectionStart = -1
        $SelectionLength = 0
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState(
            [ref]$CurrentLine,
            [ref]$CursorPosition
        )
        [Microsoft.PowerShell.PSConsoleReadLine]::GetSelectionState(
            [ref]$SelectionStart,
            [ref]$SelectionLength
        )

        if ($CursorPosition -gt 0 -or $SelectionLength -gt 0) {
            [Microsoft.PowerShell.PSConsoleReadLine]::BackwardDeleteChar($Key, $Argument)
            return
        }

        [Console]::Write("`a")
    }
}

function Invoke-GitFuzzySwitch {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('switch', 'checkout')]
        [string]$GitCommand
    )

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Warning 'git not found'
        return
    }

    if (-not (Get-Command fzf -ErrorAction SilentlyContinue)) {
        Write-Warning 'fzf not found'
        return
    }

    git rev-parse --is-inside-work-tree 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'not a git repository'
        return
    }

    $SelectedBranch = git for-each-ref --format='%(refname:short)' refs/heads refs/remotes 2>$null |
        ForEach-Object { $_ -replace '^origin/', '' } |
        Where-Object { $_ } |
        Select-Object -Unique |
        fzf --height=40% --reverse --prompt="${GitCommand}> "

    if (-not $SelectedBranch) {
        return
    }

    & git $GitCommand $SelectedBranch
}

function gsw { Invoke-GitFuzzySwitch -GitCommand switch }
function gco { Invoke-GitFuzzySwitch -GitCommand checkout }

function bins {
    if (-not (Get-Command fzf -ErrorAction SilentlyContinue)) {
        Write-Warning 'bins: fzf not found'
        return
    }

    $SelectedCommand = Get-Command -CommandType Application -ErrorAction SilentlyContinue |
        ForEach-Object { $_.Name } |
        Sort-Object -Unique |
        fzf --height=40% --reverse --prompt='bins> '

    if (-not $SelectedCommand) {
        return
    }

    $SelectedCommand
}

function dots {
    $CheatsheetPath = Join-Path $HOME '.config\mydotfiles\cheatsheet'
    if (-not (Test-Path -LiteralPath $CheatsheetPath)) {
        Write-Warning "dots: cheatsheet missing at $CheatsheetPath (run chezmoi apply)"
        return
    }

    Get-Content -LiteralPath $CheatsheetPath
}
function Invoke-SshCopyId {
    [CmdletBinding()]
    param(
        [Parameter(Position = 0, Mandatory = $true)]
        [string]$Target,

        [Alias('i')]
        [string]$Identity = '',

        [Alias('p')]
        [string]$Port = ''
    )

    if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
        throw 'ssh command not found. Install Windows OpenSSH Client first.'
    }

    function Expand-SshPath {
        param([string]$Path)
        if ($Path -eq '~') { return $HOME }
        if ($Path.StartsWith('~/') -or $Path.StartsWith('~\')) {
            return Join-Path $HOME $Path.Substring(2)
        }
        if (-not [System.IO.Path]::IsPathRooted($Path)) {
            return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Path))
        }
        return [System.IO.Path]::GetFullPath($Path)
    }

    if (-not $Identity) {
        $DefaultCandidates = @(
            (Join-Path $HOME '.ssh\id_ed25519.pub'),
            (Join-Path $HOME '.ssh\id_rsa.pub'),
            (Join-Path $HOME '.ssh\id_ecdsa.pub')
        )
        foreach ($Candidate in $DefaultCandidates) {
            if (Test-Path -LiteralPath $Candidate) {
                $Identity = $Candidate
                break
            }
        }
    }

    if (-not $Identity) {
        throw "No SSH public key found in ~/.ssh. Specify a key with -i <path> or generate one with 'just setup-ssh'."
    }

    $ResolvedKey = Expand-SshPath $Identity
    if (-not $ResolvedKey.EndsWith('.pub', [System.StringComparison]::OrdinalIgnoreCase)) {
        if (Test-Path -LiteralPath "$ResolvedKey.pub") {
            $ResolvedKey = "$ResolvedKey.pub"
        }
    }

    if (-not (Test-Path -LiteralPath $ResolvedKey)) {
        throw "Public key not found: $ResolvedKey"
    }

    $PublicKeyContents = (Get-Content -LiteralPath $ResolvedKey -Raw).Trim()
    if (-not $PublicKeyContents) {
        throw "Public key is empty: $ResolvedKey"
    }

    $SshArgs = @()
    if (-not [string]::IsNullOrWhiteSpace($Port)) {
        $SshArgs += @('-p', $Port)
    }
    $SshArgs += $Target

    $RemoteCommand = "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF '$PublicKeyContents' ~/.ssh/authorized_keys || printf '%s\n' '$PublicKeyContents' >> ~/.ssh/authorized_keys"
    $SshArgs += $RemoteCommand

    Write-Host "Installing public key ($ResolvedKey) on $Target..."
    & ssh @SshArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install public key on host: $Target"
    }
    Write-Host "Installed public key on $Target"
}

Set-Alias -Name ssh-copy-id -Value Invoke-SshCopyId -ErrorAction SilentlyContinue
Set-Alias -Name copy-ssh-id -Value Invoke-SshCopyId -ErrorAction SilentlyContinue


$RipgrepConfigPath = Join-Path $HOME '.config\ripgrep\config'
if (Test-Path -LiteralPath $RipgrepConfigPath) {
    $env:RIPGREP_CONFIG_PATH = $RipgrepConfigPath
}

# mise's pwsh chpwd hook needs PowerShell 7+. Skip activate on Windows PowerShell 5.1
# (Cursor/system shells often still start 5.1) to avoid noisy warnings.
if ($PSVersionTable.PSVersion.Major -ge 7 -and (Get-Command mise -ErrorAction SilentlyContinue)) {
    mise activate pwsh | Out-String | Invoke-Expression
} elseif ($PSVersionTable.PSVersion.Major -lt 7) {
    $env:MISE_PWSH_CHPWD_WARNING = '0'
}

if (Get-Command zoxide -ErrorAction SilentlyContinue) {
    Invoke-Expression (& { (zoxide init powershell | Out-String) })
}

# Worktrunk (wt) shell integration with Windows Terminal clash guard
$MiseWtShim = Join-Path $env:LOCALAPPDATA 'mise\shims\wt.exe'
$WtCommand = $null
if (Test-Path -LiteralPath $MiseWtShim) {
    $WtCommand = $MiseWtShim
} else {
    $Candidate = Get-Command wt -ErrorAction SilentlyContinue
    if ($Candidate -and $Candidate.Source -notmatch 'WindowsApps\\wt\.exe') {
        try {
            $Ver = & $Candidate.Source --version 2>$null
            if ($Ver -match '^(wt |worktrunk)') {
                $WtCommand = $Candidate.Source
            }
        } catch {}
    }
}
if ($WtCommand) {
    try {
        & $WtCommand config shell init powershell 2>$null | Out-String | Invoke-Expression
    } catch {}
}

function Invoke-WtAgentEpilogue {
    param(
        [string]$OrigDir,
        [string]$BaseBranch,
        [bool]$Resumed,
        [int]$ExitCode
    )

    $GitDir = (git rev-parse --path-format=absolute --git-dir 2>$null)
    if ($GitDir) { $GitDir = $GitDir.Trim() }
    $GitCommon = (git rev-parse --path-format=absolute --git-common-dir 2>$null)
    if ($GitCommon) { $GitCommon = $GitCommon.Trim() }
    if (-not $GitDir -or -not $GitCommon -or $GitDir -eq $GitCommon) { return }

    # Re-resolve the branch at exit: it may have been renamed or switched in
    # place during the session.
    $CurBranch = (git branch --show-current 2>$null)
    if (-not $CurBranch) { $CurBranch = '(detached)' }
    $WtRoot = (git rev-parse --show-toplevel 2>$null)
    if ($WtRoot) { $WtRoot = $WtRoot.Trim() }

    $PolicyFile = $null
    $Policy = ''
    if ($WtRoot) {
        $PolicyFile = Join-Path $GitCommon ('agent-bus/.policy-' + (Split-Path $WtRoot -Leaf))
        if (Test-Path -LiteralPath $PolicyFile) {
            $Policy = (Get-Content -LiteralPath $PolicyFile -Raw).Trim()
        }
    }

    $CommitsAhead = (git rev-list --count 'HEAD' "^$BaseBranch" 2>$null)
    # A missing base ref must never read as "0 commits": force the
    # non-pristine path so nothing is auto-removed on a bad comparison.
    if ($LASTEXITCODE -ne 0 -or -not $CommitsAhead) { $CommitsAhead = '?' }
    $DirtyCount = (git status --porcelain --untracked-files=no 2>$null | Measure-Object).Count

    if ($CommitsAhead -eq '0' -and $DirtyCount -eq 0) {
        if ($Resumed -and $Policy -ne 'drop') {
            Write-Host "==> Worktree $CurBranch unchanged; leaving in place." -ForegroundColor Gray
        } else {
            Write-Host "==> No commits or tracked modifications; removing worktree $CurBranch..." -ForegroundColor Gray
            Set-Location $OrigDir
            & $WtCommand remove $CurBranch --yes 2>$null
        }
        if ($PolicyFile) { Remove-Item -LiteralPath $PolicyFile -Force -ErrorAction SilentlyContinue }
        return
    }

    Write-Host "`n==> Worktree ${CurBranch}: $CommitsAhead commit(s) ahead of $BaseBranch, $DirtyCount modified tracked file(s)." -ForegroundColor Yellow

    $Action = $Policy
    if (-not $Action -and $env:AGENT_WT_ASK -ne '0') {
        $Reply = Read-Host '    [Enter]=keep  r=rename branch  d=discard worktree+branch'
        switch -Regex ($Reply) {
            '^[rR]$' {
                $NewName = Read-Host '    New branch name'
                if ($NewName -and (git branch -m $NewName 2>$null; $LASTEXITCODE -eq 0)) {
                    $OldSafe = $CurBranch -replace '/', '_'
                    $NewSafe = $NewName -replace '/', '_'
                    $OldNote = Join-Path $GitCommon "agent-bus/$OldSafe.md"
                    if (Test-Path -LiteralPath $OldNote) {
                        Move-Item -LiteralPath $OldNote -Destination (Join-Path $GitCommon "agent-bus/$NewSafe.md") -Force -ErrorAction SilentlyContinue
                    }
                    $CurBranch = $NewName
                    Write-Host "==> Renamed to $NewName; worktree kept at $WtRoot" -ForegroundColor Gray
                } else {
                    Write-Host "==> Rename skipped; keeping $CurBranch" -ForegroundColor Gray
                }
                $Action = 'keep'
            }
            '^[dD]$' { $Action = 'drop' }
            default { $Action = 'keep' }
        }
    }
    if (-not $Action) { $Action = 'keep' }

    if ($Action -eq 'drop') {
        Write-Host "==> Discarding worktree $CurBranch..." -ForegroundColor Gray
        Set-Location $OrigDir
        & $WtCommand remove $CurBranch --yes -f -D 2>$null
    } else {
        Write-Host "==> Review & merge: wt merge  (or: wt switch $BaseBranch; wt remove $CurBranch)" -ForegroundColor Gray
    }
    if ($PolicyFile) { Remove-Item -LiteralPath $PolicyFile -Force -ErrorAction SilentlyContinue }
}

function Invoke-WtAgent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Harness,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    $HarnessCmd = Get-Command $Harness -CommandType Application -ErrorAction SilentlyContinue
    if (-not $HarnessCmd) {
        Write-Error "$Harness : The term '$Harness' is not recognized."
        return
    }

    # Opt-outs
    if ($env:AGENT_NO_WT -eq '1' -or $env:OMP_NO_WT -eq '1') {
        & $HarnessCmd.Source @Arguments
        return
    }

    # Flags that should bypass worktree creation
    $BypassFlags = @('-h', '--help', '-v', '--version', '--no-tui', '-p', '--print', '-w', '--worktree', 'mcp', 'auth', 'config')
    foreach ($arg in $Arguments) {
        if ($BypassFlags -contains $arg) {
            & $HarnessCmd.Source @Arguments
            return
        }
    }

    # Check git repo
    $IsGit = git rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -ne 0 -or $IsGit -ne 'true') {
        & $HarnessCmd.Source @Arguments
        return
    }

    if (-not $WtCommand) {
        & $HarnessCmd.Source @Arguments
        return
    }

    # Check if already in linked worktree
    $GitDir = (git rev-parse --path-format=absolute --git-dir 2>$null)
    if ($GitDir) { $GitDir = $GitDir.Trim() }
    $GitCommon = (git rev-parse --path-format=absolute --git-common-dir 2>$null)
    if ($GitCommon) { $GitCommon = $GitCommon.Trim() }
    if ($GitDir -and $GitCommon -and $GitDir -ne $GitCommon) {
        & $HarnessCmd.Source @Arguments
        return
    }

    # Ensure agent-bus exists
    $AgentBusDir = Join-Path $GitCommon 'agent-bus'
    if (-not (Test-Path -LiteralPath $AgentBusDir)) {
        New-Item -ItemType Directory -Path $AgentBusDir -Force | Out-Null
    }

    $BaseBranch = (git symbolic-ref --short HEAD 2>$null)
    if (-not $BaseBranch) { $BaseBranch = 'main' }

    # AGENT_BRANCH / OMP_BRANCH name an explicit target: an existing local
    # branch resumes into a worktree, anything else is created.
    $Resumed = $false
    $Requested = if ($env:AGENT_BRANCH) { $env:AGENT_BRANCH } elseif ($env:OMP_BRANCH) { $env:OMP_BRANCH } else { '' }
    if ($Requested) {
        $Branch = $Requested
        git show-ref --verify --quiet "refs/heads/$Branch" 2>$null
        if ($LASTEXITCODE -eq 0) {
            $Resumed = $true
        } else {
            Write-Host "==> Branch $Branch not found; creating it." -ForegroundColor Gray
        }
    } else {
        $Branch = "agent/$Harness-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    }

    $OrigDir = Get-Location

    # -x runs the harness inside the worktree with full terminal control and
    # propagates its exit code; the shell lands in the worktree afterwards.
    # The epilogue lives in finally so Ctrl+C unwinding still resolves the
    # worktree; it self-guards when no linked worktree was reached.
    if ($Resumed) {
        Write-Host "==> Resuming branch $Branch in a worktree for $Harness..." -ForegroundColor Cyan
    } else {
        Write-Host "==> Spawning isolated worktree for $Harness ($Branch)..." -ForegroundColor Cyan
    }
    $ExitCode = 0
    try {
        if ($Resumed) {
            & $WtCommand switch $Branch -x $HarnessCmd.Source -- @Arguments
        } else {
            & $WtCommand switch --create $Branch -x $HarnessCmd.Source -- @Arguments
        }
        $ExitCode = $LASTEXITCODE
    } finally {
        Invoke-WtAgentEpilogue -OrigDir $OrigDir -BaseBranch $BaseBranch -Resumed $Resumed -ExitCode $ExitCode
    }

    # Switch failed before reaching a worktree (create path only): run in place
    if (-not $Resumed -and $ExitCode -ne 0 -and (Get-Location).Path -eq $OrigDir.Path) {
        & $HarnessCmd.Source @Arguments
    }
}

function claude { Invoke-WtAgent -Harness 'claude' @args }
function devin { Invoke-WtAgent -Harness 'devin' @args }

# omp manages session worktrees natively (worktree.onStart=create in
# ~/.omp/agent/config.yml); this shim only preserves the OMP_NO_WT/AGENT_NO_WT
# opt-out by layering a no-worktree config overlay for that invocation.
function omp {
    $OmpCmd = Get-Command omp -CommandType Application -ErrorAction SilentlyContinue
    if (-not $OmpCmd) {
        Write-Error "omp : The term 'omp' is not recognized."
        return
    }
    if ($env:OMP_NO_WT -eq '1' -or $env:AGENT_NO_WT -eq '1') {
        & $OmpCmd.Source --config "$HOME/.omp/agent/no-worktree.yml" @args
    } else {
        & $OmpCmd.Source @args
    }
}

# Interactive picker: open an existing worktree or branch in an agent session.
# Usage: wta [omp|claude|devin] [args...]   (default harness: omp)
function wta {
    param(
        [Parameter(Position = 0)]
        [string]$Harness = 'omp',
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )
    if ($Harness -notin @('omp', 'claude', 'devin')) {
        $Arguments = @($Harness) + $Arguments
        $Harness = 'omp'
    }
    if (-not $WtCommand) {
        Write-Error 'Worktrunk (wt) is not available.'
        return
    }
    $IsGit = git rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -ne 0 -or $IsGit -ne 'true') {
        Write-Error 'wta: not a git repository'
        return
    }
    $HarnessCmd = Get-Command $Harness -CommandType Application -ErrorAction SilentlyContinue
    if (-not $HarnessCmd) {
        Write-Error "$Harness : The term '$Harness' is not recognized."
        return
    }

    $GitCommon = (git rev-parse --path-format=absolute --git-common-dir 2>$null)
    if ($GitCommon) {
        $GitCommon = $GitCommon.Trim()
        $AgentBusDir = Join-Path $GitCommon 'agent-bus'
        if (-not (Test-Path -LiteralPath $AgentBusDir)) {
            New-Item -ItemType Directory -Path $AgentBusDir -Force | Out-Null
        }
    }
    $BaseBranch = (git symbolic-ref --short HEAD 2>$null)
    if (-not $BaseBranch) { $BaseBranch = 'main' }
    $OrigDir = Get-Location
    $ExitCode = 0
    try {
        & $WtCommand switch --branches -x $HarnessCmd.Source -- @Arguments
        $ExitCode = $LASTEXITCODE
    } finally {
        Invoke-WtAgentEpilogue -OrigDir $OrigDir -BaseBranch $BaseBranch -Resumed $true -ExitCode $ExitCode
    }
}

# Pull uncommitted work (tracked modifications + untracked files; gitignored
# excluded) from another worktree into the CURRENT one, via a temporary stash —
# refs/stash is shared across linked worktrees and `stash apply` performs a
# real merge, so diverged bases get proper conflict markers instead of patch
# rejects. Move by default (source ends clean, which unblocks `wt merge`);
# -Copy keeps the source checkout's changes by popping the stash back.
# Usage: wtpull [-Copy] [source]   (source: worktree path or branch; default: primary checkout)
function wtpull {
    param(
        [Parameter(Position = 0)]
        [string]$Source,
        [switch]$Copy
    )
    $Move = -not $Copy

    $IsGit = git rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -ne 0 -or $IsGit -ne 'true') {
        Write-Error 'wtpull: not a git repository'
        return
    }
    $Dst = (git rev-parse --show-toplevel).Trim()

    $SrcRoot = $null
    if (-not $Source) {
        $SrcRoot = (git worktree list --porcelain | Select-String '^worktree ' | Select-Object -First 1).Line.Substring(9)
    } elseif (Test-Path -LiteralPath $Source) {
        $SrcRoot = (git -C $Source rev-parse --show-toplevel 2>$null)
    } else {
        $entries = git worktree list --porcelain
        for ($i = 0; $i -lt $entries.Count; $i++) {
            if ($entries[$i] -match '^worktree (.+)$') { $wtPath = $Matches[1] }
            if ($entries[$i] -eq "branch refs/heads/$Source") { $SrcRoot = $wtPath; break }
        }
    }
    if (-not $SrcRoot) {
        Write-Error "wtpull: cannot resolve source worktree for $Source"
        return
    }
    $SrcRoot = $SrcRoot.Trim()
    if ($SrcRoot -eq $Dst) {
        Write-Error 'wtpull: source and target are the same worktree'
        return
    }

    git -C $SrcRoot diff --quiet HEAD -- 2>$null
    $hasDiff = ($LASTEXITCODE -ne 0)
    $Untracked = @(git -C $SrcRoot ls-files -o --exclude-standard 2>$null)
    if (-not $hasDiff -and $Untracked.Count -eq 0) {
        Write-Host "==> Nothing to pull; $SrcRoot is clean." -ForegroundColor Gray
        return
    }

    Write-Host "==> Pulling uncommitted changes from $SrcRoot ..." -ForegroundColor Cyan
    git -C $SrcRoot stash push -u -m wtpull --quiet
    if ($LASTEXITCODE -ne 0) {
        Write-Error 'wtpull: could not stash source changes'
        return
    }
    # stash@{0} is ours (push just ran); verify by SHA before drop/pop.
    $ourStash = (git -C $SrcRoot rev-parse -q --verify refs/stash 2>$null)

    git stash apply --quiet 'stash@{0}' 2>$null
    $applied = ($LASTEXITCODE -eq 0)
    if ($applied) {
        Write-Host "==> Pulled changes into $Dst" -ForegroundColor Cyan
    } else {
        Write-Error 'wtpull: applied with conflicts — resolve in this worktree.'
    }

    # Restore or retire the stash entry; only touch stash@{0} if it is still ours.
    $tipNow = (git -C $SrcRoot rev-parse -q --verify refs/stash 2>$null)
    if ($tipNow -ne $ourStash) {
        Write-Error 'wtpull: stash stack changed underneath; leaving stash entries alone.'
        return
    }
    if ($Move) {
        if ($applied) {
            git -C $SrcRoot stash drop -q 'stash@{0}'
            Write-Host '==> Moved; source checkout is clean.' -ForegroundColor Gray
        } else {
            Write-Error 'wtpull: kept stash@{0} as backup — drop it after resolving.'
            return
        }
    } else {
        if ($applied) {
            git -C $SrcRoot stash pop -q 'stash@{0}'
            Write-Host '==> Copied; source restored (default is -Move to transfer).' -ForegroundColor Gray
        } else {
            git -C $SrcRoot stash pop -q 'stash@{0}' 2>$null
            Write-Error 'wtpull: source restored; conflicts remain in this worktree.'
            return
        }
    }
}

function wtr {
    param(
        [Parameter(Mandatory = $true, Position = 0)]
        [string]$Branch,
        [Parameter(Position = 1)]
        [string]$ReviewHarness
    )
    if (-not $WtCommand) {
        Write-Error "Worktrunk (wt) is not available."
        return
    }
    & $WtCommand switch $Branch
    if ($LASTEXITCODE -ne 0) { return }

    $GitCommon = (git rev-parse --git-common-dir 2>$null)
    if ($GitCommon) { $GitCommon = $GitCommon.Trim() }
    $BaseBranch = (git rev-parse --abbrev-ref origin/HEAD 2>$null)
    if ($BaseBranch) { $BaseBranch = $BaseBranch -replace '^origin/', '' }
    if (-not $BaseBranch) { $BaseBranch = 'main' }

    Write-Host "`n=== Branch: $Branch (vs $BaseBranch) ===" -ForegroundColor Cyan
    git log --oneline "${BaseBranch}..HEAD" 2>$null
    Write-Host "`n=== Changed Files ===" -ForegroundColor Cyan
    git diff --stat "${BaseBranch}...HEAD" 2>$null

    $SafeBranch = $Branch -replace '/', '_'
    $BusNote = Join-Path $GitCommon "agent-bus/$SafeBranch.md"
    if (-not (Test-Path -LiteralPath $BusNote)) {
        $BusNote = Join-Path $GitCommon "agent-bus/$Branch.md"
    }
    if (Test-Path -LiteralPath $BusNote) {
        Write-Host "`n=== Agent Bus Handoff Note ($BusNote) ===" -ForegroundColor Green
        Get-Content -LiteralPath $BusNote
    }

    if ($ReviewHarness) {
        Write-Host "`n==> Launching review session in $ReviewHarness..." -ForegroundColor Cyan
        $env:AGENT_NO_WT = '1'
        $env:OMP_NO_WT = '1'
        try {
            & $ReviewHarness
        } finally {
            Remove-Item env:AGENT_NO_WT -ErrorAction SilentlyContinue
            Remove-Item env:OMP_NO_WT -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host "`n==> Next steps:`n  wt merge        (verify & merge into $BaseBranch)`n  wt switch -     (back to previous)`n  wt remove $Branch (discard)" -ForegroundColor Gray
    }
}

$OhMyPoshCommand = Get-Command oh-my-posh -ErrorAction SilentlyContinue
if (-not $OhMyPoshCommand) {
    Write-Warning 'Oh My Posh is not installed. Run the dotfiles bootstrap to install it.'
    return
}

$ExpectedVersionPath = Join-Path $HOME '.config/oh-my-posh/expected-version'
if (-not (Test-Path -LiteralPath $ExpectedVersionPath)) {
    Write-Warning "Pinned Oh My Posh version file not found: $ExpectedVersionPath"
    return
}

$ExpectedOhMyPoshVersion = (Get-Content -LiteralPath $ExpectedVersionPath -Raw).Trim()
try {
    $VersionOutput = & $OhMyPoshCommand.Source version 2>$null | Select-Object -First 1
    $InstalledOhMyPoshVersion = $VersionOutput.Trim()
} catch {
    Write-Warning 'Oh My Posh is incompatible or too old. Run the dotfiles bootstrap to install the pinned version.'
    return
}

if ($InstalledOhMyPoshVersion -ne $ExpectedOhMyPoshVersion) {
    Write-Warning "Oh My Posh $InstalledOhMyPoshVersion does not match pinned $ExpectedOhMyPoshVersion. Run the dotfiles bootstrap."
    return
}

$ManagedThemePath = Join-Path $HOME '.config/oh-my-posh/theme.omp.json'
if (-not (Test-Path -LiteralPath $ManagedThemePath)) {
    Write-Warning "Oh My Posh theme not found: $ManagedThemePath"
    return
}

& $OhMyPoshCommand.Source init pwsh --config $ManagedThemePath | Invoke-Expression

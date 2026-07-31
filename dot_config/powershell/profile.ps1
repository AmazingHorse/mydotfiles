# Managed PowerShell 7 profile. Windows $PROFILE should dot-source this file.

$LocalBinDirectory = Join-Path $HOME '.local\bin'
if (Test-Path -LiteralPath $LocalBinDirectory) {
    if (-not (($env:Path -split ';') -contains $LocalBinDirectory)) {
        $env:Path = "$LocalBinDirectory;$env:Path"
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

$RipgrepConfigPath = Join-Path $HOME '.config\ripgrep\config'
if (Test-Path -LiteralPath $RipgrepConfigPath) {
    $env:RIPGREP_CONFIG_PATH = $RipgrepConfigPath
}

if (Get-Command zoxide -ErrorAction SilentlyContinue) {
    Invoke-Expression (& { (zoxide init powershell | Out-String) })
}

# mise's pwsh chpwd hook needs PowerShell 7+. Skip activate on Windows PowerShell 5.1
# (Cursor/system shells often still start 5.1) to avoid noisy warnings.
if ($PSVersionTable.PSVersion.Major -ge 7 -and (Get-Command mise -ErrorAction SilentlyContinue)) {
    mise activate pwsh | Out-String | Invoke-Expression
} elseif ($PSVersionTable.PSVersion.Major -lt 7) {
    $env:MISE_PWSH_CHPWD_WARNING = '0'
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

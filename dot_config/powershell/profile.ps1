# Managed PowerShell 7 profile. Windows $PROFILE should dot-source this file.

$OhMyPoshCommand = Get-Command oh-my-posh -ErrorAction SilentlyContinue
if (-not $OhMyPoshCommand) {
    return
}

$ManagedThemePath = Join-Path $HOME '.config/oh-my-posh/theme.omp.json'
if (-not (Test-Path -LiteralPath $ManagedThemePath)) {
    return
}

oh-my-posh init pwsh --config $ManagedThemePath | Invoke-Expression

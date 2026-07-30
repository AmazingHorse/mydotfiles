# Managed PowerShell 7 profile. Windows $PROFILE should dot-source this file.

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

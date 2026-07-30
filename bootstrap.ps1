#Requires -Version 7.0
[CmdletBinding()]
param(
    [switch]$Ssh,
    [switch]$SkipWsl
)

$ErrorActionPreference = 'Stop'

$RepositoryUrl = if ($env:DOTFILES_REPO_URL) { $env:DOTFILES_REPO_URL } else { 'https://github.com/AmazingHorse/mydotfiles.git' }
$ScriptDirectory = $PSScriptRoot

function Install-ChezmoiIfMissing {
    if (Get-Command chezmoi -ErrorAction SilentlyContinue) {
        return
    }

    Write-Host 'Installing chezmoi...'
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install --id twpayne.chezmoi --exact --accept-package-agreements --accept-source-agreements
    } else {
        iex "&{$(irm 'https://get.chezmoi.io/ps1')}"
    }

    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
        [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

function Invoke-WslBootstrap {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
        Write-Host 'WSL not found; skipping Linux bootstrap.'
        return
    }

    $UbuntuAvailable = & wsl.exe -l -q 2>$null | ForEach-Object { $_.Trim([char]0x00) } | Where-Object { $_ -match 'Ubuntu|Debian' } | Select-Object -First 1
    if (-not $UbuntuAvailable) {
        Write-Host 'No Ubuntu/Debian WSL distro found; skipping Linux bootstrap.'
        return
    }

    Write-Host "Running Linux bootstrap in $UbuntuAvailable..."
    $WslSource = & wsl.exe -d $UbuntuAvailable -e wslpath -a $ScriptDirectory
    $SshFlag = if ($Ssh) { '--ssh' } else { '' }
    & wsl.exe -d $UbuntuAvailable -e bash -lc "cd '$WslSource' && bash ./bootstrap.sh $SshFlag"
}

Install-ChezmoiIfMissing

if ((Test-Path -LiteralPath (Join-Path $ScriptDirectory 'dot_config')) -and (Test-Path -LiteralPath (Join-Path $ScriptDirectory '.chezmoiignore'))) {
    Write-Host "Using local checkout: $ScriptDirectory"
    & chezmoi apply --source $ScriptDirectory
} elseif (Test-Path -LiteralPath (Join-Path $HOME '.local\share\chezmoi\.git')) {
    Write-Host 'Updating existing chezmoi source...'
    & chezmoi update
} else {
    Write-Host "Initializing from $RepositoryUrl"
    & chezmoi init --apply $RepositoryUrl
}

if ($Ssh) {
    $SetupScript = Join-Path $ScriptDirectory 'setup-ssh.ps1'
    if (-not (Test-Path -LiteralPath $SetupScript)) {
        $SetupScript = Join-Path $HOME '.local\share\chezmoi\setup-ssh.ps1'
    }
    & $SetupScript
}

if (-not $SkipWsl) {
    Invoke-WslBootstrap
}

Write-Host 'Done. Open a new PowerShell window to load the managed profile.'

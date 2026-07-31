#Requires -Version 7.0
[CmdletBinding()]
param(
    [switch]$Ssh,
    [switch]$SkipWsl
)

$ErrorActionPreference = 'Stop'

$RepositoryUrl = if ($env:DOTFILES_REPO_URL) { $env:DOTFILES_REPO_URL } else { 'https://github.com/AmazingHorse/mydotfiles.git' }
$ScriptDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$ChezmoiSourceDirectory = Join-Path $HOME '.local\share\chezmoi'

function Install-ChezmoiIfMissing {
    if (Get-Command chezmoi -ErrorAction SilentlyContinue) {
        return
    }

    Write-Host 'Installing chezmoi...'
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install --id twpayne.chezmoi --exact --accept-package-agreements --accept-source-agreements
    } else {
        $InstallerScript = Invoke-RestMethod -Uri 'https://get.chezmoi.io/ps1'
        $InstallerScriptBlock = [scriptblock]::Create($InstallerScript)
        & $InstallerScriptBlock
    }

    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
        [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

function Get-WslDistroReadinessState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DistroName
    )

    $ProbeScript = @'
if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
    systemctl is-system-running 2>/dev/null || true
else
    printf 'ready\n'
fi
'@

    $PreviousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $StateOutput = & wsl.exe -d $DistroName -- bash --noprofile --norc -c $ProbeScript 2>$null
        if ($LASTEXITCODE -ne 0) {
            return 'unavailable'
        }
    } finally {
        $ErrorActionPreference = $PreviousErrorAction
    }

    $StateText = (($StateOutput | Out-String) -replace "`0", '').Trim()
    if ([string]::IsNullOrWhiteSpace($StateText)) {
        return 'unknown'
    }

    return ($StateText -split '\r?\n' | Select-Object -Last 1).Trim()
}

function Wait-WslDistroReady {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DistroName,

        [int]$TimeoutSeconds = 120
    )

    Write-Host "Waiting for WSL distro '$DistroName' to finish starting..."
    $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $Deadline) {
        $State = Get-WslDistroReadinessState -DistroName $DistroName
        switch -Regex ($State) {
            '^(running|degraded|ready)$' {
                Write-Host "WSL distro '$DistroName' is ready ($State)."
                return
            }
            '^(initializing|starting)$' {
                Start-Sleep -Seconds 2
                continue
            }
            default {
                Start-Sleep -Seconds 2
                continue
            }
        }
    }

    throw "Timed out waiting for WSL distro '$DistroName' to become ready."
}

function Invoke-WslBootstrap {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceDirectory
    )

    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
        Write-Host 'WSL not found; skipping Linux bootstrap.'
        return
    }

    $UbuntuAvailable = & wsl.exe -l -q 2>$null |
        ForEach-Object {
            $_.Replace([string][char]0x00, [string]::Empty).Trim()
        } |
        Where-Object { $_ -match 'Ubuntu|Debian' } |
        Select-Object -First 1
    if (-not $UbuntuAvailable) {
        Write-Host 'No Ubuntu/Debian WSL distro found; skipping Linux bootstrap.'
        return
    }

    Wait-WslDistroReady -DistroName $UbuntuAvailable

    Write-Host "Running Linux bootstrap in $UbuntuAvailable..."
    $WslSource = & wsl.exe -d $UbuntuAvailable -- wslpath -a $SourceDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "Could not translate the source path for WSL distro '$UbuntuAvailable'."
    }

    $SshFlag = if ($Ssh) { '--ssh' } else { '' }
    # --noprofile/--norc avoids loading a half-applied shell config during cold start.
    & wsl.exe -d $UbuntuAvailable -- bash --noprofile --norc -lc "cd '$WslSource' && bash ./bootstrap.sh $SshFlag"
    if ($LASTEXITCODE -ne 0) {
        throw "Linux bootstrap failed in WSL distro '$UbuntuAvailable' (exit code $LASTEXITCODE)."
    }
}

Install-ChezmoiIfMissing

if ((Test-Path -LiteralPath (Join-Path $ScriptDirectory 'dot_config')) -and (Test-Path -LiteralPath (Join-Path $ScriptDirectory '.chezmoiignore'))) {
    Write-Host "Using local checkout: $ScriptDirectory"
    & chezmoi init --source $ScriptDirectory
    & chezmoi apply --source $ScriptDirectory
    $ActiveSourceDirectory = $ScriptDirectory
} elseif (Test-Path -LiteralPath (Join-Path $ChezmoiSourceDirectory '.git')) {
    Write-Host 'Updating existing chezmoi source...'
    & chezmoi update --init
    $ActiveSourceDirectory = $ChezmoiSourceDirectory
} else {
    Write-Host "Initializing from $RepositoryUrl"
    & chezmoi init --apply $RepositoryUrl
    $ActiveSourceDirectory = $ChezmoiSourceDirectory
}

if ($Ssh) {
    $SetupScript = Join-Path $ActiveSourceDirectory 'setup-ssh.ps1'
    & $SetupScript
}

if (-not $SkipWsl) {
    Invoke-WslBootstrap -SourceDirectory $ActiveSourceDirectory
}

Write-Host 'Done. Open a new PowerShell window to load the managed profile.'

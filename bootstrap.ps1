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

function Test-WslExecReady {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DistroName,

        [int]$ProbeTimeoutSeconds = 10
    )

    $StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $StartInfo.FileName = 'wsl.exe'
    $StartInfo.UseShellExecute = $false
    $StartInfo.CreateNoWindow = $true
    $StartInfo.RedirectStandardInput = $true
    $StartInfo.RedirectStandardOutput = $true
    $StartInfo.RedirectStandardError = $true
    foreach ($Argument in @('-d', $DistroName, '--', '/bin/true')) {
        $StartInfo.ArgumentList.Add($Argument)
    }

    $ProbeProcess = $null
    try {
        $ProbeProcess = [System.Diagnostics.Process]::Start($StartInfo)
        if ($ProbeProcess.WaitForExit($ProbeTimeoutSeconds * 1000)) {
            return $ProbeProcess.ExitCode -eq 0
        }

        try {
            $ProbeProcess.Kill($true)
            $ProbeProcess.WaitForExit()
        } catch {
            # The process may exit between the timeout and termination request.
        }
        return $false
    } catch {
        return $false
    } finally {
        if ($ProbeProcess) {
            $ProbeProcess.Dispose()
        }
    }
}

function Wait-WslDistroReady {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DistroName,

        [int]$TimeoutSeconds = 120
    )

    Write-Host "Waiting for WSL distro '$DistroName' to accept commands..."
    $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $Deadline) {
        if (Test-WslExecReady -DistroName $DistroName) {
            Write-Host "WSL distro '$DistroName' is accepting commands."
            return
        }
        Start-Sleep -Seconds 2
    }

    throw "Timed out waiting for WSL distro '$DistroName'. Open it once with 'wsl -d $DistroName', complete first-run setup, then retry."
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
    $SourceVariableName = 'DOTFILES_BOOTSTRAP_SOURCE'
    $PreviousSourceValue = [Environment]::GetEnvironmentVariable(
        $SourceVariableName,
        [EnvironmentVariableTarget]::Process
    )
    $PreviousWslEnv = $env:WSLENV
    try {
        [Environment]::SetEnvironmentVariable(
            $SourceVariableName,
            $SourceDirectory,
            [EnvironmentVariableTarget]::Process
        )
        $OtherWslEnvEntries = @(
            $PreviousWslEnv -split ':' |
                Where-Object {
                    $_ -and $_ -notmatch "^${SourceVariableName}(?:/.*)?$"
                }
        )
        $env:WSLENV = (@("${SourceVariableName}/pu") + $OtherWslEnvEntries) -join ':'

        $WslSource = & wsl.exe -d $UbuntuAvailable -- printenv $SourceVariableName
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($WslSource)) {
            throw "Could not translate the source path for WSL distro '$UbuntuAvailable'."
        }
        Write-Host "WSL source: $($WslSource.Trim())"

        # Allocate a PTY with `script` so sudo can prompt for a password.
        $BootstrapCommand = 'cd "$DOTFILES_BOOTSTRAP_SOURCE" && exec bash ./bootstrap.sh'
        if ($Ssh) {
            $BootstrapCommand += ' --ssh'
        }
        $BootstrapArguments = @(
            '-d'
            $UbuntuAvailable
            '--'
            'script'
            '-qec'
            $BootstrapCommand
            '/dev/null'
        )

        $BootstrapStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $BootstrapStartInfo.FileName = 'wsl.exe'
        $BootstrapStartInfo.UseShellExecute = $false
        $BootstrapStartInfo.CreateNoWindow = $false
        foreach ($Argument in $BootstrapArguments) {
            $BootstrapStartInfo.ArgumentList.Add($Argument)
        }

        $BootstrapProcess = [System.Diagnostics.Process]::Start($BootstrapStartInfo)
        try {
            $BootstrapProcess.WaitForExit()
            $BootstrapExitCode = $BootstrapProcess.ExitCode
        } finally {
            $BootstrapProcess.Dispose()
        }
        if ($BootstrapExitCode -ne 0) {
            throw "Linux bootstrap failed in WSL distro '$UbuntuAvailable' (exit code $BootstrapExitCode)."
        }
    } finally {
        [Environment]::SetEnvironmentVariable(
            $SourceVariableName,
            $PreviousSourceValue,
            [EnvironmentVariableTarget]::Process
        )
        $env:WSLENV = $PreviousWslEnv
    }
}

Install-ChezmoiIfMissing

if ((Test-Path -LiteralPath (Join-Path $ScriptDirectory 'dot_config')) -and (Test-Path -LiteralPath (Join-Path $ScriptDirectory '.chezmoiignore'))) {
    Write-Host "Using local checkout: $ScriptDirectory"
    # Bare `chezmoi apply` defaults to ~/.local/share/chezmoi. Point that at
    # this checkout so day-to-day commands work without --source every time.
    $DefaultSourceParent = Split-Path -Parent $ChezmoiSourceDirectory
    if (-not (Test-Path -LiteralPath $DefaultSourceParent)) {
        New-Item -ItemType Directory -Force -Path $DefaultSourceParent | Out-Null
    }
    if (-not (Test-Path -LiteralPath $ChezmoiSourceDirectory)) {
        New-Item -ItemType Junction -Path $ChezmoiSourceDirectory -Target $ScriptDirectory | Out-Null
        Write-Host "Linked $ChezmoiSourceDirectory -> $ScriptDirectory"
    }
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

#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$Target = @(),

    [Alias('i')]
    [string]$Identity = '',

    [Alias('p')]
    [string]$Port = '',

    [Alias('t')]
    [string]$Title = '',

    [switch]$Gh,
    [switch]$Gl,
    [Alias('f')]
    [switch]$Force,

    [string[]]$Copy = @()
)

$ErrorActionPreference = 'Stop'

# Lean SSH helper: create a local Ed25519 key if missing, then print or install the public key.
# Password-manager SSH agents (1Password/Bitwarden) are intentionally not wired here yet.

function Expand-IdentityPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ($Path -eq '~') {
        return $HOME
    }
    if ($Path.StartsWith('~/') -or $Path.StartsWith('~\')) {
        return Join-Path $HOME $Path.Substring(2)
    }
    if (-not [System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Path))
    }
    return [System.IO.Path]::GetFullPath($Path)
}

function Install-PublicKeyOnHost {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetHost,

        [Parameter(Mandatory = $true)]
        [string]$KeyPath,

        [string]$Port = ''
    )

    $PublicKeyContents = (Get-Content -LiteralPath $KeyPath -Raw).Trim()
    if (-not $PublicKeyContents) {
        throw "Public key is empty: $KeyPath"
    }

    $AllSshArgs = @()
    if (-not [string]::IsNullOrWhiteSpace($Port)) {
        $AllSshArgs += @('-p', $Port)
    }

    # Ensure remote ~/.ssh exists with 700 and authorized_keys with 600, then append public key idempotently.
    $RemoteCommand = "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF '$PublicKeyContents' ~/.ssh/authorized_keys || printf '%s\n' '$PublicKeyContents' >> ~/.ssh/authorized_keys"
    $AllSshArgs += @($TargetHost, $RemoteCommand)

    & ssh @AllSshArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install public key on host: $TargetHost"
    }
}

if (-not (Get-Command ssh-keygen -ErrorAction SilentlyContinue)) {
    throw 'ssh-keygen not found. Install Windows OpenSSH Client first.'
}

$SshDirectory = Join-Path $HOME '.ssh'
if ([string]::IsNullOrWhiteSpace($Identity)) {
    $PrivateKeyPath = Join-Path $SshDirectory 'id_ed25519'
} else {
    $PrivateKeyPath = Expand-IdentityPath -Path $Identity
}

# Accept either the private key path or its .pub sibling.
if ($PrivateKeyPath.EndsWith('.pub', [System.StringComparison]::OrdinalIgnoreCase)) {
    $PrivateKeyPath = $PrivateKeyPath.Substring(0, $PrivateKeyPath.Length - 4)
}

$PublicKeyPath = "$PrivateKeyPath.pub"
$KeyBasename = [System.IO.Path]::GetFileName($PrivateKeyPath)
$KeyParentDirectory = Split-Path -Parent $PrivateKeyPath

New-Item -ItemType Directory -Force -Path $KeyParentDirectory | Out-Null

if ($Force -and (Test-Path -LiteralPath $PrivateKeyPath)) {
    $BackupTimestamp = Get-Date -Format 'yyyyMMddHHmmss'
    $BackupPath = "$PrivateKeyPath.bak.$BackupTimestamp"
    Write-Host "Backing up existing key to $BackupPath..."
    Copy-Item -LiteralPath $PrivateKeyPath -Destination $BackupPath -Force
    if (Test-Path -LiteralPath $PublicKeyPath) {
        Copy-Item -LiteralPath $PublicKeyPath -Destination "$PublicKeyPath.bak.$BackupTimestamp" -Force
        Remove-Item -LiteralPath $PublicKeyPath -Force
    }
    Remove-Item -LiteralPath $PrivateKeyPath -Force
}

if (Test-Path -LiteralPath $PrivateKeyPath) {
    Write-Host "Using existing key: $PrivateKeyPath"
    $TempErr = [System.IO.Path]::GetTempFileName()
    $TestProc = Start-Process -FilePath 'ssh-keygen' -ArgumentList @('-y', '-P', '""', '-f', $PrivateKeyPath) -NoNewWindow -PassThru -Wait -RedirectStandardError $TempErr
    if ($TestProc.ExitCode -ne 0) {
        Write-Warning "$PrivateKeyPath is encrypted with a passphrase. To regenerate without a passphrase, re-run with: -Force (or -f)"
    }
    Remove-Item -LiteralPath $TempErr -Force -ErrorAction SilentlyContinue
} elseif (Test-Path -LiteralPath $PublicKeyPath) {
    Write-Host "Public key exists but private key missing: $PublicKeyPath"
    Write-Host "To regenerate, re-run with: -Force (or -f)"
    throw "Public key exists without private key."
} else {
    $KeyComment = '{0}@{1}' -f $env:USERNAME, $env:COMPUTERNAME
    if ($KeyBasename -ne 'id_ed25519') {
        $KeyComment = '{0}-{1}' -f $KeyComment, $KeyBasename
    }
    $EmptyPassphrase = ''
    & ssh-keygen -t ed25519 -a 100 -f $PrivateKeyPath -C $KeyComment -N $EmptyPassphrase
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to generate SSH key: $PrivateKeyPath"
    }
    Write-Host "Created new key (no passphrase): $PrivateKeyPath"
}

Write-Host "Public key: $PublicKeyPath"
Get-Content -LiteralPath $PublicKeyPath | Write-Host

$DateLabel = Get-Date -Format 'yyyyMMdd'
if (-not [string]::IsNullOrWhiteSpace($Title)) {
    $KeyTitle = $Title
} elseif ($KeyBasename -eq 'id_ed25519') {
    $KeyTitle = '{0}-{1}' -f $env:COMPUTERNAME, $DateLabel
} else {
    $KeyTitle = '{0}-{1}-{2}' -f $env:COMPUTERNAME, $KeyBasename, $DateLabel
}

if ($Gh) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw 'gh not found. Install GitHub CLI, then re-run with -Gh.'
    }

    & gh auth status 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw 'gh is not authenticated. Run: gh auth login'
    }

    & gh ssh-key add $PublicKeyPath --title $KeyTitle
    if ($LASTEXITCODE -ne 0) {
        throw 'GitHub SSH key upload failed.'
    }
    Write-Host "Uploaded public key to GitHub as $KeyTitle"
}

if ($Gl) {
    if (-not (Get-Command glab -ErrorAction SilentlyContinue)) {
        throw 'glab not found. Install GitLab CLI, then re-run with -Gl.'
    }

    & glab auth status 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw 'glab is not authenticated. Run: glab auth login'
    }

    & glab ssh-key add $PublicKeyPath -t $KeyTitle
    if ($LASTEXITCODE -ne 0) {
        throw 'GitLab SSH key upload failed.'
    }
    Write-Host "Uploaded public key to GitLab as $KeyTitle"
}

$AllTargets = @($Target) + @($Copy) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

foreach ($CopyTarget in $AllTargets) {
    Write-Host "Installing public key on $CopyTarget..."
    Install-PublicKeyOnHost -TargetHost $CopyTarget -KeyPath $PublicKeyPath -Port $Port
    Write-Host "Installed public key on $CopyTarget"
}

if (-not $Gh -and -not $Gl -and $AllTargets.Count -eq 0) {
    Write-Host @"

Next steps:
  gh auth login
  glab auth login
  .\setup-ssh.ps1 -Gh -Gl
  .\setup-ssh.ps1 user@host                     # copy key to host (ssh-copy-id)
  .\setup-ssh.ps1 -Identity ~/.ssh/other_key user@host
"@
}

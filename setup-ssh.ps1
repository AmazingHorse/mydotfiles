#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$Identity = '',
    [switch]$Gh,
    [switch]$Gl,
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

    if ($Path.StartsWith('~/') -or $Path -eq '~') {
        return Join-Path $HOME $Path.Substring(2)
    }

    return $Path
}

function Install-PublicKeyOnHost {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetHost,

        [Parameter(Mandatory = $true)]
        [string]$KeyPath
    )

    $PublicKeyContents = (Get-Content -LiteralPath $KeyPath -Raw).Trim()
    if (-not $PublicKeyContents) {
        throw "Public key is empty: $KeyPath"
    }

    $SshCopyIdCommand = Get-Command ssh-copy-id -ErrorAction SilentlyContinue
    if ($SshCopyIdCommand) {
        & $SshCopyIdCommand.Source -i $KeyPath $TargetHost
        if ($LASTEXITCODE -ne 0) {
            throw "ssh-copy-id failed for $TargetHost"
        }
        return
    }

    # Portable fallback for hosts without ssh-copy-id (common on Windows).
    $RemoteCommand = @(
        'mkdir -p ~/.ssh'
        'chmod 700 ~/.ssh'
        'touch ~/.ssh/authorized_keys'
        'chmod 600 ~/.ssh/authorized_keys'
        "grep -qxF '$PublicKeyContents' ~/.ssh/authorized_keys || printf '%s\n' '$PublicKeyContents' >> ~/.ssh/authorized_keys"
    ) -join ' && '

    & ssh $TargetHost $RemoteCommand
    if ($LASTEXITCODE -ne 0) {
        throw "Portable key install failed for $TargetHost"
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

if (-not (Test-Path -LiteralPath $PrivateKeyPath)) {
    $KeyComment = '{0}@{1}' -f $env:USERNAME, $env:COMPUTERNAME
    if ($KeyBasename -ne 'id_ed25519') {
        $KeyComment = '{0}-{1}' -f $KeyComment, $KeyBasename
    }
    & ssh-keygen -t ed25519 -a 100 -f $PrivateKeyPath -C $KeyComment -N '""'
    Write-Host "Created $PrivateKeyPath"
} else {
    Write-Host "Key already exists: $PrivateKeyPath"
}

Write-Host "Public key: $PublicKeyPath"
Get-Content -LiteralPath $PublicKeyPath | Write-Host

$DateLabel = Get-Date -Format 'yyyyMMdd'
if ($KeyBasename -eq 'id_ed25519') {
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

foreach ($CopyTarget in $Copy) {
    Write-Host "Installing public key on $CopyTarget..."
    Install-PublicKeyOnHost -TargetHost $CopyTarget -KeyPath $PublicKeyPath
    Write-Host "Installed public key on $CopyTarget"
}

if (-not $Gh -and -not $Gl -and $Copy.Count -eq 0) {
    Write-Host @"

Next steps:
  gh auth login
  glab auth login
  .\setup-ssh.ps1 -Gh -Gl
  .\setup-ssh.ps1 -Identity ~/.ssh/business_ed25519 -Gh -Gl -Copy ansible.gbtel.ca
"@
}

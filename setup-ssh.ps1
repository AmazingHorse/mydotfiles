#Requires -Version 7.0
[CmdletBinding()]
param(
    [switch]$Gh
)

$ErrorActionPreference = 'Stop'

# Lean SSH helper: create a local Ed25519 key if missing, then print or upload the public key.
# Password-manager SSH agents (1Password/Bitwarden) are intentionally not wired here yet.

$SshDirectory = Join-Path $HOME '.ssh'
$PrivateKeyPath = Join-Path $SshDirectory 'id_ed25519'
$PublicKeyPath = "$PrivateKeyPath.pub"

if (-not (Get-Command ssh-keygen -ErrorAction SilentlyContinue)) {
    throw 'ssh-keygen not found. Install Windows OpenSSH Client first.'
}

New-Item -ItemType Directory -Force -Path $SshDirectory | Out-Null

if (-not (Test-Path -LiteralPath $PrivateKeyPath)) {
    $KeyComment = '{0}@{1}' -f $env:USERNAME, $env:COMPUTERNAME
    & ssh-keygen -t ed25519 -a 100 -f $PrivateKeyPath -C $KeyComment -N '""'
    Write-Host "Created $PrivateKeyPath"
} else {
    Write-Host "Key already exists: $PrivateKeyPath"
}

Write-Host "Public key: $PublicKeyPath"
Get-Content -LiteralPath $PublicKeyPath | Write-Host

if ($Gh) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw 'gh not found. Install GitHub CLI, then re-run with -Gh.'
    }

    & gh auth status 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw 'gh is not authenticated. Run: gh auth login'
    }

    $KeyTitle = '{0}-{1}' -f $env:COMPUTERNAME, (Get-Date -Format 'yyyyMMdd')
    & gh ssh-key add $PublicKeyPath --title $KeyTitle
    Write-Host "Uploaded public key to GitHub as $KeyTitle"
} else {
    Write-Host @"

Next steps:
  gh auth login
  .\setup-ssh.ps1 -Gh
  # or paste the public key into GitHub → Settings → SSH keys
"@
}

# Agent control plane env for native Windows. Linux/WSL use ~/.config/agent-env.sh.
if ($PSVersionTable.PSVersion.Major -ge 6 -and -not $IsWindows) {
    return
}

$env:AGENT_HOME = Join-Path $HOME '.omp'
$env:AGENT_ENV = 'windows'
if (-not $env:OLLAMA_HOST) {
    $env:OLLAMA_HOST = 'http://127.0.0.1:11434'
}

$SecretsPath = Join-Path $HOME '.config\agent-secrets.ps1'
if (Test-Path -LiteralPath $SecretsPath) {
    . $SecretsPath
}
$LocalEnvPath = Join-Path $HOME '.config\powershell\agent-env.local.ps1'
if (Test-Path -LiteralPath $LocalEnvPath) {
    . $LocalEnvPath
}

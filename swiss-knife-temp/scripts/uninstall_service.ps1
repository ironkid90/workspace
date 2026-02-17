param(
  [string]$ServiceName = "ai-agent-swiss-knife"
)

$ErrorActionPreference = "Stop"

$winswDir = Join-Path $PSScriptRoot "winsw"
$exePath = Join-Path $winswDir "ai-agents-swiss-knife.exe"

try {
  sc.exe stop $ServiceName | Out-Null
} catch {
}

if (Test-Path $exePath) {
  & $exePath stop | Out-Null
  & $exePath uninstall | Out-Null
}

try {
  sc.exe delete $ServiceName | Out-Null
} catch {
}

Write-Host "Service deleted: $ServiceName"

param(
  [string]$ServiceName = "ai-agent-swiss-knife",
  [string]$DisplayName = "AI Agent's Swiss Knife",
  [string]$Description = "Local MCP server for AI agents",
  [string]$WinSwVersion = "2.12.0"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$logsDir = Join-Path $repoRoot "logs"
if (-not (Test-Path $logsDir)) {
  New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
}

$winswDir = Join-Path $PSScriptRoot "winsw"
$exePath = Join-Path $winswDir "ai-agents-swiss-knife.exe"
$xmlPath = Join-Path $winswDir "ai-agents-swiss-knife.xml"
$templatePath = Join-Path $winswDir "ai-agents-swiss-knife.xml.template"

if (-not (Test-Path $templatePath)) {
  throw "WinSW template missing: $templatePath"
}

if (-not (Test-Path $exePath)) {
  New-Item -ItemType Directory -Force -Path $winswDir | Out-Null
  $url = "https://github.com/winsw/winsw/releases/download/v$WinSwVersion/WinSW-x64.exe"
  Invoke-WebRequest -Uri $url -OutFile $exePath
}

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
  throw "python not found on PATH"
}
$pythonPath = $pythonCmd.Path

Copy-Item -Force $templatePath $xmlPath

$xml = Get-Content -Raw $xmlPath
$xml = $xml -replace '<executable>.*?</executable>', "<executable>$pythonPath</executable>"
$xml = $xml -replace '<workingdirectory>.*?</workingdirectory>', "<workingdirectory>$repoRoot</workingdirectory>"
$xml = $xml -replace '<logpath>.*?</logpath>', "<logpath>$repoRoot\\logs</logpath>"
$xml = $xml -replace '<stdout>.*?</stdout>', "<stdout>$repoRoot\\logs\\server.out.log</stdout>"
$xml = $xml -replace '<stderr>.*?</stderr>', "<stderr>$repoRoot\\logs\\server.err.log</stderr>"
$xml = $xml -replace '<env name=\"MCP_ALLOWED_BASE\" value=\".*?\" />', ('<env name="MCP_ALLOWED_BASE" value="' + $repoRoot + '" />')
Set-Content -Path $xmlPath -Value $xml -Encoding ASCII

# Remove an existing service with the same name if it exists (sc-created or old WinSW).
try {
  sc.exe stop $ServiceName | Out-Null
} catch {
}
try {
  sc.exe delete $ServiceName | Out-Null
} catch {
}

& $exePath install | Out-Null
& $exePath start | Out-Null

Write-Host "Service installed and started: $ServiceName"
Write-Host "Logs: $logsDir\\server.out.log and $logsDir\\server.err.log"

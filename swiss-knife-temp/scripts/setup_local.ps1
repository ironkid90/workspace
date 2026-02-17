$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$VenvDir = Join-Path $RootDir ".venv"
$PythonExe = if ($env:PYTHON) { $env:PYTHON } else { "python" }
$HostName = if ($env:MCP_HOST) { $env:MCP_HOST } else { "127.0.0.1" }
$Port = if ($env:MCP_PORT) { $env:MCP_PORT } else { "8080" }
$BaseUrl = "http://$HostName`:$Port"

& $PythonExe -m venv $VenvDir
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install -e $RootDir

$ServerProcess = Start-Process -FilePath $VenvPython -ArgumentList "-m", "server.mcp_server" -PassThru -WindowStyle Hidden
try {
    $healthy = $false
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method GET -TimeoutSec 2
            if ($health.ok -eq $true) {
                $healthy = $true
                $health | ConvertTo-Json -Depth 4
                Write-Host "setup complete"
                break
            }
        }
        catch {
            Start-Sleep -Seconds 1
        }
    }

    if (-not $healthy) {
        throw "Failed to validate $BaseUrl/health"
    }
}
finally {
    if ($ServerProcess -and -not $ServerProcess.HasExited) {
        Stop-Process -Id $ServerProcess.Id -Force
    }
}

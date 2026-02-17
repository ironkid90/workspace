Write-Host "=== Fixing WSL Installation Issues ===" -ForegroundColor Cyan

# 1. Fix Virtual Disk Service
try {
    Write-Host "Configuring Virtual Disk service (vds)..."
    Set-Service -Name "vds" -StartupType Automatic
    Start-Service "vds"
    Write-Host "SUCCESS: Virtual Disk service started." -ForegroundColor Green
} catch {
    Write-Error "ERROR: Failed to start Virtual Disk service. $_"
}

# 2. Enable Windows Features
$features = @("VirtualMachinePlatform", "Microsoft-Windows-Subsystem-Linux")
$needsRestart = $false

foreach ($feature in $features) {
    try {
        $status = Get-WindowsOptionalFeature -Online -FeatureName $feature
        if ($status.State -ne "Enabled") {
            Write-Host "Enabling feature: $feature..." -ForegroundColor Yellow
            Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart | Out-Null
            Write-Host "SUCCESS: Enabled $feature." -ForegroundColor Green
            $needsRestart = $true
        } else {
            Write-Host "OK: $feature is already enabled." -ForegroundColor Green
        }
    } catch {
        Write-Error "ERROR: Failed to check/enable $feature. $_"
    }
}

# 3. Final instructions
Write-Host "`n========================================" -ForegroundColor Cyan
if ($needsRestart) {
    Write-Host "IMPORTANT: A system restart is REQUIRED to finish enabling features." -ForegroundColor Red
    Write-Host "Please restart your computer manually." -ForegroundColor Yellow
} else {
    Write-Host "Fix applied. You can now try installing WSL Ubuntu again." -ForegroundColor Green
}
Read-Host "Press Enter to close this window..."

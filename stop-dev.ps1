<#
.SYNOPSIS
    Остановка запущенных сервисов vitauto (Go API + PWA).
.EXAMPLE
    .\stop-dev.ps1
#>
param()

Write-Host "`n[.] Остановка процессов vitauto..." -ForegroundColor Yellow

# Go API
Get-Process -Name vitauto-api -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "  [OK] vitauto-api" -ForegroundColor Green

# PWA (vite через npx)
Get-Process -Name vite -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'vitauto|vite' } | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "  [OK] PWA (vite)" -ForegroundColor Green

# Go build artifact
if (Test-Path bin\vitauto-api.exe) {
    Remove-Item bin\vitauto-api.exe -ErrorAction SilentlyContinue
    Write-Host "  [OK] удалён bin\vitauto-api.exe" -ForegroundColor Green
}

Write-Host "`n[OK] Остановлено." -ForegroundColor Green

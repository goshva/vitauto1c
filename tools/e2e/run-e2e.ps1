#Requires -Version 5.1
<#
.SYNOPSIS
  Сквозные сценарии АРМ (tools/e2e/arm-processes.e2e.js) через OData тестовой базы.
  Нужны: рабочая копия pwa/ из ветки pwa-odata с установленными зависимостями (npm ci), публикация OData с входом
  по Basic (без Usr в default.vrd), пользователи arm.* (odata/pwa-test-users.js), seed tools/e2e/seed-e2e.ps1.
.EXAMPLE
  git archive origin/pwa-odata pwa odata -o D:\1c\e2e\src.zip; Expand-Archive D:\1c\e2e\src.zip D:\1c\e2e; cd D:\1c\e2e\pwa; npm ci --include=dev
  .\tools\e2e\run-e2e.ps1 -PwaDir D:\1c\e2e\pwa -Only happy,stock,mixed_order
#>
param(
    [Parameter(Mandatory)] [string]$PwaDir,
    [string]$OdataUrl = 'http://127.0.0.1:8090/e2e/odata/standard.odata',
    [string[]]$Only = @('happy', 'stock', 'mixed_order'),
    [string]$Report = (Join-Path $PSScriptRoot 'e2e-report.md')
)
$ErrorActionPreference = 'Stop'
Copy-Item (Join-Path $PSScriptRoot 'arm-processes.e2e.js') (Join-Path $PwaDir 'e2e\arm-processes.e2e.js') -Force
if (-not (Test-Path (Join-Path $PwaDir 'node_modules\.bin\vitest.cmd'))) { throw "Нет vitest в $PwaDir — выполните там: npm ci --include=dev" }
$env:NODE_ENV = 'test'; $env:ODATA_URL = $OdataUrl; $env:E2E_ONLY = ($Only -join ','); $env:E2E_REPORT = $Report
Push-Location $PwaDir
try {
    & npx.cmd vitest run -c vitest.e2e.config.js e2e/arm-processes.e2e.js
    $code = $LASTEXITCODE
} finally { Pop-Location }
Write-Host "Отчёт: $Report"
exit $code

<#
.SYNOPSIS
    Проверка наличия и готовности компонентов для запуска vitauto без 1С.
.DESCRIPTION
    Проверяет: Go, Node.js, PostgreSQL (psql в PATH или в стандартном каталоге), Git.
    Авто-повышение прав: если не админ — перезапускает себя с UAC.
.PARAMETER NoPrompt
    Не ждать нажатия Enter в конце.
.EXAMPLE
    .\check-setup.ps1
    .\check-setup.ps1 -NoPrompt
#>
param(
    [switch]$NoPrompt
)

# ── Авто-повышение прав ────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "`n[!] Требуется запуск от Администратора. Перезапуск..." -ForegroundColor Yellow
    $scriptPath = $MyInvocation.MyCommand.Path
    $argsStr = if ($NoPrompt) { '-NoPrompt' } else { '' }
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" $argsStr"
    exit 0
}

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ErrorCount = 0
$WarningCount = 0

function Write-Header($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "  [OK] $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  [WARN] $text" -ForegroundColor Yellow; $script:WarningCount++ }
function Write-Err($text) { Write-Host "  [FAIL] $text" -ForegroundColor Red; $script:ErrorCount++ }

# ── Go ──────────────────────────────────────────────────────────────────────
Write-Header "Go"
$goPath = Get-Command go -ErrorAction SilentlyContinue
if ($goPath) {
    $goVer = & go version 2>$null
    Write-Ok "Go установлен: $goVer"
} else {
    Write-Err "Go не найден в PATH"
    Write-Host "      Установка: https://go.dev/doc/install" -ForegroundColor DarkGray
}

# ── Node.js ─────────────────────────────────────────────────────────────────
Write-Header "Node.js"
$nodePath = Get-Command node -ErrorAction SilentlyContinue
if ($nodePath) {
    $nodeVer = & node --version 2>$null
    Write-Ok "Node.js установлен: $nodeVer"
    $npmVer = & npm --version 2>$null
    Write-Ok "npm установлен: $npmVer"
} else {
    Write-Err "Node.js не найден в PATH"
    Write-Host "      Установка: https://nodejs.org (LTS)" -ForegroundColor DarkGray
}

# ── PostgreSQL ──────────────────────────────────────────────────────────────
Write-Header "PostgreSQL"
$pgPort = 5432
$pgFound = $false
$pgRunning = $false
$pgBinPath = $null

# Ищем psql в PATH
$pgClient = Get-Command psql -ErrorAction SilentlyContinue
if ($pgClient) {
    Write-Ok "psql найден в PATH: $($pgClient.Source)"
    $pgFound = $true
    $pgBinPath = Split-Path $pgClient.Source
}

# Ищем psql в стандартном каталоге
$stdPgBin = 'C:\Program Files\PostgreSQL 1C\18\bin\psql.exe'
if (-not $pgClient -and (Test-Path $stdPgBin)) {
    Write-Ok "psql найден в стандартном каталоге: $stdPgBin"
    $pgFound = $true
    $pgBinPath = Split-Path $stdPgBin
}

# Ищем службы PostgreSQL
$pgServices = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue
foreach ($s in $pgServices) {
    $status = $s.Status
    if ($status -eq 'Running') { $pgRunning = $true }
    Write-Ok "Служба: $($s.Name) (статус: $status)"
    $pgFound = $true
}

# Ищем PostgreSQL 1C
$pgSrv1c = Get-Service -Name '*1c*' -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*postgresql*' }
if ($pgSrv1c) {
    $status = $pgSrv1c.Status
    if ($status -eq 'Running') { $pgRunning = $true }
    Write-Ok "PostgreSQL 1C: $($pgSrv1c.Name) (статус: $status)"
    $pgFound = $true
}

if (-not $pgFound) {
    Write-Err "PostgreSQL не найден (нет службы и psql в PATH или стандартном каталоге)"
    Write-Host "      Установка: https://www.postgresql.org/download/windows/" -ForegroundColor DarkGray
    Write-Host "      Порт по умолчанию для vitauto: $pgPort" -ForegroundColor DarkGray
} else {
    # Проверяем порт
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect('localhost', $pgPort)
        $tcp.Close()
        Write-Ok "Порт $pgPort: PostgreSQL запущен и принимает соединения"
        $pgRunning = $true
    } catch {
        Write-Warn "Порт $pgPort не отвечает — PostgreSQL запущен, но не принимает на этом порту"
    }
}

# ── Git ─────────────────────────────────────────────────────────────────────
Write-Header "Git"
$gitPath = Get-Command git -ErrorAction SilentlyContinue
if ($gitPath) {
    $gitVer = & git --version 2>$null
    Write-Ok "Git установлен: $gitVer"
} else {
    Write-Warn "Git не найден в PATH (не критично для запуска)"
}

# ── Итог ────────────────────────────────────────────────────────────────────
Write-Header "ИТОГ"
if ($ErrorCount -eq 0 -and $WarningCount -eq 0) {
    Write-Host "  Все компоненты найдены. Можно запускать." -ForegroundColor Green
} elseif ($ErrorCount -eq 0) {
    Write-Host "  Предупреждений: $WarningCount. Запуск возможен, но проверьте предупреждения выше." -ForegroundColor Yellow
} else {
    Write-Host "  Ошибок: $ErrorCount, Предупреждений: $WarningCount." -ForegroundColor Red
    Write-Host "  Необходимо исправить ошибки перед запуском." -ForegroundColor Red
}

if (-not $NoPrompt) {
    Write-Host "`nНажмите Enter для выхода..." -ForegroundColor DarkGray
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
}

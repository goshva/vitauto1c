#Requires -Version 5.1
<#
.SYNOPSIS
  Проверка страницы матрицы index.html в настоящем браузере: каждая колонка default-matrix.js выведена
  в шапке предпросмотра и строкой матрицы — с кодом из column-codes.js, заголовком, типом данных и 15 клетками прав.

  Chrome (или Edge) запускается без окна с --dump-dom: страница выполняет свои скрипты, проверяется готовый DOM.
  Код выхода 0 — всё на месте, 1 — есть расхождения (перечислены).

.EXAMPLE
  .\tools\check-matrix-page.ps1
  .\tools\check-matrix-page.ps1 -Columns invoice_number,stock_cell
#>
param(
    [string[]]$Columns,                     # проверить только эти id (по умолчанию — все колонки матрицы)
    [string]$Browser
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Browser) {
    $Browser = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Browser) { throw 'Не найден Chrome или Edge (-Browser <путь>)' }

# колонки, коды и статусы — из тех же файлов, что читает страница
$dm = [IO.File]::ReadAllText((Join-Path $root 'default-matrix.js'), [Text.Encoding]::UTF8)
$matrix = ($dm -replace '(?s)^.*?VITAUTO_DEFAULT_MATRIX\s*=\s*', '' -replace ';\s*$', '') | ConvertFrom-Json
$cols = if ($Columns) { $Columns } else { $matrix.columns }
$statusCount = $matrix.statuses.Count

$tmp = Join-Path $env:TEMP ('matrix-page-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $tmp | Out-Null
try {
    $dom = Join-Path $tmp 'dom.html'
    $url = 'file:///' + ((Join-Path $root 'index.html') -replace '\\', '/')
    $p = Start-Process $Browser -ArgumentList '--headless=new', '--disable-gpu', "--user-data-dir=$tmp\profile",
        '--virtual-time-budget=5000', '--dump-dom', $url -RedirectStandardOutput $dom -RedirectStandardError "$tmp\err.txt" -Wait -PassThru -WindowStyle Hidden
    if ($p.ExitCode -ne 0 -or -not (Test-Path $dom) -or (Get-Item $dom).Length -lt 1000) { throw "браузер не отрисовал страницу (код $($p.ExitCode))" }
    $d = [IO.File]::ReadAllText($dom, [Text.Encoding]::UTF8)
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

$problems = New-Object System.Collections.Generic.List[string]
$rows = foreach ($c in $cols) {
    if ($matrix.columns -notcontains $c) { $problems.Add("$c — нет в default-matrix.js"); continue }
    $head = [regex]::Match($d, "<th data-col=`"$c`"[^>]*><span class=`"col-code`">([^<]+)</span>([^<]+)")
    $i = $d.IndexOf("<tr data-col=`"$c`"")
    if (-not $head.Success) { $problems.Add("$c — нет в шапке предпросмотра") }
    if ($i -lt 0) { $problems.Add("$c — нет строки в матрице"); continue }
    $row = $d.Substring($i, $d.IndexOf('</tr>', $i) - $i)
    $code = [regex]::Match($row, '<span class="col-code">([^<]+)</span>').Groups[1].Value
    $type = [regex]::Match($row, '<option value="(\w+)" selected').Groups[1].Value
    $cells = [regex]::Matches($row, 'class="matrix-cell ([\w-]+)"') | ForEach-Object { $_.Groups[1].Value }
    if (-not $code) { $problems.Add("$c — нет кода колонки") }
    if ($head.Success -and $head.Groups[1].Value -ne $code) { $problems.Add("$c — код в шапке $($head.Groups[1].Value), в матрице $code") }
    if ($matrix.columnTypes.$c -and $type -ne $matrix.columnTypes.$c) { $problems.Add("$c — тип $type, в default-matrix.js $($matrix.columnTypes.$c)") }
    if (@($cells).Count -ne $statusCount) { $problems.Add("$c — клеток $(@($cells).Count), статусов $statusCount") }
    [pscustomobject]@{
        Код = $code; Колонка = $c; Заголовок = $head.Groups[2].Value; Тип = $type
        Можно = @($cells | Where-Object { $_ -eq 'cell-green' }).Count
    }
}
$rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
Write-Host ("колонок проверено: {0}, «Можно» — разрешённых статусов на открытой по умолчанию вкладке роли" -f @($rows).Count)
if ($problems.Count) { $problems | ForEach-Object { Write-Host "  [X] $_" -ForegroundColor Red }; exit 1 }
Write-Host 'расхождений нет' -ForegroundColor Green

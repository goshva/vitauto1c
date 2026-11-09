# Демо-фото для карточек номенклатуры (ТЗ 2.1): загружает локальные изображения через API.
# Нужен запущенный vitauto-api и PostgreSQL с демо-данными (schema-up + seed\demo-app.sql).
#   .\seed\demo-photos.ps1
#   .\seed\demo-photos.ps1 -Api http://127.0.0.1:18100/api/v1 -Image .\photo.jpg
param(
    [string]$Api = 'http://127.0.0.1:18100/api/v1',
    [string]$Login = 'Администратор',
    [string]$Password = 'admin123',
    [string]$Image = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent

if (-not $Image) {
    $Image = Get-ChildItem (Join-Path $Root 'photo_*.jpg') -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Image -or -not (Test-Path $Image)) { throw 'Нет изображения: укажите -Image путь\к\фото.jpg' }
$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
if (-not $curl) { throw 'Нужен curl.exe (есть в Windows 10/11)' }

$body = @{ login = $Login; password = $Password } | ConvertTo-Json -Compress
$bytes = [Text.Encoding]::UTF8.GetBytes($body)
$session = Invoke-RestMethod -Uri "$Api/session" -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8'
Write-Host "[OK] вход: $($session.userName) ($($session.role))"

# Карточки, к которым прикладываем фото: фильтр масляный и услуга диагностики.
$cards = @(
    @{ id = '77777777-7777-7777-7777-777777777702'; label = 'Фильтр масляный' },
    @{ id = '77777777-7777-7777-7777-777777777716'; label = 'Неопознанная деталь' }
)

foreach ($c in $cards) {
    $out = & $curl -s -X POST "$Api/attachments" `
        -H "Authorization: Bearer $($session.token)" `
        -F "ownerType=nomenclature" `
        -F "ownerId=$($c.id)" `
        -F "file=@$Image;type=image/jpeg" 2>&1
    try {
        $att = $out | ConvertFrom-Json
        Write-Host "[OK] $($c.label): $($att.name), $($att.size) байт -> $($att.url)"
    } catch {
        Write-Host "[FAIL] $($c.label): $out"
    }
}
Write-Host "Фото: $Api/catalog/goods/77777777-7777-7777-7777-777777777702"

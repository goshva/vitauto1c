# Заказ-наряд: убрать колонки «Сумма без скидки», «Скидка» и строку «Плательщик» в печатной форме.
# Пишет исправленный макет в регистр «Пользовательские макеты печати» через OData 1С.
#
#   zn-fix.ps1 -Mode apply   — исправить (по умолчанию)
#   zn-fix.ps1 -Mode revert  — вернуть как было (из резервной копии zn-backup.json)
#   zn-fix.ps1 -Mode check   — только показать, что сейчас в базе
#
# Пароль спрашивается при запуске. Рядом со скриптом должен лежать zn-layout.b64.

param(
    [ValidateSet('apply', 'revert', 'check')]
    [string]$Mode = 'apply',
    [string]$OData = 'http://localhost/autoservice/odata/standard.odata',
    [string]$User = 'Администратор',
    [string]$Password,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$logFile = Join-Path $dir 'zn-fix-log.txt'
$backupFile = Join-Path $dir 'zn-backup.json'
$layoutFile = Join-Path $dir 'zn-layout.b64'

function Log([string]$m) {
    $line = '{0}  {1}' -f (Get-Date -Format 'dd.MM.yyyy HH:mm:ss'), $m
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

if (-not $OData.EndsWith('/')) { $OData += '/' }
if ($Password) {
    $plain = $Password
} else {
    $sec = Read-Host "Пароль пользователя 1С '$User'" -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${User}:$plain"))

$Entity = 'InformationRegister_ПользовательскиеМакетыПечати'
$Object = 'Документ.асЗаказНаряд'
$DefaultName = 'ПФ_MXL_ЗаказНаряд'

function Call([string]$Method, [string]$Path, $Body = $null) {
    $sep = if ($Path.Contains('?')) { '&' } else { '?' }
    $uri = $OData + $Path + $sep + '$format=json'
    $p = @{ UseBasicParsing = $true; Method = $Method; Uri = $uri; Headers = @{ Authorization = $auth } }
    if ($null -ne $Body) {
        $p.ContentType = 'application/json; charset=utf-8'
        $p.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 5 -Compress))
    }
    $r = Invoke-WebRequest @p
    $text = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
    if ($text) { return $text | ConvertFrom-Json }
}

function KeyPath([string]$name) {
    return "$Entity(Объект='$Object',ИмяМакета='$name')"
}

function LayoutXml([string]$b64) {
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($b64 -replace '\s', '')))
}

function IsFixed([string]$xml) {
    return (-not $xml.Contains('Сумма без скидки')) -and (-not $xml.Contains('Плательщик:'))
}

function FindRecord {
    $all = Call 'GET' ("$Entity" + '?$filter=' + [Uri]::EscapeDataString("Объект eq '$Object'"))
    $rec = $all.value | Where-Object { $_.ИмяМакета -like "$DefaultName*" -and $_.ИмяМакета -notlike 'ПФ_MXL_ЗаказНарядДоговор*' } |
        Sort-Object ИмяМакета -Descending | Select-Object -First 1
    return $rec
}

try {
    Log "---- режим: $Mode, база: $OData, пользователь: $User"
    $rec = FindRecord
    if ($rec) {
        $state = if (IsFixed (LayoutXml $rec.Макет_Base64Data)) { 'уже исправлен' } else { 'НЕ исправлен' }
        Log "В базе есть изменённый макет '$($rec.ИмяМакета)', используется: $($rec.Использование), $state."
    } else {
        Log 'Изменённого макета в базе нет — печать идёт по стандартному макету (со скидками и плательщиком).'
    }

    if ($Mode -eq 'check') { return }

    if ($Mode -eq 'apply') {
        if (-not (Test-Path $layoutFile)) { throw "Нет файла $layoutFile" }
        $newB64 = ((Get-Content $layoutFile -Raw) -replace '\s', '')
        if (-not (IsFixed (LayoutXml $newB64))) { throw 'zn-layout.b64 не похож на исправленный макет — остановка.' }

        if ($rec -and $rec.Использование -and (IsFixed (LayoutXml $rec.Макет_Base64Data))) {
            Log 'Менять нечего — макет уже исправлен.'
            return
        }
        if ($rec -and -not $Force) {
            Log 'ВНИМАНИЕ: в базе уже есть свой изменённый макет заказ-наряда. Он будет заменён (копия сохранится в zn-backup.json).'
            $ans = Read-Host 'Продолжить? (y/n)'
            if ($ans -notin @('y', 'Y', 'д', 'Д')) { Log 'Отменено.'; return }
        }

        if (-not (Test-Path $backupFile)) {
            $backup = if ($rec) { $rec } else { [pscustomobject]@{ none = $true } }
            [IO.File]::WriteAllText($backupFile, ($backup | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
            Log 'Резервная копия: zn-backup.json'
        } else {
            Log 'zn-backup.json уже есть — не перезаписываю (там состояние до первого исправления).'
        }

        $body = @{ Макет_Type = 'application/xml+xdto'; Макет_Base64Data = $newB64; Использование = $true }
        if ($rec) {
            Call 'PATCH' (KeyPath $rec.ИмяМакета) $body | Out-Null
            Log "Макет '$($rec.ИмяМакета)' заменён исправленным."
        } else {
            $body.Объект = $Object
            $body.ИмяМакета = $DefaultName
            Call 'POST' $Entity $body | Out-Null
            Log "Записан исправленный макет '$DefaultName'."
        }
    }

    if ($Mode -eq 'revert') {
        if (-not (Test-Path $backupFile)) { throw 'Нет zn-backup.json — нечего возвращать.' }
        $backup = Get-Content $backupFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($backup.none) {
            if ($rec) {
                Call 'DELETE' (KeyPath $rec.ИмяМакета) | Out-Null
                Log "Изменённый макет '$($rec.ИмяМакета)' удалён — печать снова по стандартному макету."
            } else {
                Log 'Изменённого макета нет — возвращать нечего.'
            }
        } else {
            $body = @{ Макет_Type = $backup.Макет_Type; Макет_Base64Data = $backup.Макет_Base64Data; Использование = $backup.Использование }
            if ($rec -and $rec.ИмяМакета -eq $backup.ИмяМакета) {
                Call 'PATCH' (KeyPath $backup.ИмяМакета) $body | Out-Null
            } else {
                if ($rec) { Call 'DELETE' (KeyPath $rec.ИмяМакета) | Out-Null }
                $body.Объект = $Object
                $body.ИмяМакета = $backup.ИмяМакета
                Call 'POST' $Entity $body | Out-Null
            }
            Log "Восстановлен макет '$($backup.ИмяМакета)' из резервной копии."
        }
        Rename-Item $backupFile ("zn-backup-used-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    }

    $after = FindRecord
    if ($Mode -eq 'apply') {
        if ($after -and $after.Использование -and (IsFixed (LayoutXml $after.Макет_Base64Data))) {
            Log 'ПРОВЕРКА: OK — печать заказ-наряда будет без скидок и без строки «Плательщик».'
        } else {
            Log 'ПРОВЕРКА: НЕ ПРОШЛА — откройте «Макеты печатных форм» и посмотрите макет «Заказ-наряд».'
        }
    } else {
        $s = if ($after) { "макет '$($after.ИмяМакета)'" } else { 'стандартный макет' }
        Log "ПРОВЕРКА: сейчас печать идёт через $s."
    }
} catch {
    $msg = $_.Exception.Message
    if ($_.Exception.Response) {
        try {
            $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream(), [Text.Encoding]::UTF8)
            $msg += ' | ' + $sr.ReadToEnd()
        } catch {}
    }
    Log "ОШИБКА: $msg"
    exit 1
}

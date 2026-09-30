#Requires -Version 5.1
<#
.SYNOPSIS
  Отличия двух версий расширения 1С (.cfe): внешние (состав, формы, интерфейс, права)
  и внутренние (методы модулей, перехваты, запросы).

  По умолчанию берёт две последние версии <имя>_v<версия>.cfe рядом со скриптом
  (правило то же, что в install-1c*.ps1: v1 < v2.0 < v2.1 < v10).
  Исходники берутся из src\<имя файла>; если их нет или они старше .cfe — распаковываются
  через unpack-cfe.ps1.

  Результат (в -OutDir, по умолчанию .\diff):
    <имя>_<старая>__<новая>.md    — отчёт
    <имя>_<старая>__<новая>.diff  — полный дифф кода модулей и прав ролей
  Технический шум (контрольные суммы, перенос строк в base64, внутренние идентификаторы)
  выносится в отдельный раздел и не считается изменением.

.EXAMPLE
  .\diff-cfe.ps1
  .\diff-cfe.ps1 -Old .\АРМЗакупокИПродаж_v1.cfe -New .\АРМЗакупокИПродаж_v2.0.cfe
  .\diff-cfe.ps1 -Name АРМЗакупокИПродаж -OutDir D:\reports
#>
param(
    [string]$Old,                 # старая версия .cfe (по умолчанию — предпоследняя)
    [string]$New,                 # новая версия .cfe (по умолчанию — последняя)
    [string]$Name,                # имя расширения, если рядом лежат разные расширения
    [string]$SrcDir,              # по умолчанию .\src
    [string]$OutDir,              # по умолчанию .\diff
    [switch]$NoCodeDiff           # не писать файл полного диффа
)

$ErrorActionPreference = 'Stop'
$Root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $SrcDir) { $SrcDir = Join-Path $Root 'src' }
if (-not $OutDir) { $OutDir = Join-Path $Root 'diff' }

$TypeNames = @{
    Catalog = 'Справочник'; Document = 'Документ'; DataProcessor = 'Обработка'; Report = 'Отчёт'
    CommonModule = 'Общий модуль'; CommonForm = 'Общая форма'; CommonCommand = 'Общая команда'
    CommonPicture = 'Общая картинка'; CommonTemplate = 'Общий макет'; CommonAttribute = 'Общий реквизит'
    InformationRegister = 'Регистр сведений'; AccumulationRegister = 'Регистр накопления'
    AccountingRegister = 'Регистр бухгалтерии'; Enum = 'Перечисление'; Constant = 'Константа'
    Role = 'Роль'; Subsystem = 'Подсистема'; StyleItem = 'Элемент стиля'; Language = 'Язык'
    ExchangePlan = 'План обмена'; ChartOfCharacteristicTypes = 'План видов характеристик'
    BusinessProcess = 'Бизнес-процесс'; Task = 'Задача'; DocumentJournal = 'Журнал документов'
    EventSubscription = 'Подписка на событие'; ScheduledJob = 'Регламентное задание'
    FunctionalOption = 'Функциональная опция'; SessionParameter = 'Параметр сеанса'; HTTPService = 'HTTP-сервис'
}
$DirectiveRe = '^&(НаСервере|НаКлиенте|НаСервереБезКонтекста|НаКлиентеНаСервереБезКонтекста|НаКлиентеНаСервере|AtServer|AtClient|AtServerNoContext|AtClientAtServerNoContext|AtClientAtServer)\s*$'
$InterceptRe = '^&(Перед|После|Вместо|ИзменениеИКонтроль|Before|After|Around|ChangeAndValidate)\s*\(\s*"([^"]+)"\s*\)'
# строки кода, которые меняют то, что видит пользователь
$UiRe = 'Элементы\.(Добавить|Переместить|Удалить|Вставить)|\.(Заголовок|Видимость|Доступность|ТолькоПросмотр|ПутьКДанным|Подсказка|Шрифт|ЦветТекста|ЦветФона)\s*=|УсловноеОформление|ТекстЗапроса\s*=|Items\.(Add|Move|Delete|Insert)|\.(Title|Visible|Enabled|ReadOnly|DataPath)\s*='

# =====================================================================
#  Версии и исходники
# =====================================================================
function Get-CfeInfo([IO.FileInfo]$F) {
    $m   = [regex]::Match($F.BaseName, '^(.+?)_v(\d+(?:\.\d+){0,3})$')
    $ver = if ($m.Success) { $m.Groups[2].Value } else { '0' }
    [pscustomobject]@{
        File    = $F.FullName
        Name    = if ($m.Success) { $m.Groups[1].Value } else { $F.BaseName }
        Label   = if ($m.Success) { "v$ver" } else { $F.BaseName }
        Version = [version]$(if ($ver -notmatch '\.') { "$ver.0" } else { $ver })
    }
}

# Исходники для .cfe: src\<имя файла>; распаковать, если их нет или они старше .cfe
function Sync-Source([string]$Cfe) {
    $dest = Join-Path $SrcDir ([IO.Path]::GetFileNameWithoutExtension($Cfe))
    if (-not (Test-Path $dest) -or (Get-Item $dest).LastWriteTime -lt (Get-Item $Cfe).LastWriteTime) {
        Write-Host "  распаковка $(Split-Path -Leaf $Cfe)..." -ForegroundColor Cyan
        # вывод распаковки — только на экран, иначе он попадёт в возвращаемое значение
        & (Join-Path $Root 'unpack-cfe.ps1') -Path $Cfe -SrcDir $SrcDir | Out-Host
        $unpacked = (Test-Path $dest) -and (Get-ChildItem -LiteralPath $dest -Recurse -File | Select-Object -First 1)
        if ($LASTEXITCODE -ne 0 -or -not $unpacked) { throw "Не удалось распаковать $Cfe (см. вывод v8unpack выше)" }
    }
    return $dest
}

# =====================================================================
#  JSON: строки, сигнатуры, шум
# =====================================================================
function Read-Json([string]$Path) { Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }

# base64-блоки v8unpack при каждой сборке переносит по-разному — сравниваем их без пробелов
function Norm([string]$S) {
    if ($S.Length -gt 200 -and $S -notmatch '[А-Яа-яЁё ]') { return ($S -replace '\s', '') }
    $S
}

function Add-Strings($Node, $Acc) {
    if ($null -eq $Node) { return }
    if ($Node -is [string]) { $Acc.Add((Norm $Node)); return }
    if ($Node -is [System.Management.Automation.PSCustomObject]) {
        foreach ($p in $Node.PSObject.Properties) { $Acc.Add("@$($p.Name)"); Add-Strings $p.Value $Acc }
        return
    }
    if ($Node -is [System.Collections.IEnumerable]) { foreach ($x in $Node) { Add-Strings $x $Acc }; return }
    $Acc.Add([string]$Node)
}
function Get-Strings($Node) {
    $acc = New-Object System.Collections.Generic.List[string]
    Add-Strings $Node $acc
    return , $acc
}
function Get-Sig($Node) { (Get-Strings $Node) -join [char]1 }

function Unq([string]$S) { if ($S -match '^"(.*)"$') { $Matches[1] -replace '""', '"' } else { $S } }

function Test-Hash([string]$S) { $S -match '^[A-Za-z0-9+/]{27}=$' }
# служебное значение: хэш, uuid, число, пустая строка, длинный блок, имя свойства
function Test-Noise([string]$S) {
    (Test-Hash $S) -or $S.Length -gt 300 -or $S.StartsWith('@') -or
    $S -match '^"?[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}(\.\d+)?"?$' -or
    $S -match '^-?\d+$' -or $S -eq '""' -or $S -notmatch '[A-Za-zА-Яа-яЁё]' -or
    $S -match '^"?[A-Za-z]{1,2}"?$' -or   # коды языка и типов: "ru", "S", "N", "B", "U"
    $S -eq '"Pattern"'
}
function Get-Meaningful($Node) {
    $list = Get-Strings $Node   # через переменную: foreach по вызову функции получил бы список целиком одним элементом
    foreach ($s in $list) { if (-not (Test-Noise $s)) { Unq $s } }
}

# Мультимножественная разность: что добавилось в B и что пропало из A
function Get-MultisetDiff($A, $B) {
    $d = New-Object 'System.Collections.Generic.Dictionary[string,int]' ([StringComparer]::Ordinal)
    foreach ($x in @($A)) { if ($null -eq $x) { continue }; $v = 0; [void]$d.TryGetValue($x, [ref]$v); $d[$x] = $v - 1 }
    foreach ($x in @($B)) { if ($null -eq $x) { continue }; $v = 0; [void]$d.TryGetValue($x, [ref]$v); $d[$x] = $v + 1 }
    $added = New-Object System.Collections.Generic.List[string]
    $removed = New-Object System.Collections.Generic.List[string]
    foreach ($kv in $d.GetEnumerator()) {
        for ($i = 0; $i -lt [math]::Abs($kv.Value); $i++) { if ($kv.Value -gt 0) { $added.Add($kv.Key) } else { $removed.Add($kv.Key) } }
    }
    [pscustomobject]@{ Added = $added; Removed = $removed }
}
function Get-LineDiff($A, $B) {
    $norm = { param($lines) foreach ($l in @($lines)) { if ($null -ne $l) { $t = $l.Trim(); if ($t) { $t } } } }
    Get-MultisetDiff (& $norm $A) (& $norm $B)
}

# Первый заголовок ["\"ru\"", "\"Текст\""] в структуре элемента
function Find-Ru($Node) {
    if ($null -eq $Node -or $Node -is [string]) { return $null }
    if ($Node -is [System.Management.Automation.PSCustomObject]) {
        foreach ($p in $Node.PSObject.Properties) { $r = Find-Ru $p.Value; if ($null -ne $r) { return $r } }
        return $null
    }
    $arr = @($Node)
    if ($arr.Count -ge 2 -and $arr[0] -is [string] -and $arr[0] -eq '"ru"' -and $arr[1] -is [string]) { return (Unq $arr[1]) }
    foreach ($x in $arr) { $r = Find-Ru $x; if ($null -ne $r) { return $r } }
    $null
}

# Текст запроса динамического списка: ... "\"QueryText\"", ["\"S\"", "\"ВЫБРАТЬ ...\""]
function Find-QueryText($Node) {
    if ($null -eq $Node -or $Node -is [string]) { return $null }
    if ($Node -is [System.Management.Automation.PSCustomObject]) {
        foreach ($p in $Node.PSObject.Properties) { $r = Find-QueryText $p.Value; if ($null -ne $r) { return $r } }
        return $null
    }
    $arr = @($Node)
    for ($i = 0; $i -lt $arr.Count - 1; $i++) {
        if ($arr[$i] -is [string] -and $arr[$i] -eq '"QueryText"') {
            $v = @($arr[$i + 1])
            if ($v.Count -ge 2 -and $v[1] -is [string]) { return (Unq $v[1]) }
        }
    }
    foreach ($x in $arr) { $r = Find-QueryText $x; if ($null -ne $r) { return $r } }
    $null
}

# =====================================================================
#  Описание места изменения
# =====================================================================
function Get-TypeName([string]$T) { if ($TypeNames.ContainsKey($T)) { $TypeNames[$T] } else { $T } }
function Test-FormSeg([string[]]$Segs) { $Segs.Count -ge 4 -and $Segs[2] -match 'Form$' }
function Get-Where([string[]]$Segs) {
    if ($Segs.Count -lt 2) { return 'Расширение' }
    $w = "$(Get-TypeName $Segs[0]) $($Segs[1])"
    if (Test-FormSeg $Segs) { $w += ", форма $($Segs[3])" }
    $w
}
function Get-ModuleKind([string]$File) {
    if ($File -match 'Form\.obj\.bsl$') { 'модуль формы' }
    elseif ($File -match '\.mgr\.bsl$') { 'модуль менеджера' }
    elseif ($File -match '^CommonModule') { 'общий модуль' }
    elseif ($File -match '\.obj\.bsl$') { 'модуль объекта' }
    else { 'модуль' }
}
function Get-Synonym([string]$Dir, [string[]]$Segs) {
    $f = Join-Path $Dir ("{0}\{1}\{0}.json" -f $Segs[0], $Segs[1])
    if (Test-Path -LiteralPath $f) { try { (Read-Json $f).name2.ru } catch { $null } }
}
function E([string]$S) { ($S -replace '\|', '\|') -replace '\r?\n', ' ' }
function Short([string]$S, [int]$Max = 120) { if ($S.Length -gt $Max) { $S.Substring(0, $Max) + '…' } else { $S } }

# =====================================================================
#  Модули (.bsl)
# =====================================================================
# Методы модуля. Комментарии и аннотации сразу над методом (без пустой строки) относятся к методу.
function Get-Methods([string]$Text) {
    $methods = [ordered]@{}
    $outside = New-Object System.Collections.Generic.List[string]
    $pre     = New-Object System.Collections.Generic.List[string]   # комментарии/аннотации над методом
    $cur     = $null
    foreach ($l in ($Text -split "`r?`n")) {
        if ($cur) {
            if ($l -match '^\s*(КонецПроцедуры|КонецФункции|EndProcedure|EndFunction)\b') { $methods[$cur.Name] = $cur; $cur = $null }
            else { $cur.Lines.Add($l) }
            continue
        }
        $t = $l.Trim()
        if ($t -match '^(&|//)') { $pre.Add($t); continue }
        if ($t -match '^(?:Асинх\s+|Async\s+)?(Процедура|Функция|Procedure|Function)\s+(\w+)\s*\(') {
            $cur = [pscustomobject]@{
                Name = $Matches[2]; Kind = $Matches[1]; Header = $t
                Ann = @($pre | Where-Object { $_ -like '&*' })
                Doc = @($pre | Where-Object { $_ -like '//*' })
                Export = $t -match '\b(Экспорт|Export)\b'
                Lines = (New-Object System.Collections.Generic.List[string])
            }
            $pre.Clear()
            continue
        }
        foreach ($p in $pre) { $outside.Add($p) }
        $pre.Clear()
        $outside.Add($l)
    }
    foreach ($p in $pre) { $outside.Add($p) }
    [pscustomobject]@{ Methods = $methods; Outside = $outside }
}
function Get-MethodAllLines($M) { @($M.Doc) + @($M.Ann) + @($M.Header) + @($M.Lines) }
# Строки текста запроса: литерал "ВЫБРАТЬ ... и его продолжения |... (только если в методе есть запрос)
function Get-QueryLines($Lines) {
    $lines = @($Lines | ForEach-Object { $_.Trim() })
    if (-not ($lines | Where-Object { $_ -match '"\s*(ВЫБРАТЬ|SELECT)(\s|$)' })) { return }
    foreach ($t in $lines) { if ($t -match '^\|' -or $t -match '"\s*(ВЫБРАТЬ|SELECT)(\s|$)') { $t } }
}
function Get-MethodNotes($M) {
    $notes = New-Object System.Collections.Generic.List[string]
    foreach ($a in $M.Ann) {
        if ($a -match $DirectiveRe) { $notes.Add($a) }
        elseif ($a -match $InterceptRe) { $notes.Add("перехват $($Matches[1]) «$($Matches[2])»") }
    }
    if ($M.Export) { $notes.Add('Экспорт') }
    return , $notes
}

function Add-UiHints([string]$Where, [string]$Method, $Lines) {
    $hits = @(foreach ($l in @($Lines)) { if ($l -match $UiRe) { $l.Trim() } }) | Select-Object -Unique
    $n = 0
    foreach ($h in $hits) {
        if (++$n -gt 12) { $script:UiRows.Add("| $(E $Where) | $(E $Method) | … ещё $($hits.Count - 12) |"); break }
        $script:UiRows.Add("| $(E $Where) | $(E $Method) | ``$(E (Short $h))`` |")
    }
}

function Compare-Module([string]$Where, [string]$OldText, [string]$NewText) {
    $mo = Get-Methods $OldText
    $mn = Get-Methods $NewText
    foreach ($name in $mn.Methods.Keys) {
        $m = $mn.Methods[$name]
        $notes = Get-MethodNotes $m
        if (-not $mo.Methods.Contains($name)) {
            $cnt = @(Get-LineDiff @() (Get-MethodAllLines $m)).Added.Count
            $script:MethodRows.Add("| $(E $Where) | ``$name`` | добавлен | +$cnt | $(E ($notes -join ', ')) |")
            $script:Stat.MethodsAdded++
            Add-UiHints $Where $name $m.Lines
            if (@(Get-QueryLines $m.Lines).Count) { $script:QueryRows.Add("| $(E $Where) | ``$name`` | новый метод с запросом |") }
            foreach ($a in $m.Ann) { if ($a -match $InterceptRe) { $script:InterceptRows.Add("| $(E $Where) | ``$name`` | $($Matches[1]) | $(E $Matches[2]) | добавлен |") } }
            continue
        }
        $o = $mo.Methods[$name]
        $d = Get-LineDiff (Get-MethodAllLines $o) (Get-MethodAllLines $m)
        if (-not ($d.Added.Count + $d.Removed.Count)) { continue }
        if ($o.Header -ne $m.Header) { $notes.Add('изменена сигнатура') }
        $qd = Get-MultisetDiff (Get-QueryLines $o.Lines) (Get-QueryLines $m.Lines)
        if ($qd.Added.Count + $qd.Removed.Count) {
            $notes.Add('изменён запрос')
            $script:QueryRows.Add("| $(E $Where) | ``$name`` | +$($qd.Added.Count)/−$($qd.Removed.Count) строк запроса |")
        }
        $script:MethodRows.Add("| $(E $Where) | ``$name`` | изменён | +$($d.Added.Count) / −$($d.Removed.Count) | $(E ($notes -join ', ')) |")
        $script:Stat.MethodsChanged++
        Add-UiHints $Where $name $d.Added
        foreach ($a in $m.Ann) { if ($a -match $InterceptRe) { $script:InterceptRows.Add("| $(E $Where) | ``$name`` | $($Matches[1]) | $(E $Matches[2]) | изменён |") } }
    }
    foreach ($name in $mo.Methods.Keys) {
        if ($mn.Methods.Contains($name)) { continue }
        $m = $mo.Methods[$name]
        $cnt = @(Get-LineDiff (Get-MethodAllLines $m) @()).Removed.Count
        $script:MethodRows.Add("| $(E $Where) | ``$name`` | **удалён** | −$cnt | $(E ((Get-MethodNotes $m) -join ', ')) |")
        $script:Stat.MethodsRemoved++
        foreach ($a in $m.Ann) { if ($a -match $InterceptRe) { $script:InterceptRows.Add("| $(E $Where) | ``$name`` | $($Matches[1]) | $(E $Matches[2]) | **удалён** |") } }
    }
    $od = Get-LineDiff $mo.Outside $mn.Outside
    if ($od.Added.Count + $od.Removed.Count) {
        $script:MethodRows.Add("| $(E $Where) | (код вне методов: переменные, области) | изменён | +$($od.Added.Count) / −$($od.Removed.Count) | |")
    }
}

# =====================================================================
#  Формы (*.elem.json)
# =====================================================================
function Add-TreeNodes($Nodes, [string]$Parent, $Elems, $Children) {
    foreach ($n in @($Nodes)) {
        if ($null -eq $n -or -not $n.name) { continue }
        $path = if ($Parent) { "$Parent/$($n.name)" } else { $n.name }
        $Elems[$path] = [string]$n.type
        if (-not $Children.ContainsKey($Parent)) { $Children[$Parent] = New-Object System.Collections.Generic.List[string] }
        $Children[$Parent].Add([string]$n.name)
        if ($n.child) { Add-TreeNodes $n.child $path $Elems $Children }
    }
}
function Get-FormModel([string]$Path) {
    $j = Read-Json $Path
    $props = [ordered]@{}; foreach ($p in @($j.props))    { if ($p -and $p.name) { $props[$p.name] = $p } }
    $cmds  = [ordered]@{}; foreach ($c in @($j.commands)) { if ($c -and $c.name) { $cmds[$c.name] = $c } }
    $elems = [ordered]@{}; $children = @{}
    Add-TreeNodes $j.tree '' $elems $children
    [pscustomobject]@{ Json = $j; Props = $props; Cmds = $cmds; Elems = $elems; Children = $children; Data = $j.data }
}
function Get-ElemData($Model, [string]$Path) {
    if ($null -eq $Model.Data) { return $null }
    $p = $Model.Data.PSObject.Properties[$Path]
    if ($p) { $p.Value }
}

function Compare-Form([string]$Where, [string]$OldPath, [string]$NewPath) {
    $fo = Get-FormModel $OldPath
    $fn = Get-FormModel $NewPath
    if ((Get-Sig $fo.Json) -eq (Get-Sig $fn.Json)) {
        $script:NoiseRows.Add("${Where}: форма пересобрана без изменений (перенос строк в base64-настройках)")
        return
    }
    $lines = New-Object System.Collections.Generic.List[string]

    foreach ($kind in @(@{ Title = 'реквизит'; O = $fo.Props; N = $fn.Props }, @{ Title = 'команда'; O = $fo.Cmds; N = $fn.Cmds })) {
        foreach ($k in $kind.N.Keys) {
            $cap = Find-Ru $kind.N[$k].raw
            $capText = if ($cap) { " «$cap»" } else { '' }
            if (-not $kind.O.Contains($k)) { $lines.Add("- добавлен $($kind.Title) ``$k``$capText"); continue }
            if ((Get-Sig $kind.O[$k].raw) -eq (Get-Sig $kind.N[$k].raw)) { continue }
            $qo = Find-QueryText $kind.O[$k].raw; $qn = Find-QueryText $kind.N[$k].raw
            if ($qo -ne $qn -and ($qo -or $qn)) {
                $qd = Get-LineDiff ($qo -split "`n") ($qn -split "`n")
                $lines.Add("- изменён запрос списка ``$k``: +$($qd.Added.Count)/−$($qd.Removed.Count) строк")
                $script:QueryRows.Add("| $(E $Where) | реквизит ``$k`` | запрос динамического списка: +$($qd.Added.Count)/−$($qd.Removed.Count) строк |")
            } else {
                $co = Find-Ru $kind.O[$k].raw
                if ($co -ne $cap) { $lines.Add("- $($kind.Title) ``$k``: заголовок «$co» → «$cap»") }
                else { $lines.Add("- изменены свойства: $($kind.Title) ``$k``") }
            }
        }
        foreach ($k in $kind.O.Keys) { if (-not $kind.N.Contains($k)) { $lines.Add("- **удалён** $($kind.Title) ``$k``") } }
    }

    $n = 0
    foreach ($p in $fn.Elems.Keys) {
        if ($fo.Elems.Contains($p)) { continue }
        if (++$n -gt 40) { continue }
        $cap = Find-Ru (Get-ElemData $fn $p)
        $lines.Add("- добавлен элемент ``$p`` ($($fn.Elems[$p]))$(if ($cap) { " «$cap»" })")
    }
    if ($n -gt 40) { $lines.Add("- … и ещё $($n - 40) добавленных элементов") }
    foreach ($p in $fo.Elems.Keys) { if (-not $fn.Elems.Contains($p)) { $lines.Add("- **удалён** элемент ``$p`` ($($fo.Elems[$p]))") } }

    $propsChanged = New-Object System.Collections.Generic.List[string]
    foreach ($p in $fn.Elems.Keys) {
        if (-not $fo.Elems.Contains($p)) { continue }
        $do = Get-ElemData $fo $p; $dn = Get-ElemData $fn $p
        if ((Get-Sig $do) -eq (Get-Sig $dn)) { continue }
        $co = Find-Ru $do; $cn = Find-Ru $dn
        if ($co -ne $cn) { $lines.Add("- ``$p``: заголовок «$co» → «$cn»") }
        else { $propsChanged.Add($p) }
    }
    if ($propsChanged.Count) {
        $shown = ($propsChanged | Select-Object -First 15 | ForEach-Object { "``$_``" }) -join ', '
        $more  = if ($propsChanged.Count -gt 15) { " и ещё $($propsChanged.Count - 15)" } else { '' }
        $lines.Add("- изменены свойства элементов ($($propsChanged.Count)): $shown$more")
    }
    foreach ($parent in $fn.Children.Keys) {
        if (-not $fo.Children.ContainsKey($parent)) { continue }
        $newSeq = @($fn.Children[$parent] | Where-Object { $fo.Children[$parent] -contains $_ })
        $oldSeq = @($fo.Children[$parent] | Where-Object { $fn.Children[$parent] -contains $_ })
        if (($newSeq -join '|') -ne ($oldSeq -join '|')) {
            $lines.Add("- изменён порядок элементов в ``$(if ($parent) { $parent } else { '(корень формы)' })``")
        }
    }

    if (-not $lines.Count) {
        $lines.Add('- изменены служебные свойства формы (без изменений элементов, реквизитов и команд)')
    }
    $script:FormBlocks.Add("#### $Where")
    $script:FormBlocks.AddRange($lines)
    $script:FormBlocks.Add('')
    $script:Stat.Forms++
}

# Прочие JSON с описанием объекта/формы: значимые строки, которые появились и пропали
function Compare-PropsJson([string]$Where, [string]$Rel, [string]$OldPath, [string]$NewPath) {
    $jo = Read-Json $OldPath; $jn = Read-Json $NewPath
    if ((Get-Sig $jo) -eq (Get-Sig $jn)) { $script:NoiseRows.Add("${Rel}: пересобран без изменений"); return }
    $d = Get-MultisetDiff @(Get-Meaningful $jo) @(Get-Meaningful $jn)
    if (-not ($d.Added.Count + $d.Removed.Count)) { $script:NoiseRows.Add("${Rel}: изменены только служебные значения (идентификаторы, флаги)"); return }
    $parts = @()
    # имя и синоним обычно совпадают — показываем каждое значение один раз
    $added   = @($d.Added   | Select-Object -Unique); $removed = @($d.Removed | Select-Object -Unique)
    if ($added.Count)   { $parts += 'появилось: ' + (($added   | Select-Object -First 25 | ForEach-Object { "«$(Short $_ 60)»" }) -join ', ') + $(if ($added.Count -gt 25) { " и ещё $($added.Count - 25)" }) }
    if ($removed.Count) { $parts += 'пропало: '   + (($removed | Select-Object -First 25 | ForEach-Object { "«$(Short $_ 60)»" }) -join ', ') + $(if ($removed.Count -gt 25) { " и ещё $($removed.Count - 25)" }) }
    $script:ObjectRows.Add("- ~ $Where — свойства ($(Split-Path -Leaf $Rel)): $($parts -join '; ')")
}

# =====================================================================
try {
    # ---------- какие версии сравниваем ----------
    if ($Old -and $New) {
        $vo = Get-CfeInfo (Get-Item $Old); $vn = Get-CfeInfo (Get-Item $New)
    } else {
        $list = @(Get-ChildItem $Root -Filter '*.cfe' -File | ForEach-Object { Get-CfeInfo $_ })
        if ($Name) { $list = @($list | Where-Object Name -eq $Name) }
        $names = @($list | Select-Object -ExpandProperty Name -Unique)
        if ($names.Count -gt 1) { throw "Рядом со скриптом разные расширения ($($names -join ', ')) — укажите -Name" }
        if ($list.Count -lt 2) { throw "Для сравнения нужно минимум две версии .cfe рядом со скриптом (найдено: $($list.Count))" }
        $sorted = @($list | Sort-Object Version)
        $vo = $sorted[-2]; $vn = $sorted[-1]
    }
    if ($vo.File -eq $vn.File) { throw 'Старая и новая версии — один и тот же файл' }
    Write-Host "Сравнение $($vo.Name): $($vo.Label) -> $($vn.Label)" -ForegroundColor Cyan

    $oldDir = Sync-Source $vo.File
    $newDir = Sync-Source $vn.File

    # ---------- накопители отчёта ----------
    $Stat = [ordered]@{ ObjectsAdded = 0; ObjectsRemoved = 0; Forms = 0; MethodsAdded = 0; MethodsChanged = 0; MethodsRemoved = 0 }
    $ObjectRows    = New-Object System.Collections.Generic.List[string]
    $FormBlocks    = New-Object System.Collections.Generic.List[string]
    $RoleRows      = New-Object System.Collections.Generic.List[string]
    $UiRows        = New-Object System.Collections.Generic.List[string]
    $MethodRows    = New-Object System.Collections.Generic.List[string]
    $InterceptRows = New-Object System.Collections.Generic.List[string]
    $QueryRows     = New-Object System.Collections.Generic.List[string]
    $NoiseRows     = New-Object System.Collections.Generic.List[string]
    $DiffPairs     = New-Object System.Collections.Generic.List[object]   # для полного диффа

    $relOf = { param($dir) $files = @{}; foreach ($f in Get-ChildItem -LiteralPath $dir -Recurse -File) { $files[$f.FullName.Substring($dir.Length + 1)] = $f.FullName }; $files }
    $oldFiles = & $relOf $oldDir
    $newFiles = & $relOf $newDir
    $allRel = @(@($oldFiles.Keys) + @($newFiles.Keys) | Sort-Object -Unique)

    # ---------- добавленные / удалённые объекты и формы ----------
    $objKey  = { param($rel) $s = $rel -split '\\'; if ($s.Count -ge 3) { "$($s[0])\$($s[1])" } }
    $formKey = { param($rel) $s = $rel -split '\\'; if (Test-FormSeg $s) { "$($s[0])\$($s[1])\$($s[2])\$($s[3])" } }
    $oldObjs  = @($oldFiles.Keys | ForEach-Object { & $objKey $_ } | Sort-Object -Unique)
    $newObjs  = @($newFiles.Keys | ForEach-Object { & $objKey $_ } | Sort-Object -Unique)
    $oldForms = @($oldFiles.Keys | ForEach-Object { & $formKey $_ } | Where-Object { $_ } | Sort-Object -Unique)
    $newForms = @($newFiles.Keys | ForEach-Object { & $formKey $_ } | Where-Object { $_ } | Sort-Object -Unique)
    $skipObj = @{}; $skipForm = @{}
    foreach ($o in $newObjs | Where-Object { $oldObjs -notcontains $_ }) {
        $s = $o -split '\\'; $syn = Get-Synonym $newDir $s
        $ObjectRows.Add("- **+ добавлен** $(Get-Where $s)$(if ($syn) { " «$syn»" })"); $skipObj[$o] = 'new'; $Stat.ObjectsAdded++
    }
    foreach ($o in $oldObjs | Where-Object { $newObjs -notcontains $_ }) {
        $s = $o -split '\\'; $syn = Get-Synonym $oldDir $s
        $ObjectRows.Add("- **− удалён** $(Get-Where $s)$(if ($syn) { " «$syn»" })"); $skipObj[$o] = 'old'; $Stat.ObjectsRemoved++
    }
    foreach ($f in $newForms | Where-Object { $oldForms -notcontains $_ }) {
        if ($skipObj.ContainsKey((& $objKey $f))) { continue }
        $ObjectRows.Add("- **+ добавлена форма** $(Get-Where ($f -split '\\'))"); $skipForm[$f] = 'new'
    }
    foreach ($f in $oldForms | Where-Object { $newForms -notcontains $_ }) {
        if ($skipObj.ContainsKey((& $objKey $f))) { continue }
        $ObjectRows.Add("- **− удалена форма** $(Get-Where ($f -split '\\'))"); $skipForm[$f] = 'old'
    }

    # ---------- пофайловое сравнение ----------
    foreach ($rel in $allRel) {
        $segs  = $rel -split '\\'
        $leaf  = $segs[-1]
        $where = Get-Where $segs
        $o = $oldFiles[$rel]; $n = $newFiles[$rel]
        $ok = & $objKey $rel; $fk = & $formKey $rel
        $objGone = $ok -and $skipObj.ContainsKey($ok)
        $formGone = $fk -and $skipForm.ContainsKey($fk)

        if ($leaf -like '*.bsl') {
            $ot = if ($o) { [IO.File]::ReadAllText($o, [Text.Encoding]::UTF8) } else { '' }
            $nt = if ($n) { [IO.File]::ReadAllText($n, [Text.Encoding]::UTF8) } else { '' }
            if ($ot -ceq $nt) { continue }
            Compare-Module "$where ($(Get-ModuleKind $leaf))" $ot $nt
            $DiffPairs.Add(@($o, $n, $rel))
            continue
        }
        if ($objGone -or $formGone) { continue }   # уже отражено как добавленный/удалённый объект или форма
        if (-not $o -or -not $n) {
            $ObjectRows.Add("- $(if ($n) { '+ добавлен' } else { '− удалён' }) файл ``$rel`` ($where)")
            continue
        }
        if ((Get-FileHash -LiteralPath $o).Hash -eq (Get-FileHash -LiteralPath $n).Hash) { continue }

        if ($leaf -like '*.elem.json') { Compare-Form $where $o $n }
        elseif ($leaf -like '*.id.json') { $NoiseRows.Add("${rel}: изменены внутренние идентификаторы") }
        elseif ($leaf -eq 'ConfigurationExtension.json') {
            $jo = Read-Json $o; $jn = Read-Json $n
            $hd = Get-MultisetDiff @((Get-Strings $jo) | Where-Object { Test-Hash $_ }) @((Get-Strings $jn) | Where-Object { Test-Hash $_ })
            $md = Get-MultisetDiff @(Get-Meaningful $jo) @(Get-Meaningful $jn)
            if ($hd.Added.Count) { $NoiseRows.Add("ConfigurationExtension.json: обновлены контрольные суммы объектов ($($hd.Added.Count))") }
            if ($md.Added.Count + $md.Removed.Count) {
                $ObjectRows.Add("- ~ свойства расширения: появилось " + (($md.Added | ForEach-Object { "«$(Short $_ 60)»" }) -join ', ') +
                                "; пропало " + (($md.Removed | ForEach-Object { "«$(Short $_ 60)»" }) -join ', '))
            }
        }
        elseif ($leaf -like '*.json') { Compare-PropsJson $where $rel $o $n }
        elseif ($leaf -like '*.c1brace') {
            $d = Get-LineDiff ([IO.File]::ReadAllLines($o)) ([IO.File]::ReadAllLines($n))
            $RoleRows.Add("- $where — изменены права: +$($d.Added.Count)/−$($d.Removed.Count) строк (подробно — в полном диффе)")
            $DiffPairs.Add(@($o, $n, $rel))
        }
        elseif ($leaf -eq 'version.bin') { $NoiseRows.Add('version.bin: служебная версия формата') }
        elseif ($leaf -like '*.bin') {
            $what = if ($leaf -like 'CommonPicture*') { 'изменена картинка' } elseif ($leaf -like 'Предустановленные*') { 'изменены предопределённые данные' } else { "изменён двоичный файл $leaf" }
            $ObjectRows.Add("- ~ $where — $what")
        }
        else { $ObjectRows.Add("- ~ изменён файл ``$rel``") }
    }

    # ---------- отчёт ----------
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $baseName = "$($vn.Name)_$($vo.Label)__$($vn.Label)"
    $mdPath   = Join-Path $OutDir "$baseName.md"
    $diffPath = Join-Path $OutDir "$baseName.diff"
    $fo = Get-Item $vo.File; $fn = Get-Item $vn.File

    $r = New-Object System.Collections.Generic.List[string]
    $r.Add("# Отличия расширения $($vn.Name): $($vo.Label) → $($vn.Label)")
    $r.Add('')
    $r.Add(("- Старая: ``{0}`` ({1:N0} КБ, {2:dd.MM.yyyy HH:mm})" -f $fo.Name, ($fo.Length / 1KB), $fo.LastWriteTime))
    $r.Add(("- Новая: ``{0}`` ({1:N0} КБ, {2:dd.MM.yyyy HH:mm})" -f $fn.Name, ($fn.Length / 1KB), $fn.LastWriteTime))
    $r.Add("- Исходники: ``$oldDir`` → ``$newDir``")
    $r.Add("- Сформировано: $(Get-Date -Format 'dd.MM.yyyy HH:mm') скриптом diff-cfe.ps1")
    $r.Add('')
    $r.Add('## Итог')
    $r.Add('')
    $r.Add("- Объекты: добавлено $($Stat.ObjectsAdded), удалено $($Stat.ObjectsRemoved), других изменений состава и свойств $([math]::Max(0, $ObjectRows.Count - $Stat.ObjectsAdded - $Stat.ObjectsRemoved))")
    $r.Add("- Формы с изменениями: $($Stat.Forms); права ролей: $($RoleRows.Count); изменений интерфейса из кода: $($UiRows.Count)")
    $r.Add("- Методы: добавлено $($Stat.MethodsAdded), изменено $($Stat.MethodsChanged), удалено $($Stat.MethodsRemoved); перехватов затронуто $($InterceptRows.Count); запросов изменено $($QueryRows.Count)")
    $r.Add("- Технический шум (не изменения): $($NoiseRows.Count)")
    $r.Add('')

    $r.Add('## 1. Внешние изменения — что видит пользователь')
    $r.Add('')
    $r.Add('### Состав и свойства объектов')
    $r.Add('')
    if ($ObjectRows.Count) { $r.AddRange($ObjectRows) } else { $r.Add('Без изменений.') }
    $r.Add('')
    $r.Add('### Формы (реквизиты, команды, элементы, заголовки, порядок)')
    $r.Add('')
    if ($FormBlocks.Count) { $r.AddRange($FormBlocks) } else { $r.Add('Структура форм не менялась.'); $r.Add('') }
    $r.Add('### Роли и права')
    $r.Add('')
    if ($RoleRows.Count) { $r.AddRange($RoleRows) } else { $r.Add('Без изменений.') }
    $r.Add('')
    $r.Add('### Интерфейс, который меняет код')
    $r.Add('')
    $r.Add('Новые строки кода, которые при работе меняют форму: создают, перемещают и удаляют элементы, меняют заголовки, видимость, оформление и запросы списков. Такие изменения не видны в структуре формы.')
    $r.Add('')
    if ($UiRows.Count) {
        $r.Add('| Где | Метод | Строка |'); $r.Add('|---|---|---|'); $r.AddRange($UiRows)
    } else { $r.Add('Не найдено.') }
    $r.Add('')

    $r.Add('## 2. Внутренние изменения — код')
    $r.Add('')
    $r.Add('### Методы модулей')
    $r.Add('')
    if ($MethodRows.Count) {
        $r.Add('| Где | Метод | Изменение | Строк | Особенности |'); $r.Add('|---|---|---|---|---|'); $r.AddRange($MethodRows)
    } else { $r.Add('Код модулей не менялся.') }
    $r.Add('')
    $r.Add('### Перехваты методов основной конфигурации')
    $r.Add('')
    if ($InterceptRows.Count) {
        $r.Add('| Где | Метод расширения | Вид | Перехватываемый метод | Изменение |'); $r.Add('|---|---|---|---|---|'); $r.AddRange($InterceptRows)
    } else { $r.Add('Перехваты (&Перед, &После, &Вместо, &ИзменениеИКонтроль) не затронуты.') }
    $r.Add('')
    $r.Add('### Запросы')
    $r.Add('')
    if ($QueryRows.Count) {
        $r.Add('| Где | Что | Изменение |'); $r.Add('|---|---|---|'); $r.AddRange($QueryRows)
    } else { $r.Add('Тексты запросов не менялись.') }
    $r.Add('')

    $r.Add('## 3. Технический шум (не считается изменениями)')
    $r.Add('')
    if ($NoiseRows.Count) { foreach ($x in $NoiseRows) { $r.Add("- $x") } } else { $r.Add('Нет.') }
    $r.Add('')

    # ---------- полный дифф кода и прав ----------
    if (-not $NoCodeDiff -and $DiffPairs.Count) {
        $git = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($git) {
            $empty = Join-Path $env:TEMP 'diff-cfe-empty.txt'
            [IO.File]::WriteAllText($empty, '')
            $sb = New-Object Text.StringBuilder
            $prevEnc = [Console]::OutputEncoding; $prevEap = $ErrorActionPreference
            try {
                try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
                $ErrorActionPreference = 'Continue'
                foreach ($pair in $DiffPairs) {
                    $a = if ($pair[0]) { $pair[0] } else { $empty }
                    $b = if ($pair[1]) { $pair[1] } else { $empty }
                    [void]$sb.AppendLine("### $($pair[2])")
                    $out = & $git.Source -c core.quotepath=false diff --no-index --no-color -U3 -- $a $b 2>$null
                    foreach ($l in @($out)) { [void]$sb.AppendLine($l) }
                    [void]$sb.AppendLine('')
                }
            } finally {
                $ErrorActionPreference = $prevEap
                try { [Console]::OutputEncoding = $prevEnc } catch { }
                Remove-Item $empty -ErrorAction SilentlyContinue
            }
            [IO.File]::WriteAllText($diffPath, $sb.ToString(), (New-Object Text.UTF8Encoding $false))
            $r.Add('## 4. Полный дифф')
            $r.Add('')
            $r.Add("Построчные отличия кода модулей и прав ролей: [$(Split-Path -Leaf $diffPath)]($(Split-Path -Leaf $diffPath))")
        } else {
            $r.Add('## 4. Полный дифф'); $r.Add(''); $r.Add('git не найден — полный дифф не построен.')
        }
    }

    [IO.File]::WriteAllText($mdPath, ($r -join "`r`n") + "`r`n", (New-Object Text.UTF8Encoding $false))

    Write-Host ''
    Write-Host "Объекты: +$($Stat.ObjectsAdded) −$($Stat.ObjectsRemoved); формы изменены: $($Stat.Forms); права ролей: $($RoleRows.Count); интерфейс из кода: $($UiRows.Count)"
    Write-Host "Методы: +$($Stat.MethodsAdded) ~$($Stat.MethodsChanged) −$($Stat.MethodsRemoved); перехваты: $($InterceptRows.Count); запросы: $($QueryRows.Count); шум: $($NoiseRows.Count)"
    Write-Host "Отчёт: $mdPath" -ForegroundColor Green
    if (Test-Path $diffPath) { Write-Host "Дифф:  $diffPath" -ForegroundColor Green }
}
catch {
    Write-Host "ОШИБКА: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Строка $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())" -ForegroundColor DarkGray
    exit 1
}

#Requires -Version 5.1
<#
.SYNOPSIS
  Сборка расширения АРМ_OData (полный состав стандартного интерфейса OData) из odata\АрмOData_Интерфейс.bsl.

  Создаёт XML-выгрузку расширения (Configuration, язык Русский, общий модуль АрмOData_Интерфейс), загружает её
  в указанную базу (конфигуратор, -Extension АРМ_OData), применяет и выгружает АРМ_OData_v<версия>.cfe рядом
  со скриптом-родителем (корень репозитория). База — тестовая: в неё расширение и подключается.

.EXAMPLE
  .\odata\build-odata-ext.ps1 -IbDir D:\1c\test_v215
  .\odata\build-odata-ext.ps1 -IbDir D:\1c\test_v215 -IbUser Админ -Version 1.1
#>
param(
    [Parameter(Mandatory)] [string]$IbDir,
    [string]$IbUser = 'Админ',
    [string]$IbPassword = '',
    [string]$Version = '1.1',
    [string]$V8
)
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot; $Root = Split-Path -Parent $Here
$ExtName = 'АРМ_OData'; $Module = 'АрмOData_Интерфейс'; $CmdModule = 'АрмOData_Команды'; $CmdReg = 'АрмOData_КомандыPWA'
if (-not $V8) {
    $V8 = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'D:\Program Files') | Where-Object { $_ } |
          ForEach-Object { Join-Path $_ '1cv8\8.3.27.2342\bin\1cv8.exe' } | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $V8) { throw 'Не найден 1cv8.exe 8.3.27.2342' }

$ns = 'xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:cmi="http://v8.1c.ru/8.2/managed-application/cmi" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xen="http://v8.1c.ru/8.3/xcf/enums" xmlns:xpr="http://v8.1c.ru/8.3/xcf/predef" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.20"'
# Постоянные идентификаторы расширения (повторная сборка обновляет то же расширение, а не создаёт новое)
$ids = @{
    Config = 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1a01'; Module = 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1a02'; Lang = 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1a03'
    CmdModule = 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1a04'; CmdReg = 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1a05'
    Contained = @(
        @('9cd510cd-abfc-11d4-9434-004095e12fc7', 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1a11'), @('9fcd25a0-4822-11d4-9414-008048da11f9', 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1a12'),
        @('e3687481-0a87-462c-a166-9f34594f9bba', 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1a13'), @('9de14907-ec23-4a07-96f0-85521cb6b53b', 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1a14'),
        @('51f2d5d8-ea4d-4064-8892-82951750031e', 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1a15'), @('e68182ea-4237-4383-967f-90c1e3370bc7', 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1a16'),
        @('fb282519-d103-4dd3-bc12-cb271d631dfc', 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1a17'))
}
# Язык «Русский» основной конфигурации («Автосервис» / УНФ)
$baseLangId = 'af1b61ff-d1b9-4053-ad85-8259b6626adc'

$x = Join-Path $env:TEMP ("odata-ext-{0:yyyyMMddHHmmss}" -f (Get-Date))
New-Item -ItemType Directory -Force "$x\Languages", "$x\CommonModules\$Module\Ext", "$x\CommonModules\$CmdModule\Ext", "$x\InformationRegisters\$CmdReg\Ext" | Out-Null
$utf8 = New-Object Text.UTF8Encoding $true
function W([string]$path, [string]$text) { [IO.File]::WriteAllText($path, ($text -replace "`r?`n", "`r`n"), $utf8) }

$contained = ($ids.Contained | ForEach-Object { "`t`t`t<xr:ContainedObject>`n`t`t`t`t<xr:ClassId>$($_[0])</xr:ClassId>`n`t`t`t`t<xr:ObjectId>$($_[1])</xr:ObjectId>`n`t`t`t</xr:ContainedObject>" }) -join "`n"
W "$x\Configuration.xml" @"
<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject $ns>
	<Configuration uuid="$($ids.Config)">
		<InternalInfo>
$contained
		</InternalInfo>
		<Properties>
			<ObjectBelonging>Adopted</ObjectBelonging>
			<Name>$ExtName</Name>
			<Synonym>
				<v8:item>
					<v8:lang>ru</v8:lang>
					<v8:content>АРМ: полный интерфейс OData</v8:content>
				</v8:item>
			</Synonym>
			<Comment>Полный состав стандартного интерфейса OData (АрмOData_Интерфейс.ВключитьПолныйСоставOData)</Comment>
			<ConfigurationExtensionPurpose>AddOn</ConfigurationExtensionPurpose>
			<KeepMappingToExtendedConfigurationObjectsByIDs>true</KeepMappingToExtendedConfigurationObjectsByIDs>
			<NamePrefix>АрмOData_</NamePrefix>
			<ConfigurationExtensionCompatibilityMode>Version8_3_24</ConfigurationExtensionCompatibilityMode>
			<DefaultRunMode>ManagedApplication</DefaultRunMode>
			<UsePurposes>
				<v8:Value xsi:type="app:ApplicationUsePurpose">PlatformApplication</v8:Value>
			</UsePurposes>
			<ScriptVariant>Russian</ScriptVariant>
			<DefaultRoles/>
			<Vendor/>
			<Version>$Version</Version>
			<DefaultLanguage>Language.Русский</DefaultLanguage>
			<BriefInformation/>
			<DetailedInformation/>
			<Copyright/>
			<VendorInformationAddress/>
			<ConfigurationInformationAddress/>
			<InterfaceCompatibilityMode>TaxiEnableVersion8_2</InterfaceCompatibilityMode>
		</Properties>
		<ChildObjects>
			<Language>Русский</Language>
			<CommonModule>$Module</CommonModule>
			<CommonModule>$CmdModule</CommonModule>
			<InformationRegister>$CmdReg</InformationRegister>
		</ChildObjects>
	</Configuration>
</MetaDataObject>
"@
W "$x\Languages\Русский.xml" @"
<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject $ns>
	<Language uuid="$($ids.Lang)">
		<InternalInfo/>
		<Properties>
			<ObjectBelonging>Adopted</ObjectBelonging>
			<Name>Русский</Name>
			<Comment/>
			<ExtendedConfigurationObject>$baseLangId</ExtendedConfigurationObject>
			<LanguageCode>ru</LanguageCode>
		</Properties>
	</Language>
</MetaDataObject>
"@
W "$x\CommonModules\$Module.xml" @"
<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject $ns>
	<CommonModule uuid="$($ids.Module)">
		<Properties>
			<Name>$Module</Name>
			<Synonym>
				<v8:item>
					<v8:lang>ru</v8:lang>
					<v8:content>Интерфейс OData (полный состав)</v8:content>
				</v8:item>
			</Synonym>
			<Comment/>
			<Global>false</Global>
			<ClientManagedApplication>false</ClientManagedApplication>
			<Server>true</Server>
			<ExternalConnection>true</ExternalConnection>
			<ClientOrdinaryApplication>false</ClientOrdinaryApplication>
			<ServerCall>true</ServerCall>
			<Privileged>false</Privileged>
			<ReturnValuesReuse>DontUse</ReturnValuesReuse>
		</Properties>
	</CommonModule>
</MetaDataObject>
"@
W "$x\CommonModules\$Module\Ext\Module.bsl" ([IO.File]::ReadAllText((Join-Path $Here "$Module.bsl"), [Text.Encoding]::UTF8))

# ---- v1.1: команды АРМ через OData — общий модуль (сервер, фоновые задания) и регистр команд.
# POST InformationRegister_АрмOData_КомандыPWA {Ид, Команда, Параметры} выполняет команду в ПередЗаписью набора.
W "$x\CommonModules\$CmdModule.xml" @"
<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject $ns>
	<CommonModule uuid="$($ids.CmdModule)">
		<Properties>
			<Name>$CmdModule</Name>
			<Synonym>
				<v8:item>
					<v8:lang>ru</v8:lang>
					<v8:content>Команды АРМ через OData</v8:content>
				</v8:item>
			</Synonym>
			<Comment/>
			<Global>false</Global>
			<ClientManagedApplication>false</ClientManagedApplication>
			<Server>true</Server>
			<ExternalConnection>false</ExternalConnection>
			<ClientOrdinaryApplication>false</ClientOrdinaryApplication>
			<ServerCall>false</ServerCall>
			<Privileged>false</Privileged>
			<ReturnValuesReuse>DontUse</ReturnValuesReuse>
		</Properties>
	</CommonModule>
</MetaDataObject>
"@
W "$x\CommonModules\$CmdModule\Ext\Module.bsl" ([IO.File]::ReadAllText((Join-Path $Here "$CmdModule.bsl"), [Text.Encoding]::UTF8))

function RegField([string]$kind, [string]$uuid, [string]$name, [string]$title, [string]$type) {
    $t = switch -Regex ($type) {
        '^string(\d+)$' { "<v8:Type>xs:string</v8:Type><v8:StringQualifiers><v8:Length>$($Matches[1])</v8:Length><v8:AllowedLength>Variable</v8:AllowedLength></v8:StringQualifiers>" }
        '^bool$'        { '<v8:Type>xs:boolean</v8:Type>' }
        '^datetime$'    { '<v8:Type>xs:dateTime</v8:Type><v8:DateQualifiers><v8:DateFractions>DateTime</v8:DateFractions></v8:DateQualifiers>' }
    }
    $tail = if ($kind -eq 'Dimension') {
        '<Master>false</Master><MainFilter>true</MainFilter><DenyIncompleteValues>false</DenyIncompleteValues><Indexing>Index</Indexing><FullTextSearch>DontUse</FullTextSearch><DataHistory>DontUse</DataHistory><TypeReductionMode>TransformValues</TypeReductionMode>'
    } else { '<Indexing>DontIndex</Indexing><FullTextSearch>DontUse</FullTextSearch><DataHistory>DontUse</DataHistory>' }
    "`t`t`t<$kind uuid=`"$uuid`"><Properties><Name>$name</Name><Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>$title</v8:content></v8:item></Synonym><Comment/><Type>$t</Type>" +
    '<PasswordMode>false</PasswordMode><Format/><EditFormat/><ToolTip/><MarkNegatives>false</MarkNegatives><Mask/><MultiLine>false</MultiLine><ExtendedEdit>false</ExtendedEdit>' +
    '<MinValue xsi:nil="true"/><MaxValue xsi:nil="true"/><FillFromFillingValue>false</FillFromFillingValue><FillValue xsi:nil="true"/><FillChecking>DontCheck</FillChecking>' +
    '<ChoiceFoldersAndItems>Items</ChoiceFoldersAndItems><ChoiceParameterLinks/><ChoiceParameters/><QuickChoice>Auto</QuickChoice><CreateOnInput>Auto</CreateOnInput><ChoiceForm/><LinkByType/>' +
    "<ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>$tail</Properties></$kind>"
}
$gen = @('Record', 'Manager', 'Selection', 'List', 'RecordSet', 'RecordKey', 'RecordManager') | ForEach-Object -Begin { $i = 10 } -Process {
    $i++
    "`t`t`t<xr:GeneratedType name=`"InformationRegister$_.$CmdReg`" category=`"$_`"><xr:TypeId>b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1b$i</xr:TypeId><xr:ValueId>b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1c$i</xr:ValueId></xr:GeneratedType>"
}
$fields = @(
    (RegField 'Resource' 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1d01' 'Команда' 'Команда' 'string50'),
    (RegField 'Resource' 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1d02' 'Параметры' 'Параметры (JSON)' 'string0'),
    (RegField 'Resource' 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1d03' 'Результат' 'Результат (JSON)' 'string0'),
    (RegField 'Resource' 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1d04' 'Успешно' 'Успешно' 'bool'),
    (RegField 'Resource' 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1d05' 'Пользователь' 'Пользователь' 'string150'),
    (RegField 'Resource' 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1d06' 'ДатаВыполнения' 'Дата выполнения' 'datetime'),
    (RegField 'Dimension' 'b6f1c3a2-5d7e-4f10-9a2b-0c4d6e8f1d07' 'Ид' 'Ид' 'string36'))
W "$x\InformationRegisters\$CmdReg.xml" @"
<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject $ns>
	<InformationRegister uuid="$($ids.CmdReg)">
		<InternalInfo>
$($gen -join "`n")
		</InternalInfo>
		<Properties>
			<Name>$CmdReg</Name>
			<Synonym>
				<v8:item>
					<v8:lang>ru</v8:lang>
					<v8:content>Команды PWA через OData</v8:content>
				</v8:item>
			</Synonym>
			<Comment/>
			<UseStandardCommands>true</UseStandardCommands>
			<EditType>InDialog</EditType>
			<DefaultRecordForm/>
			<DefaultListForm/>
			<AuxiliaryRecordForm/>
			<AuxiliaryListForm/>
			<InformationRegisterPeriodicity>Nonperiodical</InformationRegisterPeriodicity>
			<WriteMode>Independent</WriteMode>
			<MainFilterOnPeriod>false</MainFilterOnPeriod>
			<IncludeHelpInContents>false</IncludeHelpInContents>
			<DataLockControlMode>Managed</DataLockControlMode>
			<FullTextSearch>DontUse</FullTextSearch>
			<EnableTotalsSliceFirst>false</EnableTotalsSliceFirst>
			<EnableTotalsSliceLast>false</EnableTotalsSliceLast>
			<RecordPresentation/>
			<ExtendedRecordPresentation/>
			<ListPresentation/>
			<ExtendedListPresentation/>
			<Explanation/>
			<DataHistory>DontUse</DataHistory>
			<UpdateDataHistoryImmediatelyAfterWrite>false</UpdateDataHistoryImmediatelyAfterWrite>
			<ExecuteAfterWriteDataHistoryVersionProcessing>false</ExecuteAfterWriteDataHistoryVersionProcessing>
		</Properties>
		<ChildObjects>
$($fields -join "`n")
		</ChildObjects>
	</InformationRegister>
</MetaDataObject>
"@
W "$x\InformationRegisters\$CmdReg\Ext\RecordSetModule.bsl" ([IO.File]::ReadAllText((Join-Path $Here "$CmdReg.RecordSet.bsl"), [Text.Encoding]::UTF8))

$log = Join-Path $x 'designer.log'
function Run1C([string]$ArgsLine, [string]$What) {
    $res = Join-Path $x 'result.txt'; Remove-Item $res, $log -ErrorAction SilentlyContinue
    $auth = if ($IbUser) { "/N `"$IbUser`" /P `"$IbPassword`"" } else { '' }
    Start-Process $V8 -ArgumentList "DESIGNER /F `"$IbDir`" $auth $ArgsLine /DisableStartupDialogs /DisableStartupMessages /Out `"$log`" /DumpResult `"$res`"" -Wait
    $code = if (Test-Path $res) { "$(Get-Content $res -Raw)".Trim() } else { '-1' }
    $text = if (Test-Path $log) { "$(Get-Content $log -Raw -Encoding UTF8)".Trim() } else { '' }
    if ($code -ne '0') { throw "$What — код $code`n$text" }
    Write-Host "  [OK] $What$(if ($text) { ": $($text -replace '\s+', ' ')" })" -ForegroundColor Green
}
$cfe = Join-Path $Root "АРМ_OData_v$Version.cfe"
Run1C "/LoadConfigFromFiles `"$x`" -Extension $ExtName -Format Hierarchical" "загрузка XML в базу $IbDir"
Run1C "/UpdateDBCfg -Extension $ExtName" 'применение расширения'
Run1C "/CheckModules -Server -ExternalConnection -ThinClient -Extension $ExtName" 'проверка модулей'
Run1C "/DumpCfg `"$cfe`" -Extension $ExtName" "выгрузка $(Split-Path -Leaf $cfe)"
Remove-Item $x -Recurse -Force
Write-Host "ГОТОВО: $cfe" -ForegroundColor Green

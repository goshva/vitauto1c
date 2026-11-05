# Копия рабочей базы vitauto на локальной машине — с нуля

Результат: на чистой Windows-машине работает то же, что на сервере UUU2:

- PostgreSQL 1C 18 + сервер 1С:Предприятие 8.3.27.2342 (x86);
- информационная база **vitauto** из дампа рабочей базы: те же пользователи ИБ, пароли, роли, настройки пользователей,
  конфигурация «Автосервис» 3.0.11.169 и расширения (патч `EF_00_00185532`, `АРМЗакупокИПродаж`, `АРМ_OData` 1.1);
- Apache 2.4 (win32) на `:8090` с публикацией OData `/vitauto`;
- PWA АРМ на `http://127.0.0.1:5173`, подключённая к `/vitauto`.

Схема шагов — страница «3. Бэкап и развёртывание» в [architecture.drawio](architecture.drawio).
Скрипты запускаются **строго по порядку**: каждый следующий опирается на результат предыдущего.

| Шаг | Где | Скрипт | Время |
|---|---|---|---|
| A1 | сервер | `backup-1c-full.ps1` — свежий дамп | ~3 мин |
| A2 | — | перенос файлов | — |
| B1 | новая машина | `install-1c-pgsql.ps1 -SourceDump …` | 20–40 мин (скачивание + pg_restore ~5 мин) |
| B2 | новая машина | `checkApacheOdata.ps1` | 2–5 мин |
| B3 | новая машина | Node.js + `npm ci` + `npm run dev:vitauto` | ~3 мин |
| B4 | новая машина | проверки | 2 мин |

## Требования к новой машине

- Windows 10/11 или Windows Server 2016+ x64, PowerShell 5.1, права администратора.
- Диск **D:** (скрипты по умолчанию работают с `D:\1c`, `D:\1c_bases`, `D:\PostgreSQL 1C`): свободно ≥ 15 ГБ;
  на C: ≥ 10 ГБ (платформа, кэш сервера 1С).
- Интернет — если архивы не перенесены с сервера (Яндекс.Диск, repo.postgres.ru, apachelounge.com, nodejs.org).
- git.
- **На машине не должно быть нужных вам баз 1С 8.3.27.2342**: шаг 0 `install-1c-pgsql.ps1` удаляет прошлую установку
  этой версии (службу сервера 1С, кластер `C:\srvinfo`, список баз). Уже установленный PostgreSQL для 1С с данными
  он не трогает (кроме `-ReinstallPostgres`).

## A. На рабочем сервере

### A1. Свежий дамп

PowerShell (администратор не обязателен), из каталога репозитория:

```powershell
cd C:\Bases1C\vitauto1c
.\backup-1c-full.ps1 -Database vitauto -IbName vitauto -PgPort 5433 -NoCfg
```

- спросит пароль пользователя `postgres` PostgreSQL сервера;
- на сервере PostgreSQL слушает порт **5433** (не 5432);
- пользователей 1С не блокирует: `pg_dump` делает согласованный снимок;
- результат: `D:\1c_bases\backup\vitauto_<ГГГГММДД_ЧЧММ>.dump` (~1,3 ГБ) и каталог
  `vitauto_<…>\` с `settings.json` (кластер, список баз, публикации Apache, службы) и `BACKUP-REPORT.txt`.

Дамп должен быть **сделан после** последних изменений пользователей/прав — иначе на копии будут старые пароли.

### A2. Перенести на новую машину в `D:\1c`

| Файл (на сервере) | Нужен | Зачем |
|---|---|---|
| `D:\1c_bases\backup\vitauto_<дата>.dump` | **да** | база |
| `D:\1c\windows_8_3_27_2342.rar` | нет | платформа 1С; иначе скачается с Яндекс.Диска |
| `D:\1c\PostgreSQL_1C_18.4_64bit_Setup.exe` | нет | PostgreSQL 18; иначе скачается с repo.postgres.ru |
| `D:\1c\httpd-2.4.66-251206-win32-vs17.zip` | нет | Apache win32; иначе скачается с apachelounge.com. SHA256 `798B6BD7A4FCBB66AE3436B86BBC2E29F3E6165B970D471C1589DD782FFF2B12` |

Файлы `*.dump`, `*.rar`, `*.zip`, `*.exe` в git не хранятся (`.gitignore`).

## B. На новой машине

Все команды — в **PowerShell, запущенном от администратора** (скрипты перезапускают себя с правами администратора,
но тогда параметры с пустыми строками и пароли надёжнее задать сразу в окне администратора).

### B0. Репозиторий

```powershell
git clone git@github.com:goshva/vitauto1c.git C:\Bases1C\vitauto1c
cd C:\Bases1C\vitauto1c
git checkout techdebt/arm-v2.22
Set-ExecutionPolicy -Scope Process Bypass -Force
```

### B1. PostgreSQL + 1С + база vitauto из дампа

```powershell
.\install-1c-pgsql.ps1 -Force -SourceDump 'D:\1c\vitauto_<дата>.dump' `
    -IbName vitauto -IbTitle vitauto -ExtensionFile '' -AdminUser '' -IbUser 'Автосервис' -NoSeed
```

Спросит:
1. **пароль суперпользователя PostgreSQL** — для новой установки это новый пароль; только ASCII (латиница/цифры);
   запомните — он нужен для бэкапов и `restore-1c-pgsql.ps1`;
2. **пароль пользователя 1С «Автосервис»** — нажмите Enter (пустой).

Почему именно эти ключи:

| Ключ | Зачем |
|---|---|
| `-SourceDump` | база из дампа PostgreSQL: `CREATE DATABASE` → `pg_restore` → регистрация в кластере 1С (`CREATEINFOBASE … CrSQLDB=N`, данные не трогаются) |
| `-IbName vitauto` | имя базы в кластере 1С и в PostgreSQL — как на сервере (на него настроены публикация и PWA) |
| `-ExtensionFile ''` | **не** подключать `.cfe` из репозитория: расширения уже в дампе; в репозитории `АРМ_OData` 1.2 и АРМ v2.22 — на сервере стоят другие версии |
| `-AdminUser ''` | **не** сбрасывать пароль «Администратора» — пароли как на сервере |
| `-IbUser 'Автосервис'` | под ним конфигуратор/проверки/запуск 1С (без пароля, роль ПолныеПрава) |
| `-NoSeed` | не заполнять демо-данными АРМ — это рабочие данные |

Что делает скрипт: удаляет прошлую установку (шаг 0) → скачивает/распаковывает платформу (`autoservice.zip` при
`-SourceDump` не нужен) → PostgreSQL 18 (служба `postgresql-1c-18`, порт 5432, если свободен — иначе следующий)
→ платформа 1С с сервером и **модулями веб-сервера** (`WEBSERVEREXT=1`), служба агента → технологический журнал
→ база из дампа → проверка подключения → запуск тонкого клиента под «Автосервис». Лог: `D:\1c\logs\install_*.log`.

> Если платформа 1С 8.3.27.2342 на машине уже стояла **без** модулей веб-сервера (нет `wsap24.dll` в
> `C:\Program Files (x86)\1cv8\8.3.27.2342\bin`), выполните `.\install_Apache.ps1` — он доустановит компонент.

### B2. Apache + публикация OData `/vitauto`

```powershell
.\checkApacheOdata.ps1
```

По умолчанию: база `vitauto`, публикация `/vitauto`, проверка OData под «Автосервис». Скрипт:
1. находит платформу и `wsap24.dll`;
2. ставит Apache **win32** (платформа 1С 32-битная: 64-битный Apache её модуль не загрузит) в `D:\1c\apache`
   из архива в `D:\1c` или скачивает его;
3. пишет `D:\1c\apache\httpd-1c.conf` (порт 8090, модуль `_1cws_module`, правило «переносить только Bearer»);
4. публикует базу (`webinst`, `default.vrd` с `standardOdata enable="true"`);
5. проверяет `httpd -t`, запускает Apache, запрашивает OData. Первый запрос — до 2 минут (1С строит модель).

Ожидаемо в конце: `[OK] OData отвечает: HTTP 200`. Если Apache не стартует — нужен Visual C++ 2015-2022 **x86**
(`vc_redist.x86.exe`).

### B3. PWA

1. Node.js 22 LTS — установщик с https://nodejs.org (или zip в `%LOCALAPPDATA%\Programs` и путь в `PATH`).
2. Запуск:

```powershell
cd C:\Bases1C\vitauto1c\pwa
npm ci
npm run dev:vitauto        # http://127.0.0.1:5173, прокси /odata -> http://127.0.0.1:8090/vitauto/odata/standard.odata
```

Вход — пользователь ИБ 1С: «Автосервис» без пароля (роль АРМ «Менеджер»). Пользователи `arm.*` входят, только если
у них есть роль `ПолныеПрава` (см. [TODO.md](TODO.md), п. 1) — так же, как на сервере.

### B4. Проверки

```powershell
# OData: число строк АРМ — сравнить с тем же запросом на сервере
$auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('Автосервис:'))
(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8090/vitauto/odata/standard.odata/InformationRegister_Арм_ДанныеЗакупокИПродаж/$count' -Headers @{Authorization=$auth}).Content

# через прокси PWA — то же число
(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5173/odata/InformationRegister_Арм_ДанныеЗакупокИПродаж/$count' -Headers @{Authorization=$auth}).Content
```

- Тонкий клиент: база «vitauto» в списке баз, вход теми же пользователями и паролями, что на сервере.
- Только чтение для PWA: `cd pwa; $env:ODATA_URL='http://127.0.0.1:8090/vitauto/odata/standard.odata'; $env:MAIN_READONLY='1'; npx vitest run -c vitest.e2e.config.js e2e/main-smoke.e2e.js`
  (тест «разделы … машины» сверяет данные копии `autoservice_main` и на vitauto падает — см. TODO).

### B5. (Рекомендуется) запретить регламентные задания копии

Копия наследует регламентные задания рабочей базы (обмены, рассылки, загрузки). Чтобы копия ничего не отправляла
наружу от имени рабочей базы:

```powershell
$rac = 'C:\Program Files (x86)\1cv8\8.3.27.2342\bin\rac.exe'
Start-Process ($rac -replace 'rac\.exe$', 'ras.exe') -ArgumentList 'cluster', '--port=1545', 'localhost:1540' -WindowStyle Hidden; Start-Sleep 3
$cl = (& $rac localhost:1545 cluster list | Select-String '^cluster\s*:\s*(\S+)').Matches[0].Groups[1].Value
$ib = ((& $rac localhost:1545 infobase summary list --cluster=$cl | Select-String -Context 0, 1 '^infobase' |
    Where-Object { $_.Context.PostContext -match 'name\s*:\s*vitauto$' }).Line -replace '^infobase\s*:\s*', '').Trim()
& $rac localhost:1545 infobase update --cluster=$cl --infobase=$ib --infobase-user='Автосервис' --infobase-pwd='' --scheduled-jobs-deny=on
```

## После перезагрузки

PostgreSQL и сервер 1С — службы, стартуют сами. Apache и PWA — нет:

```powershell
.\odata\start-apache.ps1 -ODataUrl http://127.0.0.1:8090/vitauto/odata/standard.odata/ -User 'Автосервис'
cd pwa; npm run dev:vitauto
```

## Обновить копию свежими данными

База уже есть — повторять B1 не нужно:

```powershell
.\restore-1c-pgsql.ps1 -Dump 'D:\1c\vitauto_<новая дата>.dump' -Database vitauto -IbUser 'Автосервис'
```

Заменяет **все** данные копии (страховочный дамп не делается), перезапускает службу 1С и Apache.
Порт PostgreSQL по умолчанию 5432; если B1 поставил PostgreSQL на другой порт (5432 был занят) — добавьте `-PgPort <порт>`.

## Что переносится, а что создаётся заново

| Что | Как попадает на новую машину |
|---|---|
| пользователи ИБ, пароли, роли (`v8users`) | дамп |
| настройки пользователей (`_commonsettings`, `_systemsettings`, `_frmdtsettings`, история `_usersworkhistory`) | дамп |
| конфигурация и расширения (`config`, `_extensionsinfo`), включая патч | дамп |
| состав OData (`_odatasettings`) | дамп |
| данные АРМ, права АРМ (`Арм_ПраваПользователей`) | дамп |
| регистрация базы в кластере, список баз (`ibases.v8i`) | B1 (как на сервере: `Srvr=localhost;Ref=vitauto`) |
| публикация Apache `/vitauto` | B2 (на сервере есть ещё `/autoservice` — для копии не нужна) |
| технологический журнал | B1, настройки по умолчанию скрипта |
| PostgreSQL порт | 5432 на новой машине (на сервере 5433 — из-за PostgreSQL 15 на 5432) |

## Как это проверено (28.10.2026, сервер UUU2)

- Дамп `vitauto_20261028_1502.dump` восстановлен той же командой `pg_restore`, что в `install-1c-pgsql.ps1 -SourceDump`,
  во временную БД: код 0, 4 мин 43 с. Контрольные суммы строк совпали с рабочей `vitauto` для `v8users`, `config`,
  `_extensionsinfo`, `_odatasettings`, `_commonsettings`, `_systemsettings`, `_frmdtsettings`, `_usersworkhistory`,
  `files`, `dbschema` (в `params` отличаются только 2 служебные строки кэша интерфейса `*.ui`).
- Временная БД зарегистрирована в кластере 1С командой из скрипта (`CREATEINFOBASE … CrSQLDB=N`, для теста
  `SchJobDn=Y`): вход «Автосервис», конфигурация 3.0.11.169, 11 пользователей ИБ, 3 расширения, 22 строки АРМ — как
  на рабочей базе. Временные БД и регистрация удалены.
- Конфиг Apache, который пишет `checkApacheOdata.ps1`: `httpd -t` — Syntax OK; временный Apache на `:18090` с этим
  конфигом отдал OData `/vitauto` (HTTP 200, 22 строки АРМ).
- `npm run dev:vitauto`: прокси PWA → `/vitauto` — HTTP 200.
- Все `.ps1` разбираются PowerShell 5.1 без ошибок, сохранены в UTF-8 с BOM.

**Не проверено целиком:** прогон B1 → B2 на чистой машине — `install-1c-pgsql.ps1` удаляет установку 1С, на рабочем
сервере его запускать нельзя. Ветку `-SourceDump` раньше нельзя было вызвать (параметр не был объявлен) —
исправлено в этом коммите; первый полный прогон сделайте на виртуальной машине (TODO, п. 14).

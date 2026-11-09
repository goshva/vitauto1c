# Переустановка на удалённом сервере — release/fr3-fr5-supplier-order

Релиз закрывает ФТ v2, п. 3 «Заказ поставщику по кнопке» и п. 5 «Роли в системе» и включает:

| Что | Где |
|---|---|
| Сервер: POST /sales/supplier-orders вместо заглушки 501 | [backend/internal/arm/supplier_order.go](../backend/internal/arm/supplier_order.go), [backend/internal/api/handlers.go](../backend/internal/api/handlers.go) |
| PWA: кнопка «Заказать поставщику» в рабочем месте снабжения | [pwa/src/views/LinesView.vue](../pwa/src/views/LinesView.vue), [pwa/src/odata/backend.js](../pwa/src/odata/backend.js) |
| Seed-стенд для приёмки | [seed/supplier-order-stand.sql](../seed/supplier-order-stand.sql), [seed/supplier-order-stand.ps1](../seed/supplier-order-stand.ps1) |
| Backend- и API-тесты | [backend/internal/arm/supplier_order_test.go](../backend/internal/arm/supplier_order_test.go), [backend/internal/api/supplier_order_test.go](../backend/internal/api/supplier_order_test.go) |

Сквозные e2e-сценарии в релиз не входят: раздел 8 — чек-лист ручной приёмки.

## 0. Параметры вашего сервера

Подставьте свои значения один раз и выполняйте шаги из этой же сессии PowerShell:

```powershell
$Root   = 'C:\Bases1C\vitauto1c'      # каталог репозитория
$Db     = 'vitauto_app'                 # рабочая база vitauto (данные пользователей)
$PgPort = 5432                          # на сервере с 1С часто 5433
$PgUser = 'postgres'
$Api    = 'http://127.0.0.1:18100'      # адрес vitauto-api
$Branch = 'release/fr3-fr5-supplier-order'
```

Требуется: Windows Server, PostgreSQL 18 (для 1С), Go 1.27.3+, Node.js 20+, git; права администратора
для перезапуска службы/процесса. vitauto-api может работать как процесс (скрипты start-dev.ps1 /
stop-dev.ps1) — установка службы (winsw) пока не сделана (п. 21 в [docs/TODO.md](../docs/TODO.md)).

## 1. Бэкап и точка отката

```powershell
$env:PGPASSWORD = '<пароль postgres>'
& 'C:\Program Files\PostgreSQL 1C\18\bin\pg_dump.exe' -h 127.0.0.1 -p $PgPort -U $PgUser -Fc -d $Db -f "D:\backup\$($Db)-$(Get-Date -Format yyyyMMdd-HHmm).dump"
cd $Root; git rev-parse HEAD   # запишите текущий коммит — это точка отката
```

## 2. Остановить приложение

```powershell
cd $Root
.\stop-dev.ps1
# если PWA отдаётся собранным dist через IIS/nginx — остановите соответствующий сайт/службу
Get-Process vitauto-api -ErrorAction SilentlyContinue   # должно быть пусто
```

## 3. Обновить код

```powershell
cd $Root
git fetch --prune origin
git checkout $Branch
git pull --ff-only
git log -1 --oneline            # ожидаем коммит релиза
```

## 4. Миграции схемы

Миграции идемпотентны; в этом релизе новых файлов нет — команда подтверждает версию схемы 12.

```powershell
$env:VITAUTO_DB = "postgres://$($PgUser):<пароль>@127.0.0.1:$($PgPort)/$($Db)"
cd $Root\backend
go run ./cmd/migrator schema-up
# ожидаем: schema-up: версия схемы 12 / schema-up: готово
```

## 5. Сборка и запуск API

```powershell
cd $Root\backend
go build -o $Root\bin\vitauto-api.exe ./cmd/api

$env:VITAUTO_ADDR = '127.0.0.1:18100'
$env:VITAUTO_DB   = "postgres://$($PgUser):<пароль>@127.0.0.1:$($PgPort)/$($Db)"
# при настроенном обмене с 1С — те же переменные, что были раньше:
# $env:VITAUTO_1C_URL / $env:VITAUTO_1C_USER / $env:VITAUTO_1C_PASS / $env:VITAUTO_1C_INTERVAL
Start-Process -FilePath $Root\bin\vitauto-api.exe -WorkingDirectory $Root
```

Проверка:

```powershell
Invoke-RestMethod "$Api/api/v1/health"   # status = ok, database = ok
```

Если сервер использует start-dev.ps1 (Go API + vite), достаточно запустить его — он сам соберёт API,
применит миграции и поднимет PWA.

## 6. PWA

```powershell
cd $Root\pwa
npm ci
npm run build          # артефакт dist/ — отдать вашим веб-сервером (IIS/nginx)
# npm run dev:vitauto  # dev-режим, как на демо-стенде
```

После обновления пользователю нужен жёсткий перезапрос страницы (Ctrl+F5): у PWA включён autoUpdate.

## 7. Тесты backend и API (обязательны в этом релизе)

Два уровня:

- backend/internal/arm — сервис SupplierOrder (валидация, группировка, переходы строк, ветки 409);
- backend/internal/api — HTTP-контракт POST /sales/supplier-orders (401/400/403/201, представление строки).

Оба уровня имеют быстрые проверки без базы (выполняются всегда) и интеграционные — на выделенной базе
vitauto_so_stand, которую создаёт seed-стенд. Рабочая база vitauto_app при этом НЕ затрагивается.

```powershell
# 1) поднять стенд (создаст/пересоздаст vitauto_so_stand)
cd $Root
.\seed\supplier-order-stand.ps1 -PgPort $PgPort -PgPassword '<пароль postgres>'

# 2) прогнать тесты фичи
$env:VITAUTO_SO_DSN = "postgres://$($PgUser):<пароль>@127.0.0.1:$($PgPort)/vitauto_so_stand"
cd $Root\backend
go test ./internal/arm/ ./internal/api/ -run SupplierOrder -v
```

Без VITAUTO_SO_DSN интеграционные тесты пропускаются (SKIP), но быстрые проверки всё равно выполняются.
Полный прогон бэкенда — cd $Root\backend; go test ./...

## 8. Ручная приёмка (e2e делает человек)

1. Войти в PWA: Снабженец / supply123.
2. Открыть рабочее место снабжения (вид «Закупки»), отметить одну-две закупки.
3. Нажать «Заказать поставщику»: создаются заказы поставщикам (один на поставщика + договор + заказ
   покупателя), строки переходят в «Заказано», отметка снимается, связанные продажи того же количества —
   тоже «Заказано».
4. Повторить команду по тем же строкам — создание не происходит (409 nothing_marked).
5. Войти как Кладовщик / storekeeper123: кнопка/команда недоступна, сервер отвечает 403 matrix_denied.
6. Автосоздание при проведении «Заказа клиента»: заказ поставщику появляется только по кнопке. Фоновое
   создание осталось в сценарии «В работе» по отмеченным закупкам — согласуйте с продуктом, считается ли
   это выполнением требования п. 3 ФТ.

Быстрая проверка через API (без PWA):

```powershell
$login = Invoke-RestMethod -Method Post "$Api/api/v1/session" -ContentType 'application/json' -Body (@{ login = 'Снабженец'; password = 'supply123' } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.token)" }
$body = @{ lineIds = @('<uuid-отмеченной-закупки>') } | ConvertTo-Json
Invoke-RestMethod -Method Post "$Api/api/v1/sales/supplier-orders" -Headers $h -ContentType 'application/json' -Body $body   # 201, массив DocumentRef
```

## 9. Откат

```powershell
cd $Root
.\stop-dev.ps1
git checkout <коммит-из-шага-1>
cd backend; go build -o $Root\bin\vitauto-api.exe ./cmd/api
Start-Process -FilePath $Root\bin\vitauto-api.exe -WorkingDirectory $Root
```

Схема БД в этом релизе не меняется, поэтому откат кода безопасен. Если пострадали данные — восстановите
дамп из шага 1 (pg_restore) и только после этого возвращайте код.

## 10. Чек-лист «готово»

- [ ] git log -1 на сервере совпадает с релизным коммитом;
- [ ] schema-up отработал без ошибок;
- [ ] /api/v1/health — ok/ok;
- [ ] go test ./internal/arm/ ./internal/api/ -run SupplierOrder — зелёный на vitauto_so_stand;
- [ ] ручная приёмка по разделу 8 пройдена;
- [ ] дамп из шага 1 сохранён до следующего релиза.

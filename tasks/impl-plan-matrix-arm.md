# План реализации: АРМ ↔ матрица ↔ сценарии (после v2.10)

**Версия плана:** 2 (переписан по аудиту `plan-prompts-audit`, 05.10.2026).  
**Режим:** подготовка документов. **Внедрение кода — только после явного ок владельца на ID задачи** (фраза «внедряй T0x» / «ок D1…»).  
**База кода:** `fix/open-tasks` · `src/АРМЗакупокИПродаж_v2.10` · `АРМЗакупокИПродаж_v2.10.cfe`.  
**Канон прав:** вкладка **manager**, уровень **order**, mode=all — `index.html` / `default-matrix.js`  
([Pages](https://goshva.github.io/vitauto1c/?role=manager&level=order&mode=all)).  
**Сценарии:** `process.html`.  
**Gap:** canvas `arm-v210-matrix-gaps`.  
**Вне scope всегда:** `process-api` / Node `api/` / PWA как прод; merge в `dev`/`master`/`basdev` без отдельного ок.

---

## Как пользоваться

1. Прочитать этот файл (гейты, порядок, топология).
2. Убедиться, что нужные **D\*** закрыты (таблица ниже). Нет ответа → **не запускать** промпт внедрения.
3. Открыть `tasks/impl-prompts/Txx-….md`, скопировать блок **PROMPT** целиком агенту.
4. После задачи: обновить статус в этом файле; при смене `.cfe` — patch-notes + `diff-cfe.ps1`.

**Запрещено во всех промптах (и здесь):**  
merge/rebase между ветками без ок · force push · amend чужих коммитов · LoadCfg/seed на боевую · «подтяни» = только fetch/FF · менять канон матрицы без отдельного решения · считать lab HTTP/PWA покрытием тонкого клиента · подставлять дефолт решения владельца вместо стопа.

---

## Решения владельца (гейты)

Пока статус ≠ **принято**, задачи из колонки «Блокирует» **не внедрять**. Дефолты ниже — **предложения для согласования**, не разрешение агенту действовать молча.

| ID | Вопрос | Блокирует | Предложение (нужен явный ок) | Статус |
|---|---|---|---|---|
| D1 | Источник ACL + **какая вкладка** матрицы для роли X (вкладка X vs всегда manager)? Что с расхождениями ~32 ячеек? Новые статусы `in_work` / `partially_ordered` / `to_stock` — брать как есть или сначала опросник? | T01 (+всё на ACL) | Источник `default-matrix.js`; **права роли X с вкладки manager** (канон Pages); расхождения зафиксировать отчётом; новые статусы — as-is с пометкой «не валидированы опросником» | принято (без остановок 05.10.2026): источник `default-matrix.js`; права любой роли — по маскам вкладки **manager** (order); расхождения ~32 ячеек — отчётом (`tools/_generated_matrix_rights.json`); новые статусы as-is («не валидированы опросником») |
| D1b | Роль без записи в `Арм_ПраваПользователей`: сейчас fail-open → Менеджер | T01 | **fail-closed** (deny edit), отдельная миграция/отчёт по пользователям | принято (без остановок 05.10.2026): **fail-closed** — роль без записи = пусто = deny edit (форма открывается) |
| D1c | Бит creator (128) на `contract`: сейчас =? `АвторСтроки` (отметка) — это **другая** сущность | T01, T02 | Отложить creator-правило **или** завести поле «создатель строки»; не мапить на `АвторСтроки` | принято (без остановок 05.10.2026): creator (128) **отложен**, бит игнорируется (TODO в модуле); не мапится на `АвторСтроки` |
| D1d | Роль **Снабжение** (есть в 1С, нет в матрице 6 ролей): какая маска? | T01, T07 | Пока = права **storekeeper** на закуп/приёмку **или** отдельная таблица — выбрать явно | принято (без остановок 05.10.2026): Снабжение = маска **storekeeper** (бит 2) |
| D1e | Admin: резать по матрице (ужесточение vs принятый whitelist v2.1.1) или сохранить «admin правит whitelist без статуса»? | T01, T03 | Вариант A: по матрице. Вариант B: whitelist admin без статуса + матрица для остальных. **Нужен выбор** | принято (без остановок 05.10.2026): вариант B — admin whitelist **без статуса** (v2.1.1), без привязки к матрице; `НомерОтгрузки`, `СтатусСтроки` не в whitelist |
| D2 | Кто меняет `line_status`? Матрица: manager (admin=0). Код v2.10: кнопки у admin | T03 | Явно: (1) только manager (2) manager+admin вопреки матрице (3) матрица+исключение для 3 MVP-кнопок admin | принято (без остановок 05.10.2026): `line_status` меняют **manager + admin** (admin — исключение из матрицы для 3 MVP-кнопок) |
| D3 | Снабжение vs Кладовщик: две формы или слить? | T07 | Оставить `ФормаСнабжение`; ACL кладовщика на основной `Форма` | принято (без остановок 05.10.2026): оставить `ФормаСнабжение`; ACL кладовщика на основной `Форма` |
| D4 | Источники 5 заглушек (шасси, резерв qty, в пути, УПД×2) | T05 | Поля в регистре; fill: ручной по ACL и/или из документов после разведки УНФ (шаг 0 в T05) | принято (без остановок 05.10.2026): поля регистра для 5 заглушек добавлены; ручной ввод по ACL; УПД — из ПН, если в ней есть реквизит (проверка в рантайме), иначе ручной. Резерв/в пути — только система/RO для всех ролей матрицы. См. [stub-columns.md](stub-columns.md) |
| D5 | Ед. изм.: список + хранение + пересчёт + что с уже введёнными строками | T09 | Список 6 из `index.html`; остальное — ответы в `units-of-measure.md` до кода | принято (без остановок 05.10.2026): 6 единиц из `index.html`, хранение строкой, без пересчёта количества, М4 — только просмотр. См. [units-of-measure.md](units-of-measure.md) |
| D6 | Механик G1–G9 в горизонте? | T13 | Нет → T13 не стартует | принято (без остановок 05.10.2026): механика нет → T13 **отменён** |
| D7 | Merge `fix/open-tasks` → `dev` после приёмки? | — | Только отдельным ок | принято (без остановок 05.10.2026): merge `fix/open-tasks` → `dev` **не делаем** (только отдельным явным ок владельца) |
| D8 | Топология веток: одна `fix/open-tasks` (коммиты пачками) **или** стек `fix/*` с явным переносом? | все T01+ | **Рекомендация:** одна ветка `fix/open-tasks`, задачи = коммиты/пачки; дочерние только для длинных Phase A | принято (без остановок 05.10.2026): одна ветка `fix/open-tasks`, задачи = коммиты/пачки |
| D9 | Нумерация CFE: один bump на пачку P0 (T01+T02+…) = v2.11, дальше v2.12…? Hotfix приёмки = v2.10.1 с обязательным forward-port в текущий tip | все .cfe | Да: hotfix → `v2.10.1` + перенос в tip; фичи → `v2.11+` | принято (без остановок 05.10.2026): пачка P0 = **v2.11**; hotfix → v2.10.1 + forward-port; дальше v2.12… |

---

## Топология и CFE (после D8/D9)

- Рабочая линия: `fix/open-tasks` (или как решит D8).
- Не ветвиться от `process-api` / старых md-веток.
- Hotfix приёмки правит **копию** `src/…_v2.10.1` (не затирать канон v2.10 без forward-port).
- Сборка: repack v8unpack → `.cfe` → `diff-cfe.ps1` → по возможности `CheckModules` / `UpdateDBCfg` на **test** ИБ.
- BSL в репо — CRLF; генераторы не должны портить EOL.

---

## Порядок задач (v2)

```
T00  приёмка UI v2.10 (человек + отчёт агента)
T00b hotfix v2.10.1          ← только если P0-баги в acceptance; forward-port в tip
T12a учётки ролей на TEST    ← до приёмки ACL (раньше бывшего T12 целиком)
T-map маппинг статусов 15↔18 ← до/внутри T01
T01  ACL engine              ← после D1, D1b, D1c, D1d, D1e
T02  manager (+роли) edit UI ← сразу после T01 (один релиз CFE допустим, 2 коммита)
T03  line_status             ← после T01 + D2
T05  stub columns            ← после D4 + T01 (не «admin only»)
T06  A3 unlock full          ← после T01 + ответ на open questions unlock md
T07  кладовщик/снабжение     ← после T01 + D3 + D1d
T08  авто/autofill/required  ← после T01/T02; required только UI/переход статуса
T09  ед. изм.                ← после D5 (все вопросы md)
T10  возвраты                ← Phase A → ок → B; после T01 (+лучше T03)
T11  печать/уведомления      ← Phase A → ок → B
T12b процессный seed шаг 3   ← после T00; скрипт с запретом боевой
T04  process.html cov        ← rolling: черновик после T00, финал после P0/P1
T13  механик                 ← только D6=да
```

### Вне этого плана (дыры gap, отдельные решения)

- Реальное резервирование остатка (M3 qty), кросс-поиск/аналоги, права **ролей 1С** на регистр (не только UI ACL), уровень матрицы «Деталь», формула Р3 (Н0 vs К6), артикул/код — строка vs справочник.

---

## Статус задач

| ID | Задача | Prio | Промпт | Гейты | Статус |
|---|---|---|---|---|---|
| T00 | Приёмка UI v2.10 | P0 | [T00-acceptance.md](impl-prompts/T00-acceptance.md) | test ИБ | **BLOCKED_MANUAL 05.10.2026:** шаблон [acceptance-v2.10.md](acceptance-v2.10.md), UI не запускался; проверить после LoadCfg v2.11 на тест-ИБ |
| T00b | Hotfix → v2.10.1 | P0 | [T00b-hotfix.md](impl-prompts/T00b-hotfix.md) | `acceptance-v2.10.md` + ок «фикси» | **WAITING** — ждёт списка багов из живой приёмки T00 |
| T12a | Учётки ролей на TEST | P0 | [T12a-test-accounts.md](impl-prompts/T12a-test-accounts.md) | только test IbDir | **сделано 05.10.2026:** [test-arm-accounts.md](test-arm-accounts.md) + защита `-AllowProd` в `seed-1c.ps1` (в рантайме не проверена); учётки ИБ создаёт тестировщик |
| T-map | Маппинг статусов | P0 | [T-map-statuses.md](impl-prompts/T-map-statuses.md) | — (docs+код констант) | **сделано 05.10.2026** — [status-map-matrix-arm.md](status-map-matrix-arm.md), код в `Арм_МатрицаПрав` v2.11 |
| T01 | ACL роль×статус | P0 | [T01-acl-engine.md](impl-prompts/T01-acl-engine.md) | D1,D1b,D1c,D1d,D1e | **сделано 05.10.2026** (v2.11, `Арм_МатрицаПрав` + тесты) |
| T02 | Edit UI по ACL | P0 | [T02-manager-edit.md](impl-prompts/T02-manager-edit.md) | T01 в tip | **частично 05.10.2026** (общий путь записи `ЗаписатьПолеСтрокиАРМ` + gate Выбор по ACL; отдельные Выбор-обработчики — см. patch-notes-v2.11) |
| T03 | line_status | P0 | [T03-line-status.md](impl-prompts/T03-line-status.md) | T01+D2 | **частично 05.10.2026** (кнопки статусов: manager+admin через ACL; расширение набора статусов — не сделано) |
| T04 | process.html cov | P0/docs | [T04-process-cov.md](impl-prompts/T04-process-cov.md) | лучше после T00; финал после P1 | **draft сделан 05.10.2026** (as-of v2.11 draft, M3/N3/M15/K7/K1/A0; см. [process-cov-refresh.md](process-cov-refresh.md)); финал после приёмки |
| T05 | 5 заглушек | P1 | [T05-stub-columns.md](impl-prompts/T05-stub-columns.md) | D4+T01 | **сделано в исходниках 05.10.2026** (5 ресурсов регистра + колонки + ACL-путь; [stub-columns.md](stub-columns.md)); не проверено в 1С, нужен CheckModules и пересборка CFE |
| T06 | А3 unlock | P1 | [T06-a3-unlock.md](impl-prompts/T06-a3-unlock.md) | T01 + ответы unlock-md | **сделано/закрыто 05.10.2026** (путь через ACL уже работает для не-админа; решения в [unlock-a3-doc-signed.md](unlock-a3-doc-signed.md)); ручная приёмка B6 |
| T07 | Кладовщик/Снабжение | P1 | [T07-storekeeper-supply.md](impl-prompts/T07-storekeeper-supply.md) | T01+D3+D1d | **сделано (minimal) 05.10.2026** ([storekeeper-vs-supply.md](storekeeper-vs-supply.md)): гейт ролей `ОтказРолиСнабжения()` на смену статусов закупки и отметки строк `ФормаСнабжение`; матричный ACL на цепочку закупки — открытый вопрос (конфликт с D2) |
| T08 | Авто / required | P1 | [T08-vehicle-required.md](impl-prompts/T08-vehicle-required.md) | T01/T02 + ок объёма справочника | **Phase A (вариант C) + minimal 05.10.2026** ([vehicle-autofill-required.md](vehicle-autofill-required.md)): required только в UI-переходах статуса/очистке полей; autofill не делается |
| T09 | Ед. изм. | P2 | [T09-units.md](impl-prompts/T09-units.md) | D5 полный | **сделано в исходниках 05.10.2026** (выпадающий список 6 единиц; [units-of-measure.md](units-of-measure.md)); ручная приёмка B9 |
| T10 | Возвраты | P2 | [T10-returns.md](impl-prompts/T10-returns.md) | Phase A ок | **Phase A готов 05.10.2026** — [returns-e2e.md](returns-e2e.md) (MVP-предложение, код не писался) |
| T11 | Печать/уведомления | P2 | [T11-print-notify.md](impl-prompts/T11-print-notify.md) | Phase A ок | **Phase A готов 05.10.2026** — [print-notify-scope.md](print-notify-scope.md) (код не писался) |
| T12b | Seed шаг 3 | P2 | [T12b-seed-process.md](impl-prompts/T12b-seed-process.md) | T00; anti-prod в скрипте | **описание 05.10.2026** — [seed-process-step3.md](seed-process-step3.md); скрипт не расширялся, seed не запускался |
| T13 | Механик | P2 | [T13-mechanic.md](impl-prompts/T13-mechanic.md) | D6=да | **SKIPPED (D6 = нет) 05.10.2026** — механика в горизонте нет, T13 не стартует |

---

## Связанные артефакты

- [patch-notes-v2.10.md](patch-notes-v2.10.md), [fix-open-tasks.md](fix-open-tasks.md)
- [open-tasks-pack5-deferred.md](open-tasks-pack5-deferred.md), [admin-columns-matrix.md](admin-columns-matrix.md)
- [unlock-a3-doc-signed.md](unlock-a3-doc-signed.md), [units-of-measure.md](units-of-measure.md)
- [matrix-statuses-codes-formulas.md](matrix-statuses-codes-formulas.md) ← маппинг статусов
- [shipment-number-system-fill.md](shipment-number-system-fill.md), [seed-local-db.md](seed-local-db.md)
- [../diff/АРМЗакупокИПродаж_v2.8__v2.10.md](../diff/АРМЗакупокИПродаж_v2.8__v2.10.md)
- Промпты: [impl-prompts/README.md](impl-prompts/README.md)

# Промпты исполнения (v2, после аудита)

Индекс плана матрицы: [../impl-plan-matrix-arm.md](../impl-plan-matrix-arm.md)  
План хвостов tip → v2.12: [../impl-plan-tails-v212.md](../impl-plan-tails-v212.md)  
Общий блок правил: [_COMMON.md](_COMMON.md) — уже вшит в каждый PROMPT.

## Хвосты v2.12 (на согласование)

| Файл | Задача | Гейты |
|---|---|---|
| [H01-t02-mute-clicks.md](H01-t02-mute-clicks.md) | «Немые» клики + А1 | D11 + ок инвентаря |
| [H02-t03-status-fsm.md](H02-t03-status-fsm.md) | Переходы статусов шире MVP | D2 + D12 + ок таблицы |
| [H03-t07-supply-acl.md](H03-t07-supply-acl.md) | ACL цепочки снабжения | D10 (+ ок матрицы если B) |
| [H04-upd-qty-sync.md](H04-upd-qty-sync.md) | УПД sync + Н2/Н3 | D13 + D14 |
| [H05-creator-bit.md](H05-creator-bit.md) | Бит creator 128 | D1c′ (A = SKIP/docs) |

## Пачка матрицы (Txx, уже в работе / закрыты частично)

| Файл | Задача | Старт |
|---|---|---|
| [T00-acceptance.md](T00-acceptance.md) | Приёмка UI | после ок |
| [T00b-hotfix.md](T00b-hotfix.md) | Hotfix v2.10.1 / v2.11.1 | после acceptance + «фикси» |
| [T12a-test-accounts.md](T12a-test-accounts.md) | Учётки ролей на TEST | после ок |
| [T-map-statuses.md](T-map-statuses.md) | Маппинг статусов 15↔18 | после ок |
| [T01-acl-engine.md](T01-acl-engine.md) | ACL | D1…D1e приняты |
| [T02-manager-edit.md](T02-manager-edit.md) | Edit UI по ACL (база; хвост = H01) | T01 в tip |
| [T03-line-status.md](T03-line-status.md) | line_status MVP (хвост = H02) | T01+D2 |
| [T04-process-cov.md](T04-process-cov.md) | process.html cov | draft/final |
| [T05-stub-columns.md](T05-stub-columns.md) | 5 заглушек (хвост = H04) | D4+T01 |
| [T06-a3-unlock.md](T06-a3-unlock.md) | А3 unlock | T01+ответы md |
| [T07-storekeeper-supply.md](T07-storekeeper-supply.md) | Кладовщик/Снабжение (хвост = H03) | T01+D3+D1d |
| [T08-vehicle-required.md](T08-vehicle-required.md) | Авто/required | T01/T02+ок объёма |
| [T09-units.md](T09-units.md) | Ед. изм. | D5 полный |
| [T10-returns.md](T10-returns.md) | Возвраты | Phase A |
| [T11-print-notify.md](T11-print-notify.md) | Печать | Phase A |
| [T12b-seed-process.md](T12b-seed-process.md) | Seed шаг 3 | T00+anti-prod |
| [T13-mechanic.md](T13-mechanic.md) | Механик | D6=да |

Устаревшие имена: `T12-seed-accounts.md` заменён на T12a + T12b.

Как запускать: скопировать fenced-блок после заголовка **PROMPT** → агенту. Без фразы владельца «внедряй H0x» / «внедряй T0x» / «ок на …» — агент должен STOP на гейтах.

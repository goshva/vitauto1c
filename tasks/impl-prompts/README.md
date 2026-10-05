# Промпты исполнения (v2, после аудита)

Индекс плана: [../impl-plan-matrix-arm.md](../impl-plan-matrix-arm.md)  
Общий блок правил: [_COMMON.md](_COMMON.md) — уже вшит в каждый PROMPT.

| Файл | Задача | Старт |
|---|---|---|
| [T00-acceptance.md](T00-acceptance.md) | Приёмка UI v2.10 | после ок |
| [T00b-hotfix.md](T00b-hotfix.md) | Hotfix v2.10.1 | после acceptance + «фикси» |
| [T12a-test-accounts.md](T12a-test-accounts.md) | Учётки ролей на TEST | после ок |
| [T-map-statuses.md](T-map-statuses.md) | Маппинг статусов 15↔18 | после ок |
| [T01-acl-engine.md](T01-acl-engine.md) | ACL | D1…D1e приняты |
| [T02-manager-edit.md](T02-manager-edit.md) | Edit UI по ACL | T01 в tip |
| [T03-line-status.md](T03-line-status.md) | line_status | T01+D2 |
| [T04-process-cov.md](T04-process-cov.md) | process.html cov | draft/final |
| [T05-stub-columns.md](T05-stub-columns.md) | 5 заглушек | D4+T01 |
| [T06-a3-unlock.md](T06-a3-unlock.md) | А3 unlock | T01+ответы md |
| [T07-storekeeper-supply.md](T07-storekeeper-supply.md) | Кладовщик/Снабжение | T01+D3+D1d |
| [T08-vehicle-required.md](T08-vehicle-required.md) | Авто/required | T01/T02+ок объёма |
| [T09-units.md](T09-units.md) | Ед. изм. | D5 полный |
| [T10-returns.md](T10-returns.md) | Возвраты | Phase A |
| [T11-print-notify.md](T11-print-notify.md) | Печать | Phase A |
| [T12b-seed-process.md](T12b-seed-process.md) | Seed шаг 3 | T00+anti-prod |
| [T13-mechanic.md](T13-mechanic.md) | Механик | D6=да |

Устаревшие имена: `T12-seed-accounts.md` заменён на T12a + T12b.

Как запускать: скопировать fenced-блок после заголовка **PROMPT** → агенту. Без фразы владельца «внедряй T0x» / «ок на …» — агент должен STOP на гейтах.

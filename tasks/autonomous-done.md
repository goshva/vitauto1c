# Автономный дожим — итог (05–06.10.2026)

**Ветка:** `fix/open-tasks`  
**Commit tip:** после push см. `git log -1` на origin.

## Утренний список (только человек / отдельное ок)

| ID | Что | Почему не закрыто ночью |
|---|---|---|
| **T00** | UI-приёмка АРМ (тонкий клиент, test ИБ) | Нужен клик + LoadCfg v2.11 на test; шаблон [acceptance-v2.10.md](acceptance-v2.10.md) |
| **D7 / merge** | `fix/open-tasks` → `dev` | Явно **не делаем** без отдельного ок владельца |
| **LoadCfg / seed** | UpdateDBCfg / CheckModules / seed на ИБ | Без IbDir test и без боевой; `seed-1c.ps1` только с anti-prod, прогон не выполнялся |
| **T00b** | Hotfix v2.10.1 | Ждёт баг-лист из T00 |
| **T12a runtime** | 12 шагов менеджера на TEST | Док [test-arm-accounts.md](test-arm-accounts.md) готов; учётки и клики — тестировщик |

## Сделано автonomно (vs [autonomous-overnight-plan.md](autonomous-overnight-plan.md))

### P0 — v2.11 tip

- [x] `python tools/test_arm_matrix_rights.py` → **exit 0** (71 tests OK)
- [x] Сборка `АРМЗакупокИПродаж_v2.11.cfe` (`v8unpack -B`, `--auto_include`)
- [x] `diff-cfe.ps1` v2.10 → v2.11 → `diff/АРМЗакупокИПродаж_v2.10__v2.11.{md,diff}`
- [x] T-map, T01, T02 (частично), T03 (частично) в `src/АРМЗакупокИПродаж_v2.11/` + [patch-notes-v2.11.md](patch-notes-v2.11.md)
- [x] Статусы задач в [impl-plan-matrix-arm.md](impl-plan-matrix-arm.md)

### P1 — код + docs (один tip v2.11)

- [x] **T05** — 5 заглушек регистра, ACL, [stub-columns.md](stub-columns.md)
- [x] **T06** — [unlock-a3-doc-signed.md](unlock-a3-doc-signed.md), путь через ACL
- [x] **T07** — [storekeeper-vs-supply.md](storekeeper-vs-supply.md), guards `ФормаСнабжение`
- [x] **T08** — Phase A + minimal UI required, [vehicle-autofill-required.md](vehicle-autofill-required.md)
- [x] **T09** — dropdown 6 ед.изм., [units-of-measure.md](units-of-measure.md)

### P2 — docs only

- [x] **T04** draft — `process.html`, [process-cov-refresh.md](process-cov-refresh.md)
- [x] **T10** Phase A — [returns-e2e.md](returns-e2e.md)
- [x] **T11** Phase A — [print-notify-scope.md](print-notify-scope.md)
- [x] **T12a** docs + anti-prod в `seed-1c.ps1` — [test-arm-accounts.md](test-arm-accounts.md)
- [x] **T12b** — [seed-process-step3.md](seed-process-step3.md)
- [x] **T13** — SKIPPED (D6)

### Публикация

- [x] Commit + push `origin/fix/open-tasks` (без `*-report_*.log`, без credentials)

## Рекомендуемый порядок утром

1. LoadCfg **test** ИБ: `АРМЗакупокИПродаж_v2.11.cfe` → CheckModules / UpdateDBCfg  
2. T00 по чеклисту (обновить acceptance под v2.11 при необходимости)  
3. T12a прогон учёток на TEST  
4. При OK — решение владельца про merge D7 → `dev`

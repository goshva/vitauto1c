# Проверка этапа 3

Дата: 2026-10-30 15:34; ветка `migration/pg-go-vue`, коммит `d19055f` (до коммита протокола); база 1С `vitauto_dev`.
Команда: `tools/migration/gate.ps1 -Stage 3 -Base vitauto_dev`.

| Проверка | Результат | Что проверено | Подробности |
|---|---|---|---|
| G3.1 | PASS | reconcile R5, R6, R8 = 0 | go run ./cmd/migrator reconcile --checks R5,R6,R8 --source vitauto_dev: OK |
| G3.2 | PASS | Повторный прогон идемпотентен | go run ./cmd/migrator reconcile --checks IDEMPOTENT --source vitauto_dev: OK |

Итог: этап закрыт

## Ручная проверка

- [ ] остатки трёх позиций с партиями совпадают с отчётом 1С

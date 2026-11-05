# Проверка этапа 2

Дата: 2026-10-30 15:33; ветка `migration/pg-go-vue`, коммит `d19055f` (до коммита протокола); база 1С `vitauto_dev`.
Команда: `tools/migration/gate.ps1 -Stage 2 -Base vitauto_dev`.

| Проверка | Результат | Что проверено | Подробности |
|---|---|---|---|
| G2.1 | PASS | goose: все миграции применены | go run ./cmd/migrator schema-status --strict: OK |
| G2.2 | PASS | reconcile R1–R4, R7 = 0 | go run ./cmd/migrator reconcile --checks R1,R2,R3,R4,R7 --source vitauto_dev: OK |
| G2.3 | PASS | id объектов 1С = Ref_Key (100%) | go run ./cmd/migrator reconcile --checks UUID --source vitauto_dev: OK |
| G2.4 | PASS | COMMENT у всех столбцов | go run ./cmd/migrator reconcile --checks COMMENTS: OK |

Итог: этап закрыт

## Ручная проверка

- [ ] 10 карточек номенклатуры и 10 строк АРМ сверены с 1С

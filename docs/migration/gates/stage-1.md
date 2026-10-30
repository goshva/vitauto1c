# Проверка этапа 1

Дата: 2026-10-30 15:11; ветка `migration/pg-go-vue`, коммит `0802a80` (до коммита протокола); база 1С `vitauto_dev`.
Команда: `tools/migration/gate.ps1 -Stage 1 -Base vitauto_dev`.

| Проверка | Результат | Что проверено | Подробности |
|---|---|---|---|
| G1.1 | PASS | go build и go vet | go vet ./...: OK |
| G1.2 | PASS | spectral lint api/*.yaml = 0 ошибок | npx --yes @stoplight/spectral-cli@6.15.0 lint api/openapi.yaml api/asyncapi.yaml --fail-severity error: OK |
| G1.3 | PASS | Паритет маршрутов backend.js <-> OpenAPI | go test ./internal/api/ -run TestRouteParity: OK |
| G1.4 | PASS | /api/v1/health = 200 | {"status":"ok","version":"0.1.0"}  |
| G1.5 | PASS | task gen не даёт изменений | сгенерированный код актуален |

Итог: этап закрыт

## Ручная проверка

- [ ] Swagger UI /api/docs открывается, разделы видны

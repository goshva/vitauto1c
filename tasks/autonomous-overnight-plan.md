# Автономный дожим (без присутствия владельца)

**Дата:** 05–06.10.2026  
**Ветка:** `fix/open-tasks`  
**Цель:** закрыть всё из плана, что не требует человека в предприятии 1С, LoadCfg на ИБ, новых D* и merge в `dev`.

Уже разрешено ранее: commit + push по готовности.

---

## Вне скоупа (ждёт человека)

| ID | Почему нельзя одной |
|---|---|
| **T00** UI-приёмка | нужен клик в тонком клиенте + test ИБ |
| **T00b** | нет списка багов из живой приёмки |
| **T12a** прогон учёток на ИБ | нужен путь test ИБ и пароли локально |
| **D7** merge → `dev` | отдельный ок |
| **T13** механик | D6 = нет |
| LoadCfg / seed на любую ИБ | риск боевой; без явного IbDir не трогаем |

Артефакт-заглушка для утра: `tasks/acceptance-v2.10.md` (BLOCKED_MANUAL) — обновить чеклистом под **v2.11**.

---

## Порядок автономной работы

### A. Зафиксировать P0 (v2.11)
1. `python tools/test_arm_matrix_rights.py` → green (чинить до 0).
2. Убедиться/собрать `АРМЗакупокИПродаж_v2.11.cfe` (`python -m v8unpack -B …`).
3. `diff-cfe` v2.10→v2.11; сверить `tasks/patch-notes-v2.11.md`.
4. Обновить статусы T-map/T01/T02/T03 в `impl-plan-matrix-arm.md`.

### B. P1 код+docs в том же v2.11 (или v2.11.1 если уже запакован «чистый» P0 — предпочтительно **один tip v2.11** до push)
5. **T05** — добить проводку 5 полей (регистр уже начат): список/запрос не `""`, ACL write, `tasks/stub-columns.md`, D4 = принято as-is.
6. **T06** — закрыть вопросы в `unlock-a3-doc-signed.md` дефолтами плана; UI А3 через ACL (если дыра — закрыть).
7. **T07** — `tasks/storekeeper-vs-supply.md`; ACL guards на `ФормаСнабжение`.
8. **T08** — Phase A = вариант C (без справочника ТС); required только UI/смена статуса; `tasks/vehicle-autofill-required.md`.

### C. P2 без тяжёлого кода
9. **T09** — dropdown 6 ед.изм. для `ЕдиницаИзмеренияКлиента`; обновить `units-of-measure.md`; D5 = принято as-is.
10. **T10** Phase A only → `tasks/returns-e2e.md` (без кода).
11. **T11** Phase A only → `tasks/print-notify-scope.md` (без кода).
12. **T12a** docs only → `tasks/test-arm-accounts.md` (без паролей) + **anti-prod** в `seed-1c.ps1` если нет.
13. **T12b** docs only → `tasks/seed-process-step3.md`.
14. **T04** draft → `process.html` устаревшие code + `tasks/process-cov-refresh.md`.

### D. Регрессия и публикация в git
15. Снова `python tools/test_arm_matrix_rights.py` (+ точечные asserts на новые поля, если ломают map).
16. Пересобрать `.cfe` / diff / дополнить patch-notes (секции T05–T09).
17. `git add` (без `*-report_*.log`, без local credentials) → commit → `git push origin fix/open-tasks`.
18. Короткий `tasks/autonomous-done.md`: что сделано / что ждёт утром (T00, merge).

---

## Критерий «можно спать спокойно»

- [x] Тесты ACL green  
- [x] `.cfe` v2.11 на диске + diff + patch-notes актуальны  
- [x] T05–T09 в коде/доках по минимуму плана  
- [x] T04, T10–T12 docs  
- [x] План статусов обновлён  
- [x] Push на `origin/fix/open-tasks`  
- [x] Явный список «утром только UI + merge» → [autonomous-done.md](autonomous-done.md)

## Stop даже в автономии

process-api · merge basdev/master/dev · force push · seed/LoadCfg без test IbDir · пароли в git · T13.

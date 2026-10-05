# T13 — Механик (только D6=да)

---

## PROMPT

```
ОБЩИЕ ПРАВИЛА (vitauto1c / fix/open-tasks):
- Репо: C:\Users\Pavel\Desktop\vitauto1c.
- Не process-api. Не merge в dev/master/basdev без ок. Не force push.
- Не LoadCfg на боевую. Коммит/push только по просьбе.

ЗАДАЧА T13.

ГЕЙТ: в tasks/impl-plan-matrix-arm.md D6 = «принято: да» ИЛИ сообщение владельца явно «D6=да, делай механика».
Иначе НЕМЕДЛЕННЫЙ STOP: «T13 заблокирован D6». Ветку fix/mechanic не создавать.

Фаза A (при D6=да):
1. tasks/mechanic-scope.md — MVP узлы G*, связь с chief_mechanic, объекты УНФ, non-goals, оценка.
2. STOP до ок на MVP.

Фаза B («внедряй T13 B»):
3. Код + ACL (T01) + CFE + чеклист одного сценария на test.

Критерий A: md+ок. Критерий B: сценарий на test.
```

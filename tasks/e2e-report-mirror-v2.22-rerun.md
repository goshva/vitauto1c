# Сквозные сценарии АРМ через OData (seed E2E)

2026-10-18 09:15 UTC, http://127.0.0.1:8090/mirror/odata/standard.odata.
Покупатель E2E Покупатель; поставщики E2E Поставщик Альфа, E2E Поставщик Бета.

| Сценарий | Итог | Шагов | Заказы | Номенклатура | Документы | Ошибка |
|---|---|---|---|---|---|---|
| stock | OK | 16 | НФНФ-000370 | E2E Фильтр масляный (без НДС) | РасходнаяНакладная НФНФ-000118 |  |
| m03_stock_vat | OK | 27 | НФНФ-000371 | E2E Фильтр масляный (без НДС); E2E Книга по ТО (НДС 10%) | РасходнаяНакладная НФНФ-000119 |  |
| m23_prepared | OK | 8 | НФНФ-000372 | E2E Фильтр масляный (без НДС) |  |  |

## stock — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000370 |
| N1,M1 | строки заказа в АРМ | OK | строк 1 |
| M2 | manager: PATCH Номенклатура | OK | 200 |
| M2 | manager: PATCH Количество | OK | 200 |
| M2 | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| M2 | manager: PATCH Коэффициент | OK | 200 |
| M2 | manager: PATCH Поставщик | OK | 200 |
| M3 | manager: transition sales → reserve | OK | → reserve (200) |
| M9 | manager: transition sales → assembly | OK | → assembly (200) |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-18 ОТГ-01804 |
| K5 | manager: «В работе» (команда ВРаботе) | OK | задание done → shipped |
| K5 | расходная накладная | OK | НФНФ-000118 |
| M15 | manager: PATCH ДокументПодписанОригинал | OK | 200 |
| M15,K7 | manager: transition sales → closed | OK | → closed (200) |

## m03_stock_vat — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000371 |
| N1,M1 | строки заказа в АРМ | OK | строк 2 |
| M2 | manager: PATCH Номенклатура | OK | 200 |
| M2 | manager: PATCH Количество | OK | 200 |
| M2 | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| M2 | manager: PATCH Коэффициент | OK | 200 |
| M2 | manager: PATCH Поставщик | OK | 200 |
| M2 | manager: PATCH Номенклатура | OK | 200 |
| M2 | manager: PATCH Количество | OK | 200 |
| M2 | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| M2 | manager: PATCH Коэффициент | OK | 200 |
| M2 | manager: PATCH Поставщик | OK | 200 |
| M3 | manager: transition sales → reserve | OK | → reserve (200) |
| M9 | manager: transition sales → assembly | OK | → assembly (200) |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| M3 | manager: transition sales → reserve | OK | → reserve (200) |
| M9 | manager: transition sales → assembly | OK | → assembly (200) |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 2 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-18 ОТГ-02786 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-18 ОТГ-02786 |
| K5 | manager: «В работе» (команда ВРаботе) | OK | задание done → shipped, shipped |
| K5 | расходная накладная | OK | НФНФ-000119 |
| K5 | расходная накладная | OK | НФНФ-000119 |
| M15 | manager: PATCH ДокументПодписанОригинал | OK | 200 |
| M15 | manager: PATCH ДокументПодписанОригинал | OK | 200 |
| M15,K7 | manager: transition sales → closed | OK | → closed, closed (200) |

## m23_prepared — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000372 |
| N1,M1 | строки заказа в АРМ | OK | строк 1 |
| M2 | manager: PATCH Номенклатура | OK | 200 |
| M2 | manager: PATCH Количество | OK | 200 |
| M2 | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| M2 | manager: PATCH Коэффициент | OK | 200 |
| M2 | manager: PATCH Поставщик | OK | 200 |
| M | «Подготовлено» | OK | 200 → ready_to_ship |

# Сквозные сценарии АРМ через OData (seed E2E)

2026-10-15 18:15 UTC, http://127.0.0.1:8090/e2e/odata/standard.odata.
Покупатель E2E Покупатель; поставщики E2E Поставщик Альфа, E2E Поставщик Бета.

| Сценарий | Итог | Шагов | Заказы | Номенклатура | Документы | Ошибка |
|---|---|---|---|---|---|---|
| happy | OK | 28 | НФНФ-000005 | E2E Колодки тормозные (НДС общая) | ЗаказПоставщику НФНФ-000003; ПриходнаяНакладная НФНФ-000004; РасходнаяНакладная НФНФ-000001 |  |
| stock | OK | 16 | НФНФ-000006 | E2E Фильтр масляный (без НДС) | РасходнаяНакладная НФНФ-000002 |  |
| mixed_order | OK | 39 | НФНФ-000007 | E2E Книга по ТО (НДС 10%); E2E Колодки тормозные (НДС общая) | ЗаказПоставщику НФНФ-000004; ПриходнаяНакладная НФНФ-000005; РасходнаяНакладная НФНФ-000004; РасходнаяНакладная НФНФ-000003 |  |

## happy — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000005 |
| N1,M1 | строки заказа в АРМ | OK | строк 1 |
| M2 | manager: PATCH Номенклатура | OK | 200 |
| M2 | manager: PATCH Количество | OK | 200 |
| M2 | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| M2 | manager: PATCH Коэффициент | OK | 200 |
| M2 | manager: PATCH Поставщик | OK | 200 |
| M4 | manager: строка закупки | OK | 201 |
| M4 | manager: PATCH Количество | OK | 200 |
| M4 | manager: PATCH Поставщик | OK | 200 |
| M4 | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| M4 | manager: PATCH Цена | OK | 200 |
| M4 | manager: «В работе» (команда ВРаботе) | OK | задание done → ordered |
| M4 | заказ поставщику по закупке | OK | НФНФ-000003 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P2 | supply: статус снабжения in_transit | OK | → in_transit (200) |
| K1 | supply: статус снабжения acceptance | OK | → acceptance (200) |
| K2 | supply: статус снабжения to_stock | OK | → to_stock (200) |
| M9 | supply: статус снабжения assembly | OK | → assembly (200) |
| K3 | supply: статус снабжения assembled | OK | → ready_to_ship (200) |
| — | продажа идёт за закупкой | OK | ready_to_ship |
| K3 | приходная накладная по закупке | OK | НФНФ-000004, проведена true |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-15 ОТГ-01228 |
| K5 | manager: «В работе» (команда ВРаботе) | OK | задание done → shipped |
| K5 | расходная накладная | OK | НФНФ-000001 |
| M15 | manager: PATCH ДокументПодписанОригинал | OK | 200 |
| M15,K7 | manager: transition sales → closed | OK | → closed (200) |

## stock — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000006 |
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
| M12 | дата и номер отгрузки в строке | OK | 2026-10-15 ОТГ-02471 |
| K5 | manager: «В работе» (команда ВРаботе) | OK | задание done → shipped |
| K5 | расходная накладная | OK | НФНФ-000002 |
| M15 | manager: PATCH ДокументПодписанОригинал | OK | 200 |
| M15,K7 | manager: transition sales → closed | OK | → closed (200) |

## mixed_order — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000007 |
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
| M4 | manager: строка закупки | OK | 201 |
| M4 | manager: PATCH Количество | OK | 200 |
| M4 | manager: PATCH Поставщик | OK | 200 |
| M4 | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| M4 | manager: PATCH Цена | OK | 200 |
| M4 | manager: «В работе» (команда ВРаботе) | OK | задание done → ordered |
| M4 | заказ поставщику по закупке | OK | НФНФ-000004 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P2 | supply: статус снабжения in_transit | OK | → in_transit (200) |
| K1 | supply: статус снабжения acceptance | OK | → acceptance (200) |
| K2 | supply: статус снабжения to_stock | OK | → to_stock (200) |
| — | продажа идёт за закупкой | OK | to_stock |
| M9 | manager: transition sales → assembly | OK | → assembly (200) |
| M9 | supply: статус снабжения assembly | OK | → assembly (200) |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| K3 | supply: статус снабжения assembled | OK | → ready_to_ship (200) |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-15 ОТГ-03941 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-15 ОТГ-03941 |
| K5 | manager: «В работе» (команда ВРаботе) | OK | задание done → shipped, shipped |
| K5 | расходная накладная | OK | НФНФ-000004 |
| K5 | расходная накладная | OK | НФНФ-000003 |
| M15 | manager: PATCH ДокументПодписанОригинал | OK | 200 |
| M15 | manager: PATCH ДокументПодписанОригинал | OK | 200 |
| M15,K7 | manager: transition sales → closed | OK | → closed, closed (200) |

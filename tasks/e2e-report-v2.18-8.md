# Сквозные сценарии АРМ через OData (seed E2E)

2026-10-15 18:47 UTC, http://127.0.0.1:8090/e2e/odata/standard.odata.
Покупатель E2E Покупатель; поставщики E2E Поставщик Альфа, E2E Поставщик Бета.

| Сценарий | Итог | Шагов | Заказы | Номенклатура | Документы | Ошибка |
|---|---|---|---|---|---|---|
| delivery_split | OK | 27 | НФНФ-000009 | E2E Колодки тормозные (НДС общая) | ЗаказПоставщику НФНФ-000005 |  |
| virtual_buy | OK | 17 | НФНФ-000010 | E2E Колодки тормозные (НДС общая) | ЗаказПоставщику НФНФ-000006 |  |
| defect | OK | 20 | НФНФ-000011 | E2E Фильтр масляный (без НДС) | РасходнаяНакладная НФНФ-000005 |  |
| cancel_supplier | OK | 19 | НФНФ-000012 | E2E Колодки тормозные (НДС общая) | ЗаказПоставщику НФНФ-000007 |  |
| return | OK | 20 | НФНФ-000013 | E2E Фильтр масляный (без НДС) | РасходнаяНакладная НФНФ-000006 |  |
| return_mgr | OK | 24 | НФНФ-000014 | E2E Колодки тормозные (НДС общая) | ЗаказПоставщику НФНФ-000008 |  |
| return_internal | OK | 20 | НФНФ-000015 | E2E Книга по ТО (НДС 10%) | РасходнаяНакладная НФНФ-000007 |  |
| car_repair_in | OK | 32 | НФНФ-000016 | E2E Книга по ТО (НДС 10%); E2E Колодки тормозные (НДС общая) | ЗаказПоставщику НФНФ-000009 |  |

## delivery_split — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000009 |
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
| M4 | заказ поставщику по закупке | OK | НФНФ-000005 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| — | продажа идёт за закупкой | OK | paid |
| N4 | manager: transition purchases → shipped | OK | → shipped (200) |
| N4 | продажа вместе с закупкой | OK | → shipped |
| M17 | manager: PATCH КомментарийКСтроке | OK | 200 |
| K9 | storekeeper: PATCH КомментарийКСтроке | OK | 200 |
| K1 | storekeeper: transition purchases → acceptance | OK | → acceptance (200) |
| K1 | продажа вместе с закупкой | OK | → acceptance |
| M9 | manager: transition sales → assembly | OK | → assembly (200) |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-15 ОТГ-01189 |
| M15,K7 | manager: transition sales → closed | OK | → closed (200) |

## virtual_buy — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000010 |
| N1,M1 | строки заказа в АРМ | OK | строк 1 |
| M2 | manager: PATCH Номенклатура | OK | 200 |
| M2 | manager: PATCH Количество | OK | 200 |
| M2 | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| M2 | manager: PATCH Коэффициент | OK | 200 |
| M2 | manager: PATCH Поставщик | OK | 200 |
| M13 | manager: строка закупки | OK | 201 |
| M13 | manager: PATCH Количество | OK | 200 |
| M13 | manager: PATCH Поставщик | OK | 200 |
| M13 | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| M13 | manager: PATCH Цена | OK | 200 |
| M13 | manager: «В работе» (команда ВРаботе) | OK | задание done → ordered |
| M13 | заказ поставщику по закупке | OK | НФНФ-000006 |
| M13 | manager: PATCH Количество в «Заказано» → 403 (матрица) | OK | 403 matrix_denied: матрица: нельзя в статусе «ordered» |
| A3 | admin: PATCH Количество | OK | 200 |
| A3 | admin: статус снабжения paid | OK | → paid (200) |

## defect — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000011 |
| N1,M1 | строки заказа в АРМ | OK | строк 1 |
| M2 | manager: PATCH Номенклатура | OK | 200 |
| M2 | manager: PATCH Количество | OK | 200 |
| M2 | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| M2 | manager: PATCH Коэффициент | OK | 200 |
| M2 | manager: PATCH Поставщик | OK | 200 |
| M3 | manager: transition sales → reserve | OK | → reserve (200) |
| M9 | manager: transition sales → assembly | OK | → assembly (200) |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| M10 | manager: PATCH КомментарийКСтроке | OK | 200 |
| M10 | manager: transition sales → assembly | OK | → assembly (200) |
| K8 | storekeeper: PATCH КомментарийКСтроке | OK | 200 |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-15 ОТГ-03349 |
| K5 | manager: «В работе» (команда ВРаботе) | OK | задание done → shipped |
| K5 | расходная накладная | OK | НФНФ-000005 |
| M15 | manager: PATCH ДокументПодписанОригинал | OK | 200 |
| M15,K7 | manager: transition sales → closed | OK | → closed (200) |

## cancel_supplier — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000012 |
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
| M4 | заказ поставщику по закупке | OK | НФНФ-000007 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| — | продажа идёт за закупкой | OK | paid |
| M15 | manager: PATCH КомментарийКСтроке | OK | 200 |
| M16 | manager: transition purchases → return | OK | → return (200) |
| M16 | продажа вместе с закупкой | OK | → return |

## return — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000013 |
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
| M12 | дата и номер отгрузки в строке | OK | 2026-10-15 ОТГ-05321 |
| K5 | manager: «В работе» (команда ВРаботе) | OK | задание done → shipped |
| N3 | manager: transition sales → return | OK | → return (200) |
| K6 | storekeeper: PATCH КомментарийКСтроке | OK | 200 |
| M19 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M19 | дата и номер отгрузки в строке | OK | 2026-10-15 КОР-05321 |
| M16 | manager: PATCH КомментарийКСтроке | OK | 200 |
| K6 | storekeeper: PATCH КомментарийКСтроке | OK | 200 |
| P3 | строка в «Возврат» | OK | → return |

## return_mgr — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000014 |
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
| M4 | заказ поставщику по закупке | OK | НФНФ-000008 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P2 | supply: статус снабжения in_transit | OK | → in_transit (200) |
| K1 | supply: статус снабжения acceptance | OK | → acceptance (200) |
| K2 | supply: статус снабжения to_stock | OK | → to_stock (200) |
| — | продажа идёт за закупкой | OK | to_stock |
| M16 | manager: transition purchases → return | OK | → return (200) |
| M16 | продажа вместе с закупкой | OK | → return |
| K6 | storekeeper: PATCH КомментарийКСтроке | OK | 200 |
| M15,K7 | manager: transition purchases → closed | OK | → closed (200) |
| M15,K7 | продажа вместе с закупкой | OK | → closed |

## return_internal — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000015 |
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
| M12 | дата и номер отгрузки в строке | OK | 2026-10-15 ОТГ-07795 |
| K5 | manager: «В работе» (команда ВРаботе) | OK | задание done → shipped |
| N3 | manager: transition sales → return | OK | → return (200) |
| K6 | storekeeper: PATCH КомментарийКСтроке | OK | 200 |
| M10 | manager: transition sales → assembly | OK | → assembly (200) |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-15 ОТГ2-07795 |
| M15,K7 | manager: transition sales → closed | OK | → closed (200) |

## car_repair_in — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,G1 | mechanic: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000016 |
| N1,G1 | строки заказа в АРМ | OK | строк 2 |
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
| M4 | заказ поставщику по закупке | OK | НФНФ-000009 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P2 | supply: статус снабжения in_transit | OK | → in_transit (200) |
| K1 | supply: статус снабжения acceptance | OK | → acceptance (200) |
| K2 | supply: статус снабжения to_stock | OK | → to_stock (200) |
| — | продажа идёт за закупкой | OK | to_stock |
| M9 | manager: transition sales → assembly | OK | → assembly (200) |
| M9 | supply: статус снабжения assembly | OK | → assembly (200) |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| K3 | supply: статус снабжения assembled | OK | → ready_to_ship (200) |
| G3 | mechanic: transition sales → assembly | OK | → assembly, assembly (200) |
| G4 | mechanic: PATCH КоличествоНормаЧас | OK | 200 |
| G9 | mechanic: transition sales → closed | OK | → closed, closed (200) |

> **Зеркало прода** `localhost\vitauto_mirror` (PostgreSQL 18, «Автосервис» 3.0.11.169, данные дампа 16.10.2026),
> АРМ **v2.21**, загружен `odata/update-arm-ext.ps1` (цикл v2.15 → v2.21 → откат → v2.21 — без ошибок).
> Подготовка: номенклатура seed через OData (`seed-nomenclature-odata.mjs`), пользователи arm.* и seed (`seed-e2e.js`).
> Новое в v2.21: шаг «заказ покупателя: Сумма = Количество × Цена» после заказа поставщику — во всех сценариях OK
> (до v2.21 строки заказа покупателя писались с Сумма = 0). Тот же прогон на файловой базе — `tasks/e2e-report-v2.21.md`, 11/11.
> После прогона зеркало возвращено в состояние прода (`reset-mirror.ps1`).

# Сквозные сценарии АРМ через OData (seed E2E)

2026-10-17 16:53 UTC, http://127.0.0.1:8090/mirror/odata/standard.odata.
Покупатель E2E Покупатель; поставщики E2E Поставщик Альфа, E2E Поставщик Бета.

| Сценарий | Итог | Шагов | Заказы | Номенклатура | Документы | Ошибка |
|---|---|---|---|---|---|---|
| happy | OK | 29 | НФНФ-000002 | E2E Колодки тормозные (НДС общая) | ЗаказПоставщику НФНФ-000001; ПриходнаяНакладная НФНФ-000002; РасходнаяНакладная НФНФ-000001 |  |
| stock | OK | 16 | НФНФ-000003 | E2E Фильтр масляный (без НДС) | РасходнаяНакладная НФНФ-000002 |  |
| mixed_order | OK | 40 | НФНФ-000004 | E2E Книга по ТО (НДС 10%); E2E Колодки тормозные (НДС общая) | ЗаказПоставщику НФНФ-000002; ПриходнаяНакладная НФНФ-000003; РасходнаяНакладная НФНФ-000004; РасходнаяНакладная НФНФ-000003 |  |
| delivery_split | OK | 28 | НФНФ-000006 | E2E Колодки тормозные (НДС общая) | ЗаказПоставщику НФНФ-000003 |  |
| virtual_buy | OK | 18 | НФНФ-000007 | E2E Колодки тормозные (НДС общая) | ЗаказПоставщику НФНФ-000004 |  |
| defect | OK | 20 | НФНФ-000008 | E2E Фильтр масляный (без НДС) | РасходнаяНакладная НФНФ-000005 |  |
| cancel_supplier | OK | 20 | НФНФ-000009 | E2E Колодки тормозные (НДС общая) | ЗаказПоставщику НФНФ-000005 |  |
| return | OK | 20 | НФНФ-000010 | E2E Фильтр масляный (без НДС) | РасходнаяНакладная НФНФ-000006 |  |
| return_mgr | OK | 25 | НФНФ-000011 | E2E Колодки тормозные (НДС общая) | ЗаказПоставщику НФНФ-000006 |  |
| return_internal | OK | 20 | НФНФ-000012 | E2E Книга по ТО (НДС 10%) | РасходнаяНакладная НФНФ-000007 |  |
| car_repair_in | OK | 33 | НФНФ-000013 | E2E Книга по ТО (НДС 10%); E2E Колодки тормозные (НДС общая) | ЗаказПоставщику НФНФ-000007 |  |

## happy — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000002 |
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
| M4 | заказ поставщику по закупке | OK | НФНФ-000001 |
| M4 | заказ покупателя: Сумма = Количество × Цена | OK | 200, строк 1: 1×1560=1560 (НДС 281.31, всего 1560) |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P2 | supply: статус снабжения in_transit | OK | → in_transit (200) |
| K1 | supply: статус снабжения acceptance | OK | → acceptance (200) |
| K2 | supply: статус снабжения to_stock | OK | → to_stock (200) |
| M9 | supply: статус снабжения assembly | OK | → assembly (200) |
| K3 | supply: статус снабжения assembled | OK | → ready_to_ship (200) |
| — | продажа идёт за закупкой | OK | ready_to_ship |
| K3 | приходная накладная по закупке | OK | НФНФ-000002, проведена true |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-17 ОТГ-01357 |
| K5 | manager: «В работе» (команда ВРаботе) | OK | задание done → shipped |
| K5 | расходная накладная | OK | НФНФ-000001 |
| M15 | manager: PATCH ДокументПодписанОригинал | OK | 200 |
| M15,K7 | manager: transition sales → closed | OK | → closed (200) |

## stock — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000003 |
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
| M12 | дата и номер отгрузки в строке | OK | 2026-10-17 ОТГ-02658 |
| K5 | manager: «В работе» (команда ВРаботе) | OK | задание done → shipped |
| K5 | расходная накладная | OK | НФНФ-000002 |
| M15 | manager: PATCH ДокументПодписанОригинал | OK | 200 |
| M15,K7 | manager: transition sales → closed | OK | → closed (200) |

## mixed_order — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000004 |
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
| M4 | заказ поставщику по закупке | OK | НФНФ-000002 |
| M4 | заказ покупателя: Сумма = Количество × Цена | OK | 200, строк 1: 1×1625=1625 (НДС 293.03, всего 1625) |
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
| M12 | дата и номер отгрузки в строке | OK | 2026-10-17 ОТГ-03839 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-17 ОТГ-03839 |
| K5 | manager: «В работе» (команда ВРаботе) | OK | задание done → shipped, shipped |
| K5 | расходная накладная | OK | НФНФ-000004 |
| K5 | расходная накладная | OK | НФНФ-000003 |
| M15 | manager: PATCH ДокументПодписанОригинал | OK | 200 |
| M15 | manager: PATCH ДокументПодписанОригинал | OK | 200 |
| M15,K7 | manager: transition sales → closed | OK | → closed, closed (200) |

## delivery_split — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000006 |
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
| M4 | заказ покупателя: Сумма = Количество × Цена | OK | 200, строк 1: 1×1560=1560 (НДС 281.31, всего 1560) |
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
| M12 | дата и номер отгрузки в строке | OK | 2026-10-17 ОТГ-04968 |
| M15,K7 | manager: transition sales → closed | OK | → closed (200) |

## virtual_buy — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000007 |
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
| M13 | заказ поставщику по закупке | OK | НФНФ-000004 |
| M13 | заказ покупателя: Сумма = Количество × Цена | OK | 200, строк 1: 1×1560=1560 (НДС 281.31, всего 1560) |
| M13 | manager: PATCH Количество в «Заказано» → 403 (матрица) | OK | 403 matrix_denied: матрица: нельзя в статусе «ordered» |
| A3 | admin: PATCH Количество | OK | 200 |
| A3 | admin: статус снабжения paid | OK | → paid (200) |

## defect — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000008 |
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
| M12 | дата и номер отгрузки в строке | OK | 2026-10-17 ОТГ-06402 |
| K5 | manager: «В работе» (команда ВРаботе) | OK | задание done → shipped |
| K5 | расходная накладная | OK | НФНФ-000005 |
| M15 | manager: PATCH ДокументПодписанОригинал | OK | 200 |
| M15,K7 | manager: transition sales → closed | OK | → closed (200) |

## cancel_supplier — OK

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
| M4 | заказ покупателя: Сумма = Количество × Цена | OK | 200, строк 1: 1×1625=1625 (НДС 293.03, всего 1625) |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| — | продажа идёт за закупкой | OK | paid |
| M15 | manager: PATCH КомментарийКСтроке | OK | 200 |
| M16 | manager: transition purchases → return | OK | → return (200) |
| M16 | продажа вместе с закупкой | OK | → return |

## return — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000010 |
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
| M12 | дата и номер отгрузки в строке | OK | 2026-10-17 ОТГ-08143 |
| K5 | manager: «В работе» (команда ВРаботе) | OK | задание done → shipped |
| N3 | manager: transition sales → return | OK | → return (200) |
| K6 | storekeeper: PATCH КомментарийКСтроке | OK | 200 |
| M19 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M19 | дата и номер отгрузки в строке | OK | 2026-10-17 КОР-08143 |
| M16 | manager: PATCH КомментарийКСтроке | OK | 200 |
| K6 | storekeeper: PATCH КомментарийКСтроке | OK | 200 |
| P3 | строка в «Возврат» | OK | → return |

## return_mgr — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000011 |
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
| M4 | заказ поставщику по закупке | OK | НФНФ-000006 |
| M4 | заказ покупателя: Сумма = Количество × Цена | OK | 200, строк 1: 1×1560=1560 (НДС 281.31, всего 1560) |
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
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000012 |
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
| M12 | дата и номер отгрузки в строке | OK | 2026-10-17 ОТГ-10425 |
| K5 | manager: «В работе» (команда ВРаботе) | OK | задание done → shipped |
| N3 | manager: transition sales → return | OK | → return (200) |
| K6 | storekeeper: PATCH КомментарийКСтроке | OK | 200 |
| M10 | manager: transition sales → assembly | OK | → assembly (200) |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-17 ОТГ2-10425 |
| M15,K7 | manager: transition sales → closed | OK | → closed (200) |

## car_repair_in — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,G1 | mechanic: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000013 |
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
| M4 | заказ поставщику по закупке | OK | НФНФ-000007 |
| M4 | заказ покупателя: Сумма = Количество × Цена | OK | 200, строк 1: 1×1625=1625 (НДС 293.03, всего 1625) |
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

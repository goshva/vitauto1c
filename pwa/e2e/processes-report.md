# Процессы process.html через OData — сквозной прогон

2026-10-13 07:19, http://127.0.0.1:8090/odata215/odata/standard.odata; заказчик АВД, поставщик Алексей, номенклатура Антифриз P900RM12.
Бэкенд PWA `src/odata/backend.js` (OData + команды АРМ_OData v1.1); роли — пользователи arm.* с ролью АРМ из `Арм_ПраваПользователей`, права полей — матрица `index.html` (`src/odata/matrix.json`).

## Сценарии

| Сценарий | Итог | Шагов | Заказы | Ошибка |
|---|---|---|---|---|
| happy | **FAIL** | 28 | НФНФ-000043 | K5: manager: «В работе» (команда ВРаботе) — задание failed Процесс прерван: Ошибка проведения Заказа Покупателя Заказ покупателя 43 от 13.10.2026 : Нельзя записать заказ: новое состояние заказа "" не принадлежит виду заказа "Основной". → ready_to_ship |
| stock | **FAIL** | 38 | НФНФ-000044, НФНФ-000045 | K5: manager: «В работе» (команда ВРаботе) — задание failed Процесс прерван: Ошибка проведения Заказа Покупателя Заказ покупателя 45 от 13.10.2026 : Нельзя записать заказ: новое состояние заказа "" не принадлежит виду заказа "Основной". → ready_to_ship |
| mixed_order | **FAIL** | 61 | НФНФ-000046, НФНФ-000047 | K5: manager: «В работе» (команда ВРаботе) — задание failed Процесс прерван: Ошибка проведения Заказа Покупателя Заказ покупателя 47 от 13.10.2026 : Нельзя записать заказ: новое состояние заказа "" не принадлежит виду заказа "Основной". → ready_to_ship, ready_to_ship |
| delivery_split | OK | 31 | НФНФ-000049 |  |
| virtual_buy | OK | 17 | НФНФ-000050 |  |
| defect | **FAIL** | 42 | НФНФ-000051, НФНФ-000052 | K5: manager: «В работе» (команда ВРаботе) — задание failed Процесс прерван: Ошибка проведения Заказа Покупателя Заказ покупателя 52 от 13.10.2026 : Нельзя записать заказ: новое состояние заказа "" не принадлежит виду заказа "Основной". → ready_to_ship |
| cancel_supplier | OK | 21 | НФНФ-000053 |  |
| return | **FAIL** | 38 | НФНФ-000054, НФНФ-000055 | K5: manager: «В работе» (команда ВРаботе) — задание failed Процесс прерван: Ошибка проведения Заказа Покупателя Заказ покупателя 55 от 13.10.2026 : Нельзя записать заказ: новое состояние заказа "" не принадлежит виду заказа "Основной". → ready_to_ship |
| return_mgr | OK | 27 | НФНФ-000056 |  |
| return_internal | **FAIL** | 38 | НФНФ-000057, НФНФ-000058 | K5: manager: «В работе» (команда ВРаботе) — задание failed Процесс прерван: Ошибка проведения Заказа Покупателя Заказ покупателя 58 от 13.10.2026 : Нельзя записать заказ: новое состояние заказа "" не принадлежит виду заказа "Основной". → ready_to_ship |
| car_repair_in | OK | 36 | НФНФ-000059 |  |

## Узлы схемы

| Узел | Проверок OK | Ошибок | Вне учёта (уведомления, действия вне 1С) | Сценарии |
|---|---|---|---|---|
| A3 | 2 | 0 | 0 | virtual_buy |
| G1 | 2 | 0 | 0 | car_repair_in |
| G3 | 1 | 0 | 0 | car_repair_in |
| G4 | 1 | 0 | 0 | car_repair_in |
| G5 | 0 | 0 | 1 | car_repair_in |
| G9 | 1 | 0 | 0 | car_repair_in |
| K1 | 11 | 0 | 0 | happy, stock, mixed_order, delivery_split, defect, return, return_mgr, return_internal, car_repair_in |
| K2 | 9 | 0 | 1 | happy, stock, mixed_order, delivery_split, defect, return, return_mgr, return_internal, car_repair_in |
| K3 | 17 | 0 | 0 | happy, stock, mixed_order, delivery_split, defect, return, return_internal, car_repair_in |
| K5 | 0 | 6 | 0 | happy, stock, mixed_order, defect, return, return_internal |
| K6 | 1 | 0 | 0 | return_mgr |
| K7 | 3 | 0 | 0 | delivery_split, return_mgr |
| K8 | 1 | 0 | 0 | defect |
| K9 | 1 | 0 | 0 | delivery_split |
| M1 | 20 | 0 | 0 | happy, stock, mixed_order, delivery_split, virtual_buy, defect, cancel_supplier, return, return_mgr, return_internal |
| M10 | 2 | 0 | 0 | defect |
| M11 | 0 | 0 | 8 | happy, stock, mixed_order, delivery_split, defect, return, return_internal, car_repair_in |
| M12 | 16 | 0 | 0 | happy, stock, mixed_order, delivery_split, defect, return, return_internal |
| M13 | 8 | 0 | 0 | virtual_buy |
| M15 | 4 | 0 | 0 | delivery_split, cancel_supplier, return_mgr |
| M16 | 4 | 0 | 0 | cancel_supplier, return_mgr |
| M17 | 1 | 0 | 0 | delivery_split |
| M2 | 65 | 0 | 0 | happy, stock, mixed_order, delivery_split, virtual_buy, defect, cancel_supplier, return, return_mgr, return_internal, car_repair_in |
| M3 | 6 | 0 | 0 | stock, mixed_order, defect, return, return_internal, car_repair_in |
| M4 | 42 | 0 | 0 | happy, mixed_order, delivery_split, cancel_supplier, return_mgr, car_repair_in |
| M7 | 11 | 0 | 0 | happy, stock, mixed_order, delivery_split, defect, cancel_supplier, return, return_mgr, return_internal, car_repair_in |
| M8 | 0 | 0 | 10 | happy, stock, mixed_order, delivery_split, defect, return, return_mgr, return_internal, car_repair_in |
| M9 | 15 | 0 | 0 | happy, stock, mixed_order, delivery_split, defect, return, return_internal, car_repair_in |
| N1 | 22 | 0 | 0 | happy, stock, mixed_order, delivery_split, virtual_buy, defect, cancel_supplier, return, return_mgr, return_internal, car_repair_in |
| N4 | 2 | 0 | 0 | delivery_split |
| P1 | 0 | 0 | 11 | happy, stock, mixed_order, delivery_split, defect, cancel_supplier, return, return_mgr, return_internal, car_repair_in |
| P2 | 9 | 0 | 0 | happy, stock, mixed_order, defect, return, return_mgr, return_internal, car_repair_in |
| P3 | 0 | 0 | 2 | cancel_supplier, return_mgr |
| пред. | 75 | 0 | 0 | stock, mixed_order, defect, return, return_internal |
| — | 11 | 0 | 0 | happy, stock, mixed_order, delivery_split, defect, cancel_supplier, return, return_mgr, return_internal, car_repair_in |

## Все узлы process.html (45)

cov — покрытие по схеме (yes/part/no); итог — по этому прогону.

| Узел | Роль | Узел схемы | cov | Итог | Что выполнено |
|---|---|---|---|---|---|
| N1 | client | Заявка: Excel / фото | part | OK через OData | manager: импорт листа клиента (команда СоздатьЗаказ); строки заказа в АРМ; mechanic: импорт листа клиента (команда СоздатьЗаказ) |
| N2a | client | Получение товара | part | нет в сценариях |  |
| N3 | client | Возврат товара | part | нет в сценариях |  |
| N4 | client | Самовывоз у внешнего поставщика | no | OK через OData | manager: transition purchases → shipped; продажа вместе с закупкой |
| M1 | manager | Загрузка заявки в 1С | part | OK через OData | manager: импорт листа клиента (команда СоздатьЗаказ); строки заказа в АРМ |
| M2 | manager | Поиск + подбор номенклатуры | no | OK через OData | manager: PATCH Номенклатура; manager: PATCH Количество; manager: PATCH СебестоимостьЕдиницы; manager: PATCH Коэффициент; manager: PATCH Поставщик |
| M2a | manager | Создание номенклатуры | no | нет в сценариях |  |
| M3 | manager | Резервирование на складе | part | OK через OData | manager: transition sales → reserve |
| M4 | manager | Заказ поставщику | ok | OK через OData | manager: строка закупки; manager: PATCH Количество; manager: PATCH Поставщик; manager: PATCH СебестоимостьЕдиницы; manager: PATCH Цена; manager: «В работе» (команда ВРаботе) |
| M7 | manager | Контроль оплаты | ok | OK через OData | supply: статус снабжения paid |
| M8 | manager | Уведомление о приходе | part | вне учёта 1С | уведомление о приходе |
| M9 | manager | Задание на комплектацию | part | OK через OData | supply: статус снабжения assembly; manager: transition sales → assembly |
| M10 | manager | Контроль комплектации | part | OK через OData | manager: PATCH КомментарийКСтроке; manager: transition sales → assembly |
| M11 | manager | Уведомление о готовности | no | вне учёта 1С | уведомление о готовности |
| M12 | manager | Отгрузочная ведомость | no | OK через OData | manager: отгрузка (дата и номер); дата и номер отгрузки в строке |
| M13 | manager | Недостаточно прав, обратись к админу | no | OK через OData | manager: строка закупки; manager: PATCH Количество; manager: PATCH Поставщик; manager: PATCH СебестоимостьЕдиницы; manager: PATCH Цена; manager: «В работе» (команда ВРаботе) |
| M15 | manager | Контроль документов | part | OK через OData | manager: transition sales → closed; manager: PATCH КомментарийКСтроке; manager: transition purchases → closed; продажа вместе с закупкой |
| M16 | manager | Заявка на возврат поставщику | no | OK через OData | manager: transition purchases → return; продажа вместе с закупкой |
| M17 | manager | Уведомление о самовывозе | no | OK через OData | manager: PATCH КомментарийКСтроке |
| M18 | manager | Неопознанная позиция | no | нет в сценариях |  |
| M19 | manager | Отгрузочная ведомость (корректировка) | no | нет в сценариях |  |
| A1 | admin | Неопознанные + фото | no | нет в сценариях |  |
| A2 | admin | Создание номенклатуры/подтверждение/изменение позиции | no | нет в сценариях |  |
| A3 | admin | Подтверждение чека админом | no | OK через OData | admin: PATCH Количество; admin: статус снабжения paid |
| A5 | admin | Приход с разбора / ЗН | no | нет в сценариях |  |
| A0 | admin | НСИ: РРЦ / НМЦК / права | no | нет в сценариях |  |
| P1 | supplier | Обработка заказа | no | вне учёта 1С | поставщик обработал заказ |
| P2 | supplier | Отгрузка → В пути | part | OK через OData | supply: статус снабжения in_transit |
| P3 | supplier | Приём возврата | no | вне учёта 1С | поставщик закрыл заказ; поставщик принял возврат |
| K1 | storekeeper | Приёмка (УПД) | part | OK через OData | supply: статус снабжения acceptance; storekeeper: transition purchases → acceptance; продажа вместе с закупкой |
| K2 | storekeeper | Размещение по складам | no | OK через OData | supply: статус снабжения to_stock; размещение |
| K3 | storekeeper | Комплектация + сборочный лист | part | OK через OData | supply: статус снабжения assembled; приходная накладная по закупке; storekeeper: transition sales → ready_to_ship |
| K5 | storekeeper | Отгрузка клиенту / ТК | part | **ошибка** | manager: «В работе» (команда ВРаботе) |
| K6 | storekeeper | Приёмка / подготовка возврата | no | OK через OData | storekeeper: PATCH КомментарийКСтроке |
| K7 | storekeeper | Контроль документов | part | OK через OData | manager: transition sales → closed; manager: transition purchases → closed; продажа вместе с закупкой |
| K8 | storekeeper | Розыск позиции | no | OK через OData | storekeeper: PATCH КомментарийКСтроке |
| K9 | storekeeper | Уведомление о самовывозе | no | OK через OData | storekeeper: PATCH КомментарийКСтроке |
| G1 | chief_mechanic | Открытие заказ-наряда | no | OK через OData | mechanic: импорт листа клиента (команда СоздатьЗаказ); строки заказа в АРМ |
| G2 | chief_mechanic | Заказ для ремонта | no | нет в сценариях |  |
| G3 | chief_mechanic | Выдача в ремонтную зону | no | OK через OData | mechanic: transition sales → assembly |
| G4 | chief_mechanic | Нормо-часы | no | OK через OData | mechanic: PATCH КоличествоНормаЧас |
| G5 | chief_mechanic | Зарплатный фонд | no | вне учёта 1С | зарплатный фонд |
| G7 | chief_mechanic | Контроль документов | no | нет в сценариях |  |
| G8 | chief_mechanic | Неопознанная позиция | no | нет в сценариях |  |
| G9 | chief_mechanic | Печать комплекта документов и выдача авто | no | OK через OData | mechanic: transition sales → closed |

## Шаги

### happy — FAIL

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000043 |
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
| M4 | заказ поставщику по закупке | OK | НФНФ-000016 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P1 | поставщик обработал заказ (вне учёта: без изменения данных) | OK |  |
| P2 | supply: статус снабжения in_transit | OK | → in_transit (200) |
| K1 | supply: статус снабжения acceptance | OK | → acceptance (200) |
| K2 | supply: статус снабжения to_stock | OK | → to_stock (200) |
| M8 | уведомление о приходе (вне учёта: без изменения данных) | OK |  |
| M9 | supply: статус снабжения assembly | OK | → assembly (200) |
| K3 | supply: статус снабжения assembled | OK | → ready_to_ship (200) |
| — | продажа идёт за закупкой | OK | ready_to_ship |
| K3 | приходная накладная по закупке | OK | НФНФ-000012, проведена true |
| M11 | уведомление о готовности (вне учёта: без изменения данных) | OK |  |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-13 ОТГ-01849 |
| K5 | manager: «В работе» (команда ВРаботе) | **FAIL** | задание failed Процесс прерван: Ошибка проведения Заказа Покупателя Заказ покупателя 43 от 13.10.2026 : Нельзя записать заказ: новое состояние заказа "" не принадлежит виду заказа "Основной". → ready_to_ship |

### stock — FAIL

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| пред. | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000044 |
| пред. | строки заказа в АРМ | OK | строк 1 |
| пред. | manager: PATCH Номенклатура | OK | 200 |
| пред. | manager: PATCH Количество | OK | 200 |
| пред. | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| пред. | manager: PATCH Коэффициент | OK | 200 |
| пред. | manager: PATCH Поставщик | OK | 200 |
| пред. | manager: строка закупки | OK | 201 |
| пред. | manager: PATCH Количество | OK | 200 |
| пред. | manager: PATCH Поставщик | OK | 200 |
| пред. | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| пред. | manager: PATCH Цена | OK | 200 |
| пред. | manager: «В работе» (команда ВРаботе) | OK | задание done → ordered |
| пред. | заказ поставщику по закупке | OK | НФНФ-000017 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P1 | поставщик обработал заказ (вне учёта: без изменения данных) | OK |  |
| P2 | supply: статус снабжения in_transit | OK | → in_transit (200) |
| K1 | supply: статус снабжения acceptance | OK | → acceptance (200) |
| K2 | supply: статус снабжения to_stock | OK | → to_stock (200) |
| M8 | уведомление о приходе (вне учёта: без изменения данных) | OK |  |
| M9 | supply: статус снабжения assembly | OK | → assembly (200) |
| K3 | supply: статус снабжения assembled | OK | → ready_to_ship (200) |
| — | продажа идёт за закупкой | OK | ready_to_ship |
| пред. | manager: transition sales → closed | OK | → closed (200) |
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000045 |
| N1,M1 | строки заказа в АРМ | OK | строк 1 |
| M2 | manager: PATCH Номенклатура | OK | 200 |
| M2 | manager: PATCH Количество | OK | 200 |
| M2 | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| M2 | manager: PATCH Коэффициент | OK | 200 |
| M2 | manager: PATCH Поставщик | OK | 200 |
| M3 | manager: transition sales → reserve | OK | → reserve (200) |
| M9 | manager: transition sales → assembly | OK | → assembly (200) |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| M11 | уведомление о готовности (вне учёта: без изменения данных) | OK |  |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-13 ОТГ-02386 |
| K5 | manager: «В работе» (команда ВРаботе) | **FAIL** | задание failed Процесс прерван: Ошибка проведения Заказа Покупателя Заказ покупателя 45 от 13.10.2026 : Нельзя записать заказ: новое состояние заказа "" не принадлежит виду заказа "Основной". → ready_to_ship |

### mixed_order — FAIL

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| пред. | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000046 |
| пред. | строки заказа в АРМ | OK | строк 1 |
| пред. | manager: PATCH Номенклатура | OK | 200 |
| пред. | manager: PATCH Количество | OK | 200 |
| пред. | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| пред. | manager: PATCH Коэффициент | OK | 200 |
| пред. | manager: PATCH Поставщик | OK | 200 |
| пред. | manager: строка закупки | OK | 201 |
| пред. | manager: PATCH Количество | OK | 200 |
| пред. | manager: PATCH Поставщик | OK | 200 |
| пред. | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| пред. | manager: PATCH Цена | OK | 200 |
| пред. | manager: «В работе» (команда ВРаботе) | OK | задание done → ordered |
| пред. | заказ поставщику по закупке | OK | НФНФ-000018 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P1 | поставщик обработал заказ (вне учёта: без изменения данных) | OK |  |
| P2 | supply: статус снабжения in_transit | OK | → in_transit (200) |
| K1 | supply: статус снабжения acceptance | OK | → acceptance (200) |
| K2 | supply: статус снабжения to_stock | OK | → to_stock (200) |
| M8 | уведомление о приходе (вне учёта: без изменения данных) | OK |  |
| M9 | supply: статус снабжения assembly | OK | → assembly (200) |
| K3 | supply: статус снабжения assembled | OK | → ready_to_ship (200) |
| — | продажа идёт за закупкой | OK | ready_to_ship |
| пред. | manager: transition sales → closed | OK | → closed (200) |
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000047 |
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
| M4 | заказ поставщику по закупке | OK | НФНФ-000019 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P1 | поставщик обработал заказ (вне учёта: без изменения данных) | OK |  |
| P2 | supply: статус снабжения in_transit | OK | → in_transit (200) |
| K1 | supply: статус снабжения acceptance | OK | → acceptance (200) |
| K2 | supply: статус снабжения to_stock | OK | → to_stock (200) |
| M8 | уведомление о приходе (вне учёта: без изменения данных) | OK |  |
| — | продажа идёт за закупкой | OK | to_stock |
| M9 | manager: transition sales → assembly | OK | → assembly (200) |
| M9 | supply: статус снабжения assembly | OK | → assembly (200) |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| K3 | supply: статус снабжения assembled | OK | → ready_to_ship (200) |
| M11 | уведомление о готовности (вне учёта: без изменения данных) | OK |  |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-13 ОТГ-03588 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-13 ОТГ-03588 |
| K5 | manager: «В работе» (команда ВРаботе) | **FAIL** | задание failed Процесс прерван: Ошибка проведения Заказа Покупателя Заказ покупателя 47 от 13.10.2026 : Нельзя записать заказ: новое состояние заказа "" не принадлежит виду заказа "Основной". → ready_to_ship, ready_to_ship |

### delivery_split — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000049 |
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
| M4 | заказ поставщику по закупке | OK | НФНФ-000020 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P1 | поставщик обработал заказ (вне учёта: без изменения данных) | OK |  |
| — | продажа идёт за закупкой | OK | paid |
| N4 | manager: transition purchases → shipped | OK | → shipped (200) |
| N4 | продажа вместе с закупкой | OK | → shipped |
| M17 | manager: PATCH КомментарийКСтроке | OK | 200 |
| K9 | storekeeper: PATCH КомментарийКСтроке | OK | 200 |
| K1 | storekeeper: transition purchases → acceptance | OK | → acceptance (200) |
| K1 | продажа вместе с закупкой | OK | → acceptance |
| K2 | размещение (вне учёта: без изменения данных) | OK |  |
| M8 | уведомление о приходе (вне учёта: без изменения данных) | OK |  |
| M9 | manager: transition sales → assembly | OK | → assembly (200) |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| M11 | уведомление о готовности (вне учёта: без изменения данных) | OK |  |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-13 ОТГ-04216 |
| M15,K7 | manager: transition sales → closed | OK | → closed (200) |

### virtual_buy — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000050 |
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
| M13 | заказ поставщику по закупке | OK | НФНФ-000021 |
| M13 | manager: PATCH Количество в «Заказано» → 403 (матрица) | OK | 403 matrix_denied: матрица: нельзя в статусе «ordered» |
| A3 | admin: PATCH Количество | OK | 200 |
| A3 | admin: статус снабжения paid | OK | → paid (200) |

### defect — FAIL

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| пред. | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000051 |
| пред. | строки заказа в АРМ | OK | строк 1 |
| пред. | manager: PATCH Номенклатура | OK | 200 |
| пред. | manager: PATCH Количество | OK | 200 |
| пред. | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| пред. | manager: PATCH Коэффициент | OK | 200 |
| пред. | manager: PATCH Поставщик | OK | 200 |
| пред. | manager: строка закупки | OK | 201 |
| пред. | manager: PATCH Количество | OK | 200 |
| пред. | manager: PATCH Поставщик | OK | 200 |
| пред. | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| пред. | manager: PATCH Цена | OK | 200 |
| пред. | manager: «В работе» (команда ВРаботе) | OK | задание done → ordered |
| пред. | заказ поставщику по закупке | OK | НФНФ-000022 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P1 | поставщик обработал заказ (вне учёта: без изменения данных) | OK |  |
| P2 | supply: статус снабжения in_transit | OK | → in_transit (200) |
| K1 | supply: статус снабжения acceptance | OK | → acceptance (200) |
| K2 | supply: статус снабжения to_stock | OK | → to_stock (200) |
| M8 | уведомление о приходе (вне учёта: без изменения данных) | OK |  |
| M9 | supply: статус снабжения assembly | OK | → assembly (200) |
| K3 | supply: статус снабжения assembled | OK | → ready_to_ship (200) |
| — | продажа идёт за закупкой | OK | ready_to_ship |
| пред. | manager: transition sales → closed | OK | → closed (200) |
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000052 |
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
| M11 | уведомление о готовности (вне учёта: без изменения данных) | OK |  |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-13 ОТГ-06937 |
| K5 | manager: «В работе» (команда ВРаботе) | **FAIL** | задание failed Процесс прерван: Ошибка проведения Заказа Покупателя Заказ покупателя 52 от 13.10.2026 : Нельзя записать заказ: новое состояние заказа "" не принадлежит виду заказа "Основной". → ready_to_ship |

### cancel_supplier — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000053 |
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
| M4 | заказ поставщику по закупке | OK | НФНФ-000023 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P1 | поставщик обработал заказ (вне учёта: без изменения данных) | OK |  |
| — | продажа идёт за закупкой | OK | paid |
| M15 | manager: PATCH КомментарийКСтроке | OK | 200 |
| M16 | manager: transition purchases → return | OK | → return (200) |
| M16 | продажа вместе с закупкой | OK | → return |
| P3 | поставщик закрыл заказ (вне учёта: без изменения данных) | OK |  |

### return — FAIL

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| пред. | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000054 |
| пред. | строки заказа в АРМ | OK | строк 1 |
| пред. | manager: PATCH Номенклатура | OK | 200 |
| пред. | manager: PATCH Количество | OK | 200 |
| пред. | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| пред. | manager: PATCH Коэффициент | OK | 200 |
| пред. | manager: PATCH Поставщик | OK | 200 |
| пред. | manager: строка закупки | OK | 201 |
| пред. | manager: PATCH Количество | OK | 200 |
| пред. | manager: PATCH Поставщик | OK | 200 |
| пред. | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| пред. | manager: PATCH Цена | OK | 200 |
| пред. | manager: «В работе» (команда ВРаботе) | OK | задание done → ordered |
| пред. | заказ поставщику по закупке | OK | НФНФ-000024 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P1 | поставщик обработал заказ (вне учёта: без изменения данных) | OK |  |
| P2 | supply: статус снабжения in_transit | OK | → in_transit (200) |
| K1 | supply: статус снабжения acceptance | OK | → acceptance (200) |
| K2 | supply: статус снабжения to_stock | OK | → to_stock (200) |
| M8 | уведомление о приходе (вне учёта: без изменения данных) | OK |  |
| M9 | supply: статус снабжения assembly | OK | → assembly (200) |
| K3 | supply: статус снабжения assembled | OK | → ready_to_ship (200) |
| — | продажа идёт за закупкой | OK | ready_to_ship |
| пред. | manager: transition sales → closed | OK | → closed (200) |
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000055 |
| N1,M1 | строки заказа в АРМ | OK | строк 1 |
| M2 | manager: PATCH Номенклатура | OK | 200 |
| M2 | manager: PATCH Количество | OK | 200 |
| M2 | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| M2 | manager: PATCH Коэффициент | OK | 200 |
| M2 | manager: PATCH Поставщик | OK | 200 |
| M3 | manager: transition sales → reserve | OK | → reserve (200) |
| M9 | manager: transition sales → assembly | OK | → assembly (200) |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| M11 | уведомление о готовности (вне учёта: без изменения данных) | OK |  |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-13 ОТГ-08797 |
| K5 | manager: «В работе» (команда ВРаботе) | **FAIL** | задание failed Процесс прерван: Ошибка проведения Заказа Покупателя Заказ покупателя 55 от 13.10.2026 : Нельзя записать заказ: новое состояние заказа "" не принадлежит виду заказа "Основной". → ready_to_ship |

### return_mgr — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000056 |
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
| M4 | заказ поставщику по закупке | OK | НФНФ-000025 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P1 | поставщик обработал заказ (вне учёта: без изменения данных) | OK |  |
| P2 | supply: статус снабжения in_transit | OK | → in_transit (200) |
| K1 | supply: статус снабжения acceptance | OK | → acceptance (200) |
| K2 | supply: статус снабжения to_stock | OK | → to_stock (200) |
| M8 | уведомление о приходе (вне учёта: без изменения данных) | OK |  |
| — | продажа идёт за закупкой | OK | to_stock |
| M16 | manager: transition purchases → return | OK | → return (200) |
| M16 | продажа вместе с закупкой | OK | → return |
| K6 | storekeeper: PATCH КомментарийКСтроке | OK | 200 |
| P3 | поставщик принял возврат (вне учёта: без изменения данных) | OK |  |
| M15,K7 | manager: transition purchases → closed | OK | → closed (200) |
| M15,K7 | продажа вместе с закупкой | OK | → closed |

### return_internal — FAIL

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| пред. | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000057 |
| пред. | строки заказа в АРМ | OK | строк 1 |
| пред. | manager: PATCH Номенклатура | OK | 200 |
| пред. | manager: PATCH Количество | OK | 200 |
| пред. | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| пред. | manager: PATCH Коэффициент | OK | 200 |
| пред. | manager: PATCH Поставщик | OK | 200 |
| пред. | manager: строка закупки | OK | 201 |
| пред. | manager: PATCH Количество | OK | 200 |
| пред. | manager: PATCH Поставщик | OK | 200 |
| пред. | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| пред. | manager: PATCH Цена | OK | 200 |
| пред. | manager: «В работе» (команда ВРаботе) | OK | задание done → ordered |
| пред. | заказ поставщику по закупке | OK | НФНФ-000026 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P1 | поставщик обработал заказ (вне учёта: без изменения данных) | OK |  |
| P2 | supply: статус снабжения in_transit | OK | → in_transit (200) |
| K1 | supply: статус снабжения acceptance | OK | → acceptance (200) |
| K2 | supply: статус снабжения to_stock | OK | → to_stock (200) |
| M8 | уведомление о приходе (вне учёта: без изменения данных) | OK |  |
| M9 | supply: статус снабжения assembly | OK | → assembly (200) |
| K3 | supply: статус снабжения assembled | OK | → ready_to_ship (200) |
| — | продажа идёт за закупкой | OK | ready_to_ship |
| пред. | manager: transition sales → closed | OK | → closed (200) |
| N1,M1 | manager: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000058 |
| N1,M1 | строки заказа в АРМ | OK | строк 1 |
| M2 | manager: PATCH Номенклатура | OK | 200 |
| M2 | manager: PATCH Количество | OK | 200 |
| M2 | manager: PATCH СебестоимостьЕдиницы | OK | 200 |
| M2 | manager: PATCH Коэффициент | OK | 200 |
| M2 | manager: PATCH Поставщик | OK | 200 |
| M3 | manager: transition sales → reserve | OK | → reserve (200) |
| M9 | manager: transition sales → assembly | OK | → assembly (200) |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| M11 | уведомление о готовности (вне учёта: без изменения данных) | OK |  |
| M12 | manager: отгрузка (дата и номер) | OK | 200 обработано 1 |
| M12 | дата и номер отгрузки в строке | OK | 2026-10-13 ОТГ-10490 |
| K5 | manager: «В работе» (команда ВРаботе) | **FAIL** | задание failed Процесс прерван: Ошибка проведения Заказа Покупателя Заказ покупателя 58 от 13.10.2026 : Нельзя записать заказ: новое состояние заказа "" не принадлежит виду заказа "Основной". → ready_to_ship |

### car_repair_in — OK

| Узел | Шаг | Итог | Подробности |
|---|---|---|---|
| N1,G1 | mechanic: импорт листа клиента (команда СоздатьЗаказ) | OK | 201 НФНФ-000059 |
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
| M4 | заказ поставщику по закупке | OK | НФНФ-000027 |
| M7 | supply: статус снабжения paid | OK | → paid (200) |
| P1 | поставщик обработал заказ (вне учёта: без изменения данных) | OK |  |
| P2 | supply: статус снабжения in_transit | OK | → in_transit (200) |
| K1 | supply: статус снабжения acceptance | OK | → acceptance (200) |
| K2 | supply: статус снабжения to_stock | OK | → to_stock (200) |
| M8 | уведомление о приходе (вне учёта: без изменения данных) | OK |  |
| — | продажа идёт за закупкой | OK | to_stock |
| M9 | manager: transition sales → assembly | OK | → assembly (200) |
| M9 | supply: статус снабжения assembly | OK | → assembly (200) |
| K3 | storekeeper: transition sales → ready_to_ship | OK | → ready_to_ship (200) |
| K3 | supply: статус снабжения assembled | OK | → ready_to_ship (200) |
| M11 | уведомление о готовности (вне учёта: без изменения данных) | OK |  |
| G3 | mechanic: transition sales → assembly | OK | → assembly, assembly (200) |
| G4 | mechanic: PATCH КоличествоНормаЧас | OK | 200 |
| G5 | зарплатный фонд (вне учёта: без изменения данных) | OK |  |
| G9 | mechanic: transition sales → closed | OK | → closed, closed (200) |

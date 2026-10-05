# Снимок прав ACL (генерируется tools/generate_arm_matrix_rights.py --report)

Источник: `default-matrix.js` (`column-matrix (2).json`), вкладка `manager`, уровень `order`. Бит роли: manager=1, storekeeper=2, chief_mechanic=4, admin=8, supplier=16, client=32.

Ячеек с битом creator (128, игнорируется D1c): **10**. Ячеек admin-only (256, игнорируется D1e=B): **0**.

Администратор в таблицах не показан: его права — whitelist без статуса (D1e=B). Расхождение остальных вкладок матрицы с вкладкой manager (ячеек статус×колонка): admin=55, chief_mechanic=55, client=55, storekeeper=55, supplier=55.

## new — Черновик

| поле регистра | колонка | manager | storekeeper/Снабжение | chief_mechanic | supplier | client |
|---|---|---|---|---|---|---|
| ОтметкаСтроки | cell_select | ✓ | ✓ | ✓ | ✓ | ✓ |
| ДатаЗаказа | order_date | ✓ | — | ✓ | — | — |
| НомерЗаказаКлиента | order_client_number | ✓ | ✓ | ✓ | — | — |
| Покупатель | customer | ✓ | ✓ | ✓ | — | — |
| Договор | contract | ✓ | ✓ | ✓ | — | — |
| ВидУслуги | service_type | ✓ | ✓ | ✓ | — | — |
| Марка | brand_fact | — | ✓ | ✓ | — | — |
| Модель | model_fact | ✓ | ✓ | ✓ | — | — |
| Агрегат | aggregate_fact | ✓ | ✓ | ✓ | — | — |
| Госномер | gosnomer_fact | ✓ | ✓ | ✓ | — | — |
| ЗаглушкаНомерШасси | grz_fact | ✓ | — | — | — | — |
| VIN | vin_fact | ✓ | ✓ | ✓ | — | — |
| Двигатель | engine_fact | ✓ | ✓ | ✓ | — | — |
| СрочностьКлиента | urgency_fact | ✓ | — | ✓ | — | — |
| ГРЗКлиента | vehicle_plate_fact | ✓ | — | ✓ | — | — |
| ТерриторияКлиента | territory_fact | ✓ | — | ✓ | — | — |
| НоменклатураКлиента | name_fact | ✓ | — | ✓ | — | — |
| АртикулКлиента | article_fact | ✓ | — | ✓ | — | — |
| КоличествоКлиента | qty_fact | ✓ | — | ✓ | — | — |
| ЕдиницаИзмеренияКлиента | unit_fact | ✓ | — | ✓ | — | — |
| Номенклатура | name | ✓ | — | ✓ | — | — |
| Количество | qty | ✓ | ✓ | ✓ | — | — |
| Партия | batch_fifo | ✓ | ✓ | ✓ | — | — |
| СтатусСтроки | line_status | ✓ | — | — | — | — |
| СебестоимостьЕдиницы | price | ✓ | — | ✓ | — | — |
| ФормаОплаты | payment_form | ✓ | ✓ | ✓ | — | — |
| РРЦ | rrc | ✓ | — | ✓ | — | — |
| Оплачено | paid_status | ✓ | ✓ | ✓ | — | — |
| КоличествоНормаЧас | qty_norm_hours_client | ✓ | — | ✓ | — | — |
| Коэффициент | coefficient | ✓ | — | ✓ | — | — |
| Цена | extra_field_1 | ✓ | — | ✓ | — | — |
| Поставщик | supplier | ✓ | — | ✓ | — | — |
| ТерриторияОтгрузкиПоставщиком | supplier_ship_territory | ✓ | ✓ | ✓ | ✓ | ✓ |
| КомментарийКСтроке | comment | ✓ | ✓ | ✓ | ✓ | ✓ |

## in_work — ВРаботе

| поле регистра | колонка | manager | storekeeper/Снабжение | chief_mechanic | supplier | client |
|---|---|---|---|---|---|---|
| ОтметкаСтроки | cell_select | ✓ | ✓ | ✓ | ✓ | ✓ |
| ДатаЗаказа | order_date | ✓ | — | ✓ | — | — |
| НомерЗаказаКлиента | order_client_number | ✓ | ✓ | ✓ | — | — |
| Покупатель | customer | ✓ | ✓ | ✓ | — | — |
| Договор | contract | ✓ | ✓ | ✓ | — | — |
| ВидУслуги | service_type | ✓ | ✓ | ✓ | — | — |
| Марка | brand_fact | — | ✓ | ✓ | — | — |
| Модель | model_fact | ✓ | ✓ | ✓ | — | — |
| Агрегат | aggregate_fact | ✓ | ✓ | ✓ | — | — |
| Госномер | gosnomer_fact | ✓ | ✓ | ✓ | — | — |
| ЗаглушкаНомерШасси | grz_fact | ✓ | — | — | — | — |
| VIN | vin_fact | ✓ | ✓ | ✓ | — | — |
| Двигатель | engine_fact | ✓ | ✓ | ✓ | — | — |
| СрочностьКлиента | urgency_fact | ✓ | — | ✓ | — | — |
| ГРЗКлиента | vehicle_plate_fact | ✓ | — | ✓ | — | — |
| ТерриторияКлиента | territory_fact | ✓ | — | ✓ | — | — |
| НоменклатураКлиента | name_fact | ✓ | — | ✓ | — | — |
| АртикулКлиента | article_fact | ✓ | — | ✓ | — | — |
| КоличествоКлиента | qty_fact | ✓ | — | ✓ | — | — |
| ЕдиницаИзмеренияКлиента | unit_fact | ✓ | — | ✓ | — | — |
| Номенклатура | name | ✓ | — | ✓ | — | — |
| Количество | qty | ✓ | ✓ | ✓ | — | — |
| Партия | batch_fifo | ✓ | ✓ | ✓ | — | — |
| СтатусСтроки | line_status | ✓ | — | — | — | — |
| СебестоимостьЕдиницы | price | ✓ | — | ✓ | — | — |
| ФормаОплаты | payment_form | ✓ | ✓ | ✓ | — | — |
| РРЦ | rrc | ✓ | — | ✓ | — | — |
| Оплачено | paid_status | ✓ | ✓ | ✓ | — | — |
| КоличествоНормаЧас | qty_norm_hours_client | ✓ | — | ✓ | — | — |
| Коэффициент | coefficient | ✓ | — | ✓ | — | — |
| Цена | extra_field_1 | ✓ | — | ✓ | — | — |
| Поставщик | supplier | ✓ | — | ✓ | — | — |
| ТерриторияОтгрузкиПоставщиком | supplier_ship_territory | ✓ | ✓ | ✓ | ✓ | ✓ |
| КомментарийКСтроке | comment | ✓ | ✓ | ✓ | ✓ | ✓ |

## partially_ordered — ЧастичноЗаказано

| поле регистра | колонка | manager | storekeeper/Снабжение | chief_mechanic | supplier | client |
|---|---|---|---|---|---|---|
| ОтметкаСтроки | cell_select | ✓ | — | ✓ | — | — |
| ВидУслуги | service_type | ✓ | ✓ | ✓ | — | — |
| Номенклатура | name | ✓ | — | ✓ | — | — |
| Партия | batch_fifo | ✓ | ✓ | ✓ | — | — |
| СтатусСтроки | line_status | ✓ | — | — | — | — |
| СебестоимостьЕдиницы | price | ✓ | — | ✓ | — | — |
| ФормаОплаты | payment_form | ✓ | ✓ | ✓ | — | — |
| РРЦ | rrc | ✓ | — | ✓ | — | — |
| Оплачено | paid_status | ✓ | ✓ | ✓ | — | — |
| КоличествоНормаЧас | qty_norm_hours_client | ✓ | — | ✓ | — | — |
| Коэффициент | coefficient | ✓ | — | ✓ | — | — |
| Цена | extra_field_1 | ✓ | — | ✓ | — | — |
| Поставщик | supplier | ✓ | — | ✓ | — | — |
| ТерриторияОтгрузкиПоставщиком | supplier_ship_territory | ✓ | ✓ | ✓ | ✓ | ✓ |
| КомментарийКСтроке | comment | ✓ | ✓ | ✓ | ✓ | ✓ |

## ordered — Заказано

| поле регистра | колонка | manager | storekeeper/Снабжение | chief_mechanic | supplier | client |
|---|---|---|---|---|---|---|
| ОтметкаСтроки | cell_select | ✓ | — | ✓ | — | — |
| ВидУслуги | service_type | ✓ | ✓ | ✓ | — | — |
| Номенклатура | name | ✓ | — | ✓ | — | — |
| Партия | batch_fifo | ✓ | ✓ | ✓ | — | — |
| СтатусСтроки | line_status | ✓ | — | — | — | — |
| СебестоимостьЕдиницы | price | ✓ | — | ✓ | — | — |
| ФормаОплаты | payment_form | ✓ | ✓ | ✓ | — | — |
| РРЦ | rrc | ✓ | — | ✓ | — | — |
| Оплачено | paid_status | ✓ | ✓ | ✓ | — | — |
| КоличествоНормаЧас | qty_norm_hours_client | ✓ | — | ✓ | — | — |
| Коэффициент | coefficient | ✓ | — | ✓ | — | — |
| Цена | extra_field_1 | ✓ | — | ✓ | — | — |
| Поставщик | supplier | ✓ | — | ✓ | — | — |
| ТерриторияОтгрузкиПоставщиком | supplier_ship_territory | ✓ | ✓ | ✓ | ✓ | ✓ |
| КомментарийКСтроке | comment | ✓ | ✓ | ✓ | ✓ | ✓ |

## paid — Оплачено

| поле регистра | колонка | manager | storekeeper/Снабжение | chief_mechanic | supplier | client |
|---|---|---|---|---|---|---|
| ОтметкаСтроки | cell_select | ✓ | — | ✓ | ✓ | — |
| ВидУслуги | service_type | ✓ | ✓ | ✓ | — | — |
| Номенклатура | name | ✓ | — | ✓ | — | — |
| Партия | batch_fifo | ✓ | ✓ | ✓ | — | — |
| СтатусСтроки | line_status | ✓ | — | — | — | — |
| РРЦ | rrc | ✓ | — | ✓ | — | — |
| Оплачено | paid_status | ✓ | ✓ | ✓ | — | — |
| КоличествоНормаЧас | qty_norm_hours_client | ✓ | — | ✓ | — | — |
| Коэффициент | coefficient | ✓ | — | ✓ | — | — |
| Цена | extra_field_1 | ✓ | — | ✓ | — | — |
| Поставщик | supplier | ✓ | — | ✓ | — | — |
| ТерриторияОтгрузкиПоставщиком | supplier_ship_territory | ✓ | ✓ | ✓ | ✓ | ✓ |
| КомментарийКСтроке | comment | ✓ | ✓ | ✓ | ✓ | ✓ |

## in_transit — ТоварВПути

| поле регистра | колонка | manager | storekeeper/Снабжение | chief_mechanic | supplier | client |
|---|---|---|---|---|---|---|
| ОтметкаСтроки | cell_select | ✓ | — | ✓ | ✓ | — |
| ВидУслуги | service_type | ✓ | ✓ | ✓ | — | — |
| Номенклатура | name | ✓ | — | ✓ | — | — |
| Партия | batch_fifo | ✓ | ✓ | ✓ | — | — |
| СтатусСтроки | line_status | ✓ | — | — | — | — |
| РРЦ | rrc | ✓ | — | ✓ | — | — |
| Оплачено | paid_status | ✓ | ✓ | ✓ | — | — |
| КоличествоНормаЧас | qty_norm_hours_client | ✓ | — | ✓ | — | — |
| Коэффициент | coefficient | ✓ | — | ✓ | — | — |
| Цена | extra_field_1 | ✓ | — | ✓ | — | — |
| Поставщик | supplier | ✓ | — | ✓ | — | — |
| ТерриторияОтгрузкиПоставщиком | supplier_ship_territory | ✓ | ✓ | ✓ | ✓ | ✓ |
| КомментарийКСтроке | comment | ✓ | ✓ | ✓ | ✓ | ✓ |

## awaiting_receipt — ОжидаемПоступление

| поле регистра | колонка | manager | storekeeper/Снабжение | chief_mechanic | supplier | client |
|---|---|---|---|---|---|---|
| ОтметкаСтроки | cell_select | ✓ | — | ✓ | — | — |
| ВидУслуги | service_type | ✓ | ✓ | ✓ | — | — |
| Номенклатура | name | ✓ | — | ✓ | — | — |
| Партия | batch_fifo | ✓ | ✓ | ✓ | — | — |
| СтатусСтроки | line_status | ✓ | — | — | — | — |
| РРЦ | rrc | ✓ | — | ✓ | — | — |
| Оплачено | paid_status | ✓ | ✓ | ✓ | — | — |
| КоличествоНормаЧас | qty_norm_hours_client | ✓ | — | ✓ | — | — |
| Коэффициент | coefficient | ✓ | — | ✓ | — | — |
| Цена | extra_field_1 | ✓ | — | ✓ | — | — |
| Поставщик | supplier | ✓ | — | ✓ | — | — |
| ТерриторияОтгрузкиПоставщиком | supplier_ship_territory | ✓ | ✓ | ✓ | ✓ | ✓ |
| КомментарийКСтроке | comment | ✓ | ✓ | ✓ | ✓ | ✓ |

## acceptance — Приходуется

| поле регистра | колонка | manager | storekeeper/Снабжение | chief_mechanic | supplier | client |
|---|---|---|---|---|---|---|
| ОтметкаСтроки | cell_select | — | ✓ | — | — | — |
| ВидУслуги | service_type | ✓ | ✓ | ✓ | — | — |
| Номенклатура | name | — | ✓ | — | — | — |
| Партия | batch_fifo | ✓ | ✓ | ✓ | — | — |
| СтатусСтроки | line_status | ✓ | — | — | — | — |
| СебестоимостьЕдиницы | price | ✓ | ✓ | — | — | — |
| ФормаОплаты | payment_form | — | ✓ | — | — | — |
| РРЦ | rrc | ✓ | — | ✓ | — | — |
| Оплачено | paid_status | ✓ | ✓ | ✓ | — | — |
| КоличествоНормаЧас | qty_norm_hours_client | ✓ | — | ✓ | — | — |
| Коэффициент | coefficient | ✓ | — | ✓ | — | — |
| Цена | extra_field_1 | ✓ | — | ✓ | — | — |
| Поставщик | supplier | ✓ | ✓ | — | — | — |
| ДатаПоступления | receipt_date | — | ✓ | — | — | — |
| ЗаглушкаДатаУПД | upd_date | — | ✓ | — | — | — |
| ЗаглушкаНомерУПД | upd_number | — | ✓ | — | — | — |
| ТерриторияОтгрузкиПоставщиком | supplier_ship_territory | ✓ | ✓ | ✓ | ✓ | ✓ |
| КомментарийКСтроке | comment | ✓ | ✓ | ✓ | ✓ | ✓ |

## to_stock — НаСкладе

| поле регистра | колонка | manager | storekeeper/Снабжение | chief_mechanic | supplier | client |
|---|---|---|---|---|---|---|
| ОтметкаСтроки | cell_select | — | ✓ | — | — | — |
| ВидУслуги | service_type | ✓ | ✓ | ✓ | — | — |
| Номенклатура | name | — | ✓ | — | — | — |
| Партия | batch_fifo | ✓ | ✓ | ✓ | — | — |
| СтатусСтроки | line_status | ✓ | — | — | — | — |
| СебестоимостьЕдиницы | price | ✓ | ✓ | — | — | — |
| ФормаОплаты | payment_form | — | ✓ | — | — | — |
| РРЦ | rrc | ✓ | — | ✓ | — | — |
| Оплачено | paid_status | ✓ | ✓ | ✓ | — | — |
| КоличествоНормаЧас | qty_norm_hours_client | ✓ | — | ✓ | — | — |
| Коэффициент | coefficient | ✓ | — | ✓ | — | — |
| Цена | extra_field_1 | ✓ | — | ✓ | — | — |
| Поставщик | supplier | ✓ | ✓ | — | — | — |
| ДатаПоступления | receipt_date | — | ✓ | — | — | — |
| ЗаглушкаДатаУПД | upd_date | — | ✓ | — | — | — |
| ЗаглушкаНомерУПД | upd_number | — | ✓ | — | — | — |
| ТерриторияОтгрузкиПоставщиком | supplier_ship_territory | ✓ | ✓ | ✓ | ✓ | ✓ |
| КомментарийКСтроке | comment | ✓ | ✓ | ✓ | ✓ | ✓ |

## reserve — Резервирование

| поле регистра | колонка | manager | storekeeper/Снабжение | chief_mechanic | supplier | client |
|---|---|---|---|---|---|---|
| ОтметкаСтроки | cell_select | ✓ | ✓ | ✓ | — | — |
| ВидУслуги | service_type | ✓ | ✓ | ✓ | — | — |
| Номенклатура | name | ✓ | ✓ | ✓ | — | — |
| Партия | batch_fifo | ✓ | ✓ | ✓ | — | — |
| СтатусСтроки | line_status | ✓ | — | — | — | — |
| РРЦ | rrc | ✓ | — | ✓ | — | — |
| Оплачено | paid_status | ✓ | ✓ | ✓ | — | — |
| КоличествоНормаЧас | qty_norm_hours_client | ✓ | — | ✓ | — | — |
| Коэффициент | coefficient | ✓ | — | ✓ | — | — |
| Цена | extra_field_1 | ✓ | — | ✓ | — | — |
| ТерриторияОтгрузкиПоставщиком | supplier_ship_territory | ✓ | ✓ | ✓ | ✓ | ✓ |
| КомментарийКСтроке | comment | ✓ | ✓ | ✓ | ✓ | ✓ |

## assembly — Комплектуется

| поле регистра | колонка | manager | storekeeper/Снабжение | chief_mechanic | supplier | client |
|---|---|---|---|---|---|---|
| ОтметкаСтроки | cell_select | — | ✓ | — | — | — |
| ВидУслуги | service_type | ✓ | ✓ | ✓ | — | — |
| Номенклатура | name | — | ✓ | — | — | — |
| Партия | batch_fifo | ✓ | ✓ | ✓ | — | — |
| СтатусСтроки | line_status | ✓ | — | — | — | — |
| РРЦ | rrc | ✓ | — | ✓ | — | — |
| Оплачено | paid_status | ✓ | ✓ | ✓ | — | — |
| КоличествоНормаЧас | qty_norm_hours_client | ✓ | — | ✓ | — | — |
| Коэффициент | coefficient | ✓ | — | ✓ | — | — |
| Цена | extra_field_1 | ✓ | — | ✓ | — | — |
| ТерриторияОтгрузкиПоставщиком | supplier_ship_territory | ✓ | ✓ | ✓ | ✓ | ✓ |
| КомментарийКСтроке | comment | ✓ | ✓ | ✓ | ✓ | ✓ |

## ready_to_ship — Подготовлено, Собран

| поле регистра | колонка | manager | storekeeper/Снабжение | chief_mechanic | supplier | client |
|---|---|---|---|---|---|---|
| ОтметкаСтроки | cell_select | — | ✓ | — | — | — |
| ДатаОтгрузки | shipment_date | ✓ | ✓ | ✓ | — | — |
| ВидУслуги | service_type | ✓ | ✓ | ✓ | — | — |
| Номенклатура | name | ✓ | — | ✓ | — | — |
| Партия | batch_fifo | ✓ | ✓ | ✓ | — | — |
| СтатусСтроки | line_status | ✓ | — | — | — | — |
| Оплачено | paid_status | ✓ | ✓ | ✓ | — | — |
| КоличествоНормаЧас | qty_norm_hours_client | ✓ | — | ✓ | — | — |
| Коэффициент | coefficient | ✓ | — | ✓ | — | — |
| Цена | extra_field_1 | ✓ | — | ✓ | — | — |
| ТерриторияОтгрузкиПоставщиком | supplier_ship_territory | ✓ | ✓ | ✓ | ✓ | ✓ |
| КомментарийКСтроке | comment | ✓ | ✓ | ✓ | ✓ | ✓ |

## shipped — Отгружено

| поле регистра | колонка | manager | storekeeper/Снабжение | chief_mechanic | supplier | client |
|---|---|---|---|---|---|---|
| ОтметкаСтроки | cell_select | — | ✓ | — | — | — |
| ДокументПодписанОригинал | doc_signed_original | ✓ | ✓ | ✓ | — | — |
| СтатусСтроки | line_status | ✓ | — | — | — | — |
| Оплачено | paid_status | ✓ | ✓ | ✓ | — | — |
| КоличествоНормаЧас | qty_norm_hours_client | ✓ | — | ✓ | — | — |
| ТерриторияОтгрузкиПоставщиком | supplier_ship_territory | ✓ | ✓ | ✓ | ✓ | ✓ |
| КомментарийКСтроке | comment | ✓ | ✓ | ✓ | ✓ | ✓ |

## return — Возврат

| поле регистра | колонка | manager | storekeeper/Снабжение | chief_mechanic | supplier | client |
|---|---|---|---|---|---|---|
| ОтметкаСтроки | cell_select | ✓ | ✓ | ✓ | — | — |
| ДокументПодписанОригинал | doc_signed_original | ✓ | ✓ | ✓ | — | — |
| СтатусСтроки | line_status | ✓ | — | — | — | — |
| Оплачено | paid_status | ✓ | ✓ | ✓ | — | — |
| КоличествоНормаЧас | qty_norm_hours_client | ✓ | — | ✓ | — | — |
| ТерриторияОтгрузкиПоставщиком | supplier_ship_territory | ✓ | ✓ | ✓ | ✓ | ✓ |
| КомментарийКСтроке | comment | ✓ | ✓ | ✓ | ✓ | ✓ |

## closed — Выполнено, Завершено

| поле регистра | колонка | manager | storekeeper/Снабжение | chief_mechanic | supplier | client |
|---|---|---|---|---|---|---|
| ОтметкаСтроки | cell_select | ✓ | ✓ | ✓ | — | — |
| СтатусСтроки | line_status | ✓ | — | — | — | — |
| Оплачено | paid_status | ✓ | ✓ | ✓ | — | — |
| КоличествоНормаЧас | qty_norm_hours_client | ✓ | — | ✓ | — | — |
| ТерриторияОтгрузкиПоставщиком | supplier_ship_territory | ✓ | ✓ | ✓ | ✓ | ✓ |
| КомментарийКСтроке | comment | ✓ | ✓ | ✓ | ✓ | ✓ |


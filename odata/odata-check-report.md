# OData и PWA: проверка

Публикация: `http://127.0.0.1:8090/odata215/odata/standard.odata`, пользователь «Админ». Дата: 12.10.2026 23:28.

Наборов сущностей: **5262**, `$metadata` — 15945 КБ.

| Вид | Наборов |
|---|---|
| Catalog | 1476 |
| Document | 1305 |
| InformationRegister | 1132 |
| Constant | 939 |
| AccumulationRegister | 260 |
| ExchangePlan | 64 |
| DocumentJournal | 49 |
| BusinessProcess | 17 |
| ChartOfCharacteristicTypes | 11 |
| ChartOfCalculationTypes | 4 |
| AccountingRegister | 2 |
| ChartOfAccounts | 2 |
| Task | 1 |

Объекты АРМ: `Catalog_Арм_ФормыОплаты`, `Catalog_Арм_ВидыУслуги`, `InformationRegister_Арм_ДанныеЗакупокИПродаж`, `InformationRegister_Арм_ПраваПользователей`

Перечисления АРМ — типы `EnumType` в `$metadata` (1С не публикует перечисления как наборы): `Арм_СтатусыАРМ`, `Арм_ВидыОпераций`, `Арм_РолиИнтерфейса`

## Операции PWA → OData

| Операция PWA (REST API АРМ) | Что делает | OData | Как / почему |
|---|---|---|---|
| `POST/GET/DELETE /session` | вход, роль, выход | **частично** | OData — Basic-авторизация пользователем ИБ на каждый запрос; роль АРМ — чтение InformationRegister_Арм_ПраваПользователей; сессий/токенов нет |
| `GET /matrix` | матрица прав роль × статус × колонка | **нет** | матрица — код модуля Арм_МатрицаПрав, не данные; в OData не публикуется |
| `GET /lines` | строки АРМ с фильтрами | **да** | InformationRegister_Арм_ДанныеЗакупокИПродаж, $filter/$select/$orderby/$top; права по матрице (скрытые колонки) OData не применяет |
| `GET /lines/{id}` | одна строка | **да** | InformationRegister_Арм_ДанныеЗакупокИПродаж(<все измерения>) |
| `PATCH /lines/{id}` | правка поля по правам роли | **частично** | запись в регистр напрямую: без проверки матрицы, без пересчёта цен/сумм, без журнала Арм_Журнал — PATCH записи регистра — HTTP 200, значение записано и возвращено (HTTP 200) |
| `POST /lines` | новая строка заказа | **нет** | строки создаёт расширение при записи заказа покупателя; прямой POST в регистр обходит ключи связи и заказ |
| `DELETE /lines/{id}` | пометка строки на удаление | **частично** | DELETE записи регистра удаляет её физически (в АРМ — флаг Удаление и правка заказа) |
| `POST /lines/{id}/mark, GET/POST /selection` | отметки строк пользователя | **частично** | поля ОтметкаСтроки/АвторСтроки можно писать PATCH, но без логики «только автор» |
| `POST /lines/transition` | переходы процессов (резерв, комплектация, УПД, возврат, закрыть) | **нет** | бизнес-логика Арм_ОбщегоНазначенияАРМ (статусы закупки и продажи, даты, документы) |
| `POST /sales/jobs, /sales/prepared` | «В работе», «Подготовлено» | **нет** | создание заказов поставщику/документов — код АРМ |
| `POST /sales/customer-orders, .../{id}/post, DELETE .../{id}` | заказ покупателя: создать, провести, удалить | **частично** | Document_ЗаказПокупателя: POST/PATCH/DELETE и действие Post() есть в OData, но строки АРМ создаются только с включёнными обработчиками расширения (не в безопасном режиме) |
| `POST /sales/supplier-orders` | заказ поставщику | **частично** | Document_ЗаказПоставщику через OData; связь со строками закупки (ДокументЗаказПоставщика) — код АРМ |
| `POST /sales/shipments` | отгрузка (расходная накладная) | **частично** | Document_РасходнаяНакладная + Post(); заполнение по строкам АРМ — код АРМ |
| `POST /sales/imports` | импорт листа покупателя | **нет** | разбор Excel/CSV и создание заказа — код АРМ |
| `POST /supply/status` | канбан снабжения | **нет** | Арм_ОбщегоНазначенияАРМ.ИзменитьСтатусыВРегистреСнабжения (статус закупки и продажи, В9) |
| `GET /jobs/{id}` | фоновые задания | **нет** | фоновые задания в OData не публикуются |
| `GET /documents/{kind}/{id}` | карточка документа | **да** | Document_<вид>(guid'…') с табличными частями |
| `GET /directories/*` | шесть справочников | **да** | Catalog_Контрагенты, Catalog_ДоговорыКонтрагентов, Catalog_Номенклатура, Catalog_ПартииНоменклатуры, Catalog_Арм_ВидыУслуги, Catalog_Арм_ФормыОплаты |

## Чтение данных (HTTP)

| Что | Запрос | Ответ |
|---|---|---|
| GET /lines (строки АРМ) | `InformationRegister_Арм_ДанныеЗакупокИПродаж?$top=5&$format=json` | HTTP 200, 111 мс |
| GET /lines — количество | `InformationRegister_Арм_ДанныеЗакупокИПродаж/$count` | HTTP 200, 50 мс |
| GET /lines?status=… (фильтр по статусу) | `InformationRegister_Арм_ДанныеЗакупокИПродаж?$filter=%D0%A1%D1%82%D0%B0%D1%82%D1%83%D1%81%D0%A1%D1%82%D1%80%D0%BE%D0%BA%D0%B8%20eq%20'%D0%A7%D0%B5%D1%80%D0%BD%D0%BE%D0%B2%D0%B8%D0%BA'&$top=3&$format=json` | HTTP 200, 62 мс |
| GET /directories/counterparties | `Catalog_Контрагенты?$top=3&$select=Ref_Key,Description&$format=json` | HTTP 200, 63 мс |
| GET /directories/contracts | `Catalog_ДоговорыКонтрагентов?$top=3&$select=Ref_Key,Description,Owner,Owner_Type&$format=json` | HTTP 200, 47 мс |
| GET /directories/nomenclature | `Catalog_Номенклатура?$top=3&$select=Ref_Key,Description,Артикул&$format=json` | HTTP 200, 69 мс |
| GET /directories/batches | `Catalog_ПартииНоменклатуры?$top=3&$format=json` | HTTP 200, 58 мс |
| GET /directories/service-types | `Catalog_Арм_ВидыУслуги?$format=json` | HTTP 200, 103 мс |
| GET /directories/payment-forms | `Catalog_Арм_ФормыОплаты?$format=json` | HTTP 200, 81 мс |
| GET /documents/customer_order/{id} | `Document_ЗаказПокупателя?$top=1&$format=json` | HTTP 200, 323 мс |
| GET /documents/supplier_order/{id} | `Document_ЗаказПоставщику?$top=1&$format=json` | HTTP 200, 56 мс |
| роли пользователей (POST /session -> роль) | `InformationRegister_Арм_ПраваПользователей?$format=json` | HTTP 200, 73 мс |

Запись: PATCH записи регистра — HTTP 200, значение записано и возвращено (HTTP 200)

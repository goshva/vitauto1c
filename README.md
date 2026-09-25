# Витавто 1С

Ветка `basdev`.

## Матрица колонок (как на Pages)

Интерактивно: **https://baskakovanton.github.io/vitauto1c/**

(Исходник: [index.html](index.html). На `goshva/vitauto1c` у аккаунта BaskakovAnton нет admin — GitHub Pages включён на форке `BaskakovAnton/vitauto1c`, ветка `basdev`.)

Канон BaskakovAnton/vitauto: https://baskakovanton.github.io/vitauto/

### Ссылка с настройками (query-параметры)

| Параметр | Значения | Что задаёт |
|---|---|---|
| `role` | `manager`, `storekeeper`, `chief_mechanic`, `admin`, `supplier`, `client` | выбранная роль |
| `level` | `order` (Заказ), `line` (Деталь) | уровень статуса |
| `mode` | `all` (все статусы), `single` (по одному статусу) | режим показа статусов |
| `status` | id статуса (`new`, `acceptance`, …) или номер с 1 | статус для режима `single` |

Пример: `index.html?role=storekeeper&level=line&mode=single&status=acceptance`

Адресная строка обновляется сама при переключениях; кнопка «Скопировать ссылку» копирует текущую.

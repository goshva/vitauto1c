# АРМ API — тестовое PWA

Vue 3 + Pinia + Vue Router + vite-plugin-pwa. Клиент REST API АРМ по контракту `openapi/arm-pwa.openapi.yaml`
(HTTP-сервис 1С `Арм_API` из расширения АРМЗакупокИПродаж v2.9).

## Запуск

Нужна публикация 1С с HTTP-сервисом — локальный Apache из `tools/arm-api-1c`
(`http://127.0.0.1:8090/vitauto/hs/api/arm/v1`) и тестовые пользователи `arm.manager`, `arm.storekeeper`,
`arm.supply` (пароль `1`).

```
cd pwa
npm install
npm run api        # поднять публикацию 1С (Apache на :8090); после перезагрузки Windows — заново
npm run dev        # http://127.0.0.1:5173 — рабочая база (публикация /autoservice)
npm run dev:test   # то же на тестовой копии D:\1c\test_fresh (публикация /vitauto)
npm run build && npm run preview   # сборка с service worker: http://127.0.0.1:4173
npm test           # интеграционные тесты против живого 1С
```

Рабочая база подключается один раз: закрыть все окна 1С на ней и выполнить
`tools/arm-api-1c/deploy-prod.ps1` — резервная копия, АРМ v2.9 в базу, безопасный режим расширения выключен,
пользователи `arm.manager` / `arm.storekeeper` / `arm.supply`, публикация `/autoservice`.
Через API нельзя войти с пустым паролем (технический пользователь публикации `Админ` закрыт).

Vite проксирует `/api/*` на публикацию: `/api/arm/v1/...` → `<ARM_API_TARGET>/arm/v1/...`.
Другой сервер — переменная `ARM_API_TARGET` (по умолчанию `http://127.0.0.1:8090/autoservice/hs/api`),
для тестов — `ARM_API_URL` (полный адрес `.../arm/v1`). Базовый URL можно поменять и на экране входа.

## Экраны

| Маршрут | Что делает | Операции API |
|---|---|---|
| `/login` | вход пользователем ИБ 1С | `POST /session` |
| `/lines/sales`, `/lines/purchases`, `/lines/supply` | таблица строк АРМ по колонкам матрицы, фильтры, группировка по заказам; двойной клик по голубой ячейке — правка по правам роли (`+`, `c` — только автор); отметки и итоги; команды продаж и снабжения | `GET /lines`, `PATCH /lines/{id}`, `POST /lines/{id}/mark`, `GET/POST /selection`, `POST /lines`, `DELETE /lines/{id}`, `POST /sales/*`, `DELETE /sales/customer-orders/{id}`, `POST /supply/status`, `GET /jobs/{id}` |
| `/import` | лист покупателя из Excel (Tab) или CSV (;) | `POST /sales/imports` |
| `/documents/:kind/:id` | карточка документа | `GET /documents/{kind}/{id}` |
| `/directories/:name` | шесть справочников | `GET /directories/*` |
| `/matrix` | матрица роли: колонка × статус | `GET /matrix` (ETag / If-None-Match) |
| `/console` | любой из 29 запросов с правкой пути, параметров и тела; smoke-прогон всех GET | все |
| `/log` | журнал запросов: код, время, тела | — |

Роль `supply` видит только канбан снабжения; менеджеру `/lines/supply` недоступен (как `403 matrix_denied` в API).

## Заметки

- Токен и пользователь хранятся в `localStorage`; при `401` — возврат на вход.
- Service worker не кэширует `/api/*` (NetworkOnly): данные всегда из 1С.
- `POST /sales/supplier-orders` в 1С отвечает `501`: команда «Заказать» в форме АРМ — заглушка.
- «В работе» в АРМ v2.8/2.9 падает на проведении заказа (состояние заказа поставщику в заказе покупателя) —
  ошибку показывает диалог задания.

# Patch notes: АРМЗакупокИПродаж v2.10

**Ветка:** `fix/open-tasks` (от `dev`, не `process-api`).  
**База:** v2.8 → **v2.10** (v2.9 — лабораторный `process-api`, в этот релиз не входит).  
**Артефакт:** `АРМЗакупокИПродаж_v2.10.cfe`  
**Исходники:** `src/АРМЗакупокИПродаж_v2.10/`  
**Коммит:** `226dd49` — ARM v2.10: shipment number from RN, admin status buttons, contract reset, A3 unlock

## Изменения

### Номер отгрузки (Pack 2)

- `НомерОтгрузки` заполняется **системно** из `РасходнаяНакладная.Номер` при проведении РН.
- Ручной ввод убран: dblclick по ячейке, `ИзменитьНомерОтгрузкиНаСервере` — no-op; в диалоге «дата и номер» пишется только **дата** (поле номера скрыто).
- Снята валидация «пустой номер» перед отгрузкой.

Подробнее: [shipment-number-system-fill.md](shipment-number-system-fill.md).

### Статусы — MVP для администратора (Pack 3)

- Кнопки **Резервирование** / **ОжидаемПоступление** / **Возврат** создаются в коде в `ГруппаРаботаСоСтатусами` (без правок `Form.elem.json`).

### Договор при смене заказчика (Pack 4a)

- Смена **Покупатель** очищает **Договор**, если он не принадлежит новому заказчику (`ЗаписатьПолеСтрокиАРМ`).

### Unlock по А3 «Документ подписан» (Pack 4b, минимум)

- `ДокументПодписанОригинал = Истина` снимает **АвторСтроки** и **ОтметкаСтроки**.

Подробнее: [unlock-a3-doc-signed.md](unlock-a3-doc-signed.md).

## Отложено (не в v2.10)

- **Pack 4c** — ед. изм. (шт/л): только постановка [units-of-measure.md](units-of-measure.md).
- **Pack 5** — УПД, резерв qty, права ролей × статусов, seed шаг 3+: [open-tasks-pack5-deferred.md](open-tasks-pack5-deferred.md).

## Не входит

- Контур `process-api` (лаборатория разработчиков).
- Merge в `dev` / `master` / `basdev` без отдельного ок владельца.

## Приёмка

- **LoadCfg** на тестовой ИБ с `АРМЗакупокИПродаж_v2.10.cfe`.
- UI-чеклисты (Pack 0) — **вручную, не пройдены**; см. [fix-open-tasks.md](fix-open-tasks.md), `check-from-install.md`, матричные задачи.

## Ссылки

| Документ | Назначение |
|---|---|
| [shipment-number-system-fill.md](shipment-number-system-fill.md) | правило номера отгрузки |
| [unlock-a3-doc-signed.md](unlock-a3-doc-signed.md) | А3 unlock |
| [units-of-measure.md](units-of-measure.md) | ед. изм. (будущее) |
| [open-tasks-pack5-deferred.md](open-tasks-pack5-deferred.md) | отложенный Pack 5 |
| [fix-open-tasks.md](fix-open-tasks.md) | scope ветки и статус пачек |
| [../diff/АРМЗакупокИПродаж_v2.8__v2.10.md](../diff/АРМЗакупокИПродаж_v2.8__v2.10.md) | diff CFE v2.8 → v2.10 |

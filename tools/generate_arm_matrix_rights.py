#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Генератор ACL «роль x статус x колонка» для расширения АРМ (T-map + T01, tip v2.14).

Источник прав: default-matrix.js (канон Pages: вкладка manager, уровень order — решение D1).
Результат:
  1) tools/_generated_matrix_rights.json — срез для тестов и отчёта о расхождениях вкладок;
  2) src/АРМЗакупокИПродаж_v2.14/CommonModule/Арм_МатрицаПрав/CommonModule.obj.bsl (CRLF, без BOM);
  3) CommonModule.json / CommonModule.id.json (создаются один раз, UUID стабилен) и запись
     в ConfigurationExtension.json (список общих модулей).

Битовая модель ячейки (tools/make_default_matrix.py):
  manager=1, storekeeper=2, chief_mechanic=4, admin=8, supplier=16, client=32,
  required=64, creator=128 (отложен, D1c), admin-only=256.

Запуск:  python tools/generate_arm_matrix_rights.py
"""
import glob
import io
import json
import os
import re
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))

MODULE_NAME = 'Арм_МатрицаПрав'
MODULE_SYNONYM = 'Арм матрица прав'
TEMPLATE_MODULE = 'Арм_ДанныеЗакупокИПродажФон'
VERSION_DIR_GLOB = 'АРМЗакупокИПродаж_v2.14'

ROLE_BITS = {'manager': 1, 'storekeeper': 2, 'chief_mechanic': 4, 'admin': 8, 'supplier': 16, 'client': 32}
BIT_REQUIRED, BIT_CREATOR, BIT_ADMIN_ONLY = 64, 128, 256
EDITOR_MASK = 63          # в BSL хранятся только биты ролей (required/creator/admin-only отбрасываются)

# D1 — всегда вкладка manager
MATRIX_TAB = 'manager'
MATRIX_LEVEL = 'order'

# Роль интерфейса (Арм_РолиИнтерфейса) -> роль матрицы. Снабжение = storekeeper (D1d).
ROLE_ENUM_MAP = [
    ('Менеджер', 'manager'),
    ('Снабжение', 'storekeeper'),
    ('Кладовщик', 'storekeeper'),
    ('ГлавныйМеханик', 'chief_mechanic'),
    ('Администратор', 'admin'),
    ('Поставщик', 'supplier'),
    ('Клиент', 'client'),
]
ADMIN_ENUM = 'Администратор'

# id статуса матрицы -> значения Арм_СтатусыАРМ (T-map). ЗаблокированоФоном — нет пары, всегда deny.
STATUS_MAP = [
    ('new', ['Черновик']),
    ('in_work', ['ВРаботе']),
    ('partially_ordered', ['ЧастичноЗаказано']),
    ('ordered', ['Заказано']),
    ('paid', ['Оплачено']),
    ('in_transit', ['ТоварВПути']),
    ('awaiting_receipt', ['ОжидаемПоступление']),
    ('acceptance', ['Приходуется']),
    ('to_stock', ['НаСкладе']),
    ('reserve', ['Резервирование']),
    ('assembly', ['Комплектуется']),
    ('ready_to_ship', ['Подготовлено', 'Собран']),
    ('shipped', ['Отгружено']),
    ('return', ['Возврат']),
    ('closed', ['Выполнено', 'Завершено']),
]
BLOCKED_STATUS_ENUM = 'ЗаблокированоФоном'

# Поле регистра / колонка списка АРМ -> id колонки матрицы (по кодам column-codes.js).
_FIELD_PAIRS = [
    ('ОтметкаСтроки', 'cell_select'),                    # А1
    ('Порядок', 'row_number'),                           # А2
    ('ДокументПодписанОригинал', 'doc_signed_original'), # А3
    ('ДатаОтгрузки', 'shipment_date'),                   # В1
    ('НомерОтгрузки', 'shipment_number'),                # В2
    ('ДатаЗаказа', 'order_date'),                        # В3
    ('НомерЗаказа', 'order_internal_number'),            # В4
    ('НомерЗаказаКлиента', 'order_client_number'),       # В5
    ('Покупатель', 'customer'),                          # В6
    ('Договор', 'contract'),                             # В7
    ('ВидУслуги', 'service_type'),                       # В8
    ('ДатаОтправкиНаСборку', 'assembly_sent_date'),      # В9 (v2.14, ставится при переводе в «Комплектуется»)
    ('Марка', 'brand_fact'),                             # Е1
    ('Модель', 'model_fact'),                            # Е2
    ('Агрегат', 'aggregate_fact'),                       # Е3
    ('Госномер', 'gosnomer_fact'),                       # Е4
    ('НомерШасси', 'grz_fact'),                          # Е5 (в АРМ — «№ Шасси»; v2.11 T05: ресурс регистра)
    ('VIN', 'vin_fact'),                                 # Е6
    ('Двигатель', 'engine_fact'),                        # Е7
    ('СрочностьКлиента', 'urgency_fact'),                # К1
    ('ГРЗКлиента', 'vehicle_plate_fact'),                # К2
    ('ТерриторияКлиента', 'territory_fact'),             # К3
    ('НоменклатураКлиента', 'name_fact'),                # К4
    ('АртикулКлиента', 'article_fact'),                  # К5
    ('КоличествоКлиента', 'qty_fact'),                   # К6
    ('ЕдиницаИзмеренияКлиента', 'unit_fact'),            # К7
    ('Номенклатура', 'name'),                            # М1
    ('НоменклатураАртикул', 'article'),                  # М2
    ('НоменклатураАС_КодАвтоАльянс', 'code_aa'),         # М3
    ('НоменклатураЕдиницаИзмерения', 'unit'),            # М4
    ('Количество', 'qty'),                               # Н0
    ('ОстатокДляСтроки', 'stock_qty'),                   # Н1
    ('КоличествоВРезерве', 'reserve_qty'),               # Н2 (T05: ресурс регистра)
    ('КоличествоВПути', 'ordered_in_transit_qty'),       # Н3 (T05: ресурс регистра)
    ('Партия', 'batch_fifo'),                            # Н4
    ('СтатусСтроки', 'line_status'),                     # Н5
    ('ЯчейкаСклада', 'stock_cell'),                      # Н6 (v2.13, ячейка «на склад»)
    ('СебестоимостьЕдиницы', 'price'),                   # О1 (цена себес.)
    ('Себестоимость', 'sum'),                            # О2 (сумма себес.)
    ('ФормаОплаты', 'payment_form'),                     # О3
    ('РРЦ', 'rrc'),                                      # О4
    ('Оплачено', 'paid_status'),                         # О5
    ('НомерСчета', 'invoice_number'),                    # О6 (v2.13)
    ('ДатаСчета', 'invoice_date'),                       # О7 (v2.13)
    ('КоличествоНормаЧас', 'qty_norm_hours_client'),     # Р0
    ('Коэффициент', 'coefficient'),                      # Р1
    ('Цена', 'extra_field_1'),                           # Р2 (цена продажи)
    ('Сумма', 'extra_field_2'),                          # Р3 (сумма продажи)
    ('Поставщик', 'supplier'),                           # С1
    ('ДатаПоступления', 'receipt_date'),                 # С2
    ('ДатаУПД', 'upd_date'),                             # С3 (T05: ресурс регистра)
    ('НомерУПД', 'upd_number'),                          # С4 (T05: ресурс регистра)
    ('ТерриторияОтгрузкиПоставщиком', 'supplier_ship_territory'),  # С5
    ('ДатаЗаказаПоставщику', 'supplier_order_date'),     # С6 (v2.13, ставит система: «Создать заказ поставщику» / «В работе»)
    ('СрокПоставки', 'delivery_term'),                   # С7 (v2.13)
    ('КомментарийКСтроке', 'comment'),                   # Т1
    ('КомментарийКСтроке2', 'comment_2'),                # Т2 (v2.13)
]

FIELD_MAP = [(c, f) for f, c in _FIELD_PAIRS]    # (id колонки матрицы, поле регистра)

# D1e (вариант B): whitelist администратора без привязки к статусу. Должен совпадать со строками
# ПоляРедактируемыеАдминистратором() / ПоляИзменяемыеАдминистратором() в Form.obj.bsl (проверяет тест).
ADMIN_GENERIC_FIELDS = (
    'ДокументПодписанОригинал,ДатаЗаказа,НомерЗаказаКлиента,Покупатель,Договор,'
    'Марка,Модель,Агрегат,Госномер,VIN,Двигатель,'
    'СрочностьКлиента,ГРЗКлиента,ТерриторияКлиента,НоменклатураКлиента,АртикулКлиента,КоличествоКлиента,ЕдиницаИзмеренияКлиента,'
    'КоличествоНормаЧас,СебестоимостьЕдиницы,РРЦ,Оплачено,Поставщик,ТерриторияОтгрузкиПоставщиком'
).split(',')
# v2.13 (D1e′, решение владельца 07.10.2026): администратор правит ВСЕ поля регистра, выведенные колонками,
# в ЛЮБОМ статусе (включая «Заблокировано фоном») — в том числе системные: номер отгрузки, номер заказа, статус,
# себестоимость, остаток, порядок, дату заказа поставщику, дату отправки на сборку (v2.14). Не правятся только колонки не из регистра:
# реквизиты номенклатуры (М2–М4 — данные справочника) и «Сумма продажи» (Р3 — вычисляется в запросе списка).
NOT_REGISTER_FIELDS = ('НоменклатураАртикул', 'НоменклатураАС_КодАвтоАльянс', 'НоменклатураЕдиницаИзмерения', 'Сумма')
ADMIN_EXTRA_FIELDS = [f for _c, f in FIELD_MAP if f not in NOT_REGISTER_FIELDS and f not in ADMIN_GENERIC_FIELDS]

# T05 (D4): поля ручного ввода только по ACL (бывшие заглушки). Администратору их не добавляем (D1e=B: его whitelist
# прежний, матрица admin на этих колонках = 0); решает Арм_МатрицаПрав.ОтказПоПолю по роли и статусу строки.
# Н2/Н3 (резерв, в пути) сейчас не редактирует ни одна роль матрицы — путь ввода открывается автоматически,
# если матрицу перегенерировать с правом на эти колонки.
# H01 (v2.12): + ДатаПоступления (S2) — editable storekeeper в «Приходуется», на продажах раньше не было ввода.
# v2.13: + НомерСчета, ДатаСчета, СрокПоставки, ЯчейкаСклада, КомментарийКСтроке2 — ввод по ACL для ролей матрицы.
# Администратор правит их как и всё остальное (D1e′), ДатаЗаказаПоставщику — системное поле (ставит код).
ACL_INPUT_FIELDS = (
    'НомерШасси,КоличествоВРезерве,КоличествоВПути,ДатаУПД,НомерУПД,ДатаПоступления,'
    'НомерСчета,ДатаСчета,СрокПоставки,ЯчейкаСклада,КомментарийКСтроке2'
).split(',')

# Литералы Form.obj.bsl, разбитые по строкам (генератор повторяет разбивку 1-в-1).
_GENERIC_LINES = [
    'ДокументПодписанОригинал,ДатаЗаказа,НомерЗаказаКлиента,Покупатель,Договор,',
    'Марка,Модель,Агрегат,Госномер,VIN,Двигатель,',
    'СрочностьКлиента,ГРЗКлиента,ТерриторияКлиента,НоменклатураКлиента,АртикулКлиента,КоличествоКлиента,ЕдиницаИзмеренияКлиента,',
    'КоличествоНормаЧас,СебестоимостьЕдиницы,РРЦ,Оплачено,Поставщик,ТерриторияОтгрузкиПоставщиком',
]
_EXTRA_LINES = [','.join(ADMIN_EXTRA_FIELDS[i:i + 8]) + (',' if i + 8 < len(ADMIN_EXTRA_FIELDS) else '')
                for i in range(0, len(ADMIN_EXTRA_FIELDS), 8)]


def admin_fields():
    return set(ADMIN_GENERIC_FIELDS) | set(ADMIN_EXTRA_FIELDS)


def status_id_by_enum(name):
    for sid, names in STATUS_MAP:
        if name in names:
            return sid
    return None


def role_bit_by_enum(name):
    for en, rid in ROLE_ENUM_MAP:
        if en == name:
            return ROLE_BITS[rid]
    return 0


# ---------------------------------------------------------------- чтение матрицы
def find_src_dir():
    found = glob.glob(os.path.join(ROOT, 'src', VERSION_DIR_GLOB))
    if not found:
        raise SystemExit('Нет каталога src/%s' % VERSION_DIR_GLOB)
    return found[0]


EXT_DIR = find_src_dir()
EXT_JSON = os.path.join(EXT_DIR, 'ConfigurationExtension.json')
MODULE_DIR = os.path.join(EXT_DIR, 'CommonModule', MODULE_NAME)
BSL_PATH = os.path.join(MODULE_DIR, 'CommonModule.obj.bsl')
JSON_OUT = os.path.join(HERE, '_generated_matrix_rights.json')


def load_matrix(path=None):
    path = path or os.path.join(ROOT, 'default-matrix.js')
    text = io.open(path, encoding='utf-8').read()
    m = re.search(r'VITAUTO_DEFAULT_MATRIX\s*=\s*(\{.*\})\s*;', text, re.S)
    if not m:
        raise SystemExit('default-matrix.js: не найден VITAUTO_DEFAULT_MATRIX')
    return json.loads(m.group(1))


def build_model(matrix=None):
    """Срез матрицы: статус -> колонка -> (маска & 63) по вкладке manager/order (D1)."""
    matrix = matrix or load_matrix()
    statuses, columns = matrix['statuses'], matrix['columns']
    tab = matrix['cells'][MATRIX_LEVEL][MATRIX_TAB]
    masks = {s: {c: tab[s][i] & EDITOR_MASK for i, c in enumerate(columns)} for s in statuses}

    divergences = {}
    for role in matrix['roles']:
        if role == MATRIX_TAB:
            continue
        other = matrix['cells'][MATRIX_LEVEL][role]
        n, examples = 0, []
        for s in statuses:
            for i, c in enumerate(columns):
                a, b = tab[s][i] & 63, other[s][i] & 63
                if a != b:
                    n += 1
                    if len(examples) < 5:
                        examples.append('%s/%s: manager=%d %s=%d' % (s, c, a, role, b))
        divergences[role] = {'cells': n, 'examples': examples}
    ignored_creator = [(s, c) for s in statuses for i, c in enumerate(columns) if tab[s][i] & BIT_CREATOR]
    return {
        'source': matrix.get('source'),
        'canon_tab': MATRIX_TAB,
        'canon_level': MATRIX_LEVEL,
        'role_bits': ROLE_BITS,
        'statuses': statuses,
        'columns': columns,
        'masks': masks,
        'ignored_creator': ignored_creator,
        'tab_divergences_vs_manager': divergences,
    }


# ---------------------------------------------------------------- эталонная модель (зеркало ОтказПоПолю)
def can_edit(model, role, arm_status, field):
    """Python-зеркало Арм_МатрицаПрав.ОтказПоПолю == '' (role — имя из Арм_РолиИнтерфейса или пусто)."""
    bit = role_bit_by_enum(role)
    if bit == 0:
        return False
    if role == ADMIN_ENUM:          # D1e′ (v2.13): любой статус, включая ЗаблокированоФоном
        return field in admin_fields()
    if arm_status == BLOCKED_STATUS_ENUM:
        return False
    sid = status_id_by_enum(arm_status)
    if sid is None:
        return False
    cid = dict((f, c) for c, f in FIELD_MAP).get(field)
    if cid is None:
        return False
    return bool(model['masks'][sid][cid] & bit)


# ---------------------------------------------------------------- BSL
def bsl_str(s):
    return '"%s"' % s.replace('"', '""')


def generate_bsl(model):
    L = []
    a = L.append
    a('// %s — ACL «роль x статус строки x колонка» по матрице прав (T-map + T01, tip v2.14).' % MODULE_NAME)
    a('// СГЕНЕРИРОВАНО tools/generate_arm_matrix_rights.py из «%s». Не править вручную.' % model['source'])
    a('// Модуль чистый: не читает БД и сеанс — роль и статус строки передаёт вызывающий серверный код.')
    a('//')
    a('// Решения владельца (tasks/impl-plan-matrix-arm.md, принято 05.10.2026):')
    a('//   D1  — права любой роли берутся по маскам вкладки manager (уровень order);')
    a('//   D1b — роль не задана (нет записи в регистре прав) = запрет (fail-closed);')
    a('//   D1c / D1c′=A — бит creator игнорируется (H05 SKIP; поле «создатель» — вне пачки);')
    a('//   D1d — роль Снабжение = права storekeeper;')
    a('//   D1e′ (v2.13) — администратор: все поля регистра колонок в любом статусе (и «Заблокировано фоном»),')
    a('//          включая системные; матрица ему не применяется;')
    a('//   D2  — статус строки меняют менеджер (по полю СтатусСтроки) и администратор (в форме).')
    a('// Статус ЗаблокированоФоном пары в матрице не имеет — правка запрещена всем, кроме администратора.')
    a('')
    a('#Область ПрограммныйИнтерфейс')
    a('')
    a('// Текст отказа для правки поля строки либо пустая строка, если правка разрешена.')
    a('//')
    a('// Параметры:')
    a('//  Роль            - ПеречислениеСсылка.Арм_РолиИнтерфейса - пустая ссылка = запрет (D1b)')
    a('//  СтатусСтроки    - ПеречислениеСсылка.Арм_СтатусыАРМ')
    a('//  ИмяПоляРегистра - Строка - имя поля Арм_ДанныеЗакупокИПродаж / колонки списка АРМ')
    a('//')
    a('// Возвращаемое значение:')
    a('//  Строка')
    a('Функция ОтказПоПолю(Знач Роль, Знач СтатусСтроки, Знач ИмяПоляРегистра) Экспорт')
    a('')
    a('\tБит = БитРоли(Роль);')
    a('\tЕсли Бит = 0 Тогда')
    a('\t\tВозврат "Для вашей учётной записи не задана роль в регистре «Права пользователей АРМ». Обратитесь к администратору.";')
    a('\tКонецЕсли;')
    a('')
    a('\t// D1e′ (v2.13): администратор — все поля регистра колонок в любом статусе, включая «Заблокировано фоном».')
    a('\tЕсли Роль = ПредопределенноеЗначение("Перечисление.Арм_РолиИнтерфейса.Администратор") Тогда')
    a('\t\tЕсли СтрНайти("," + ПоляИзменяемыеАдминистратором() + ",", "," + ИмяПоляРегистра + ",") > 0 Тогда')
    a('\t\t\tВозврат "";')
    a('\t\tКонецЕсли;')
    a('\t\tВозврат ТекстОтказаПоПолю(Роль, СтатусСтроки, ИмяПоляРегистра);')
    a('\tКонецЕсли;')
    a('')
    a('\tЕсли СтатусСтроки = ПредопределенноеЗначение("Перечисление.Арм_СтатусыАРМ.ЗаблокированоФоном") Тогда')
    a('\t\tВозврат "Строка обрабатывается фоновым заданием — правка недоступна. Повторите позже.";')
    a('\tКонецЕсли;')
    a('')
    a('\tИдСтатуса = МатричныйСтатусПоСтатусуАРМ(СтатусСтроки);')
    a('\tЕсли ПустаяСтрока(ИдСтатуса) Тогда')
    a('\t\tВозврат ТекстОтказаПоПолю(Роль, СтатусСтроки, ИмяПоляРегистра);')
    a('\tКонецЕсли;')
    a('')
    a('\tИдКолонки = КолонкаМатрицыПоПолюРегистра(ИмяПоляРегистра);')
    a('\tЕсли ПустаяСтрока(ИдКолонки) Тогда')
    a('\t\tВозврат ТекстОтказаПоПолю(Роль, СтатусСтроки, ИмяПоляРегистра);')
    a('\tКонецЕсли;')
    a('')
    a('\tЕсли БитРолиВМаске(МаскаЯчейки(ИдСтатуса, ИдКолонки), Бит) = 0 Тогда')
    a('\t\tВозврат ТекстОтказаПоПолю(Роль, СтатусСтроки, ИмяПоляРегистра);')
    a('\tКонецЕсли;')
    a('')
    a('\tВозврат "";')
    a('')
    a('КонецФункции')
    a('')
    a('// Можно ли роли править поле строки в данном статусе (Истина, если ОтказПоПолю вернул пустую строку).')
    a('Функция МожноРедактироватьПоле(Знач Роль, Знач СтатусСтроки, Знач ИмяПоляРегистра) Экспорт')
    a('')
    a('\tВозврат ПустаяСтрока(ОтказПоПолю(Роль, СтатусСтроки, ИмяПоляРегистра));')
    a('')
    a('КонецФункции')
    a('')
    a('// Поле входит в «общий ввод значения» (двойной щелчок): так правят поля без отдельного обработчика.')
    a('Функция ПолеОбщегоВвода(Знач ИмяПоля) Экспорт')
    a('')
    a('\tВозврат СтрНайти("," + ПоляОбщегоВвода() + ",", "," + ИмяПоля + ",") > 0;')
    a('')
    a('КонецФункции')
    a('')
    a('// Id статуса матрицы по статусу АРМ. Пустая строка — пары нет (ЗаблокированоФоном, пустая ссылка).')
    a('Функция МатричныйСтатусПоСтатусуАРМ(Знач СтатусАРМ) Экспорт')
    a('')
    for i, (sid, names) in enumerate(STATUS_MAP):
        cond = ' Или '.join('СтатусАРМ = ПредопределенноеЗначение("Перечисление.Арм_СтатусыАРМ.%s")' % n for n in names)
        a('\t%s %s Тогда' % ('Если' if i == 0 else 'ИначеЕсли', cond))
        a('\t\tВозврат "%s";' % sid)
    a('\tКонецЕсли;')
    a('')
    a('\tВозврат "";')
    a('')
    a('КонецФункции')
    a('')
    a('// Id колонки матрицы по имени поля регистра. Пустая строка — поля нет в матрице.')
    a('Функция КолонкаМатрицыПоПолюРегистра(Знач ИмяПоляРегистра) Экспорт')
    a('')
    a('\tСписок = ";" + СписокПолейМатрицы();')
    a('\tМаркер = ";" + ИмяПоляРегистра + "=";')
    a('\tПозиция = СтрНайти(Список, Маркер);')
    a('\tЕсли ПустаяСтрока(ИмяПоляРегистра) Или Позиция = 0 Тогда')
    a('\t\tВозврат "";')
    a('\tКонецЕсли;')
    a('\tХвост = Сред(Список, Позиция + СтрДлина(Маркер));')
    a('\tВозврат Лев(Хвост, СтрНайти(Хвост, ";") - 1);')
    a('')
    a('КонецФункции')
    a('')
    a('#КонецОбласти')
    a('')
    a('#Область СлужебныеПроцедурыИФункции')
    a('')
    a('Функция ТекстОтказаПоПолю(Знач Роль, Знач СтатусСтроки, Знач ИмяПоляРегистра)')
    a('')
    a('\tВозврат СтрШаблон("Роль «%1» не может менять поле «%2» в статусе строки «%3» (матрица прав АРМ).",')
    a('\t\tСтрока(Роль), ИмяПоляРегистра, Строка(СтатусСтроки));')
    a('')
    a('КонецФункции')
    a('')
    a('// Бит роли в маске ячейки (manager=1, storekeeper=2, chief_mechanic=4, admin=8, supplier=16, client=32).')
    a('// Пустая роль — 0 (запрет).')
    a('Функция БитРоли(Знач Роль)')
    a('')
    for en, rid in ROLE_ENUM_MAP:
        a('\tЕсли Роль = ПредопределенноеЗначение("Перечисление.Арм_РолиИнтерфейса.%s") Тогда' % en)
        a('\t\tВозврат %d;' % ROLE_BITS[rid])
        a('\tКонецЕсли;')
    a('')
    a('\tВозврат 0;')
    a('')
    a('КонецФункции')
    a('')
    a('// Проверка бита: возвращает Бит, если он установлен в Маска, иначе 0 (Бит — степень двойки).')
    a('// v2.13: не «ПобитовоеИ» — это имя глобальной функции платформы 8.3, модуль с ним не компилируется.')
    a('Функция БитРолиВМаске(Знач Маска, Знач Бит)')
    a('')
    a('\tВозврат ?(Цел(Маска / Бит) % 2 = 1, Бит, 0);')
    a('')
    a('КонецФункции')
    a('')
    a('// Маска ячейки (биты ролей) для пары «id статуса матрицы / id колонки матрицы»; 0, если ячейки нет.')
    a('Функция МаскаЯчейки(Знач ИдСтатуса, Знач ИдКолонки)')
    a('')
    a('\tСписок = ";" + СписокМаскСтатуса(ИдСтатуса);')
    a('\tМаркер = ";" + ИдКолонки + "=";')
    a('\tПозиция = СтрНайти(Список, Маркер);')
    a('\tЕсли Позиция = 0 Тогда')
    a('\t\tВозврат 0;')
    a('\tКонецЕсли;')
    a('\tХвост = Сред(Список, Позиция + СтрДлина(Маркер));')
    a('\tВозврат Число(Лев(Хвост, СтрНайти(Хвост, ";") - 1));')
    a('')
    a('КонецФункции')
    a('')
    a('// Поля регистра / колонки АРМ -> id колонки матрицы («Поле=колонка;»).')
    a('Функция СписокПолейМатрицы()')
    a('')
    for i, (cid, field) in enumerate(FIELD_MAP):
        a('\t%s"%s=%s;"%s' % ('Возврат ' if i == 0 else '\t+ ', field, cid, ';' if i == len(FIELD_MAP) - 1 else ''))
    a('')
    a('КонецФункции')
    a('')
    a('// Поля «общего ввода» администратора (= ПоляРедактируемыеАдминистратором() формы).')
    a('Функция ПоляОбщегоВвода()')
    a('')
    for i, line in enumerate(_GENERIC_LINES):
        a('\t%s%s%s' % ('Возврат ' if i == 0 else '\t+ ', bsl_str(line), ';' if i == len(_GENERIC_LINES) - 1 else ''))
    a('')
    a('КонецФункции')
    a('')
    a('// Все поля, которые администратор вправе менять в любом статусе (= ПоляИзменяемыеАдминистратором() формы, v2.13).')
    a('Функция ПоляИзменяемыеАдминистратором()')
    a('')
    a('\tВозврат ПоляОбщегоВвода() + ","')
    for i, line in enumerate(_EXTRA_LINES):
        a('\t\t+ %s%s' % (bsl_str(line), ';' if i == len(_EXTRA_LINES) - 1 else ''))
    a('')
    a('КонецФункции')
    a('')
    a('// Поля ручного ввода по ACL для ролей матрицы (= ПоляВводаПоACL() формы; администратор правит их как и всё).')
    a('Функция ПоляВводаПоACL()')
    a('')
    a('\tВозврат %s;' % bsl_str(','.join(ACL_INPUT_FIELDS)))
    a('')
    a('КонецФункции')
    a('')
    a('// Маски ячеек статуса матрицы («колонка=маска;»); нулевые маски опущены. Вкладка manager, уровень order.')
    a('Функция СписокМаскСтатуса(Знач ИдСтатуса)')
    a('')
    for i, s in enumerate(model['statuses']):
        a('\t%s ИдСтатуса = "%s" Тогда' % ('Если' if i == 0 else 'ИначеЕсли', s))
        items = ['"%s=%d;"' % (c, model['masks'][s][c]) for c in model['columns'] if model['masks'][s][c]]
        if not items:
            a('\t\tВозврат "";')
        for j, it in enumerate(items):
            a('\t\t%s%s%s' % ('Возврат ' if j == 0 else '\t+ ', it, ';' if j == len(items) - 1 else ''))
    a('\tКонецЕсли;')
    a('')
    a('\tВозврат "";')
    a('')
    a('КонецФункции')
    a('')
    a('#КонецОбласти')
    return '\r\n'.join(L) + '\r\n'


# ---------------------------------------------------------------- метаданные модуля
def ensure_module_metadata(src_dir):
    mod_dir = os.path.join(src_dir, 'CommonModule', MODULE_NAME)
    tpl_dir = os.path.join(src_dir, 'CommonModule', TEMPLATE_MODULE)
    os.makedirs(mod_dir, exist_ok=True)

    id_path = os.path.join(mod_dir, 'CommonModule.id.json')
    if os.path.exists(id_path):
        new_uuid = json.loads(io.open(id_path, encoding='utf-8').read())['uuid']
    else:
        new_uuid = str(uuid.uuid4())
        tpl_id = io.open(os.path.join(tpl_dir, 'CommonModule.id.json'), encoding='utf-8', newline='').read()
        old_uuid = json.loads(tpl_id)['uuid']
        io.open(id_path, 'w', encoding='utf-8', newline='').write(tpl_id.replace(old_uuid, new_uuid))

    json_path = os.path.join(mod_dir, 'CommonModule.json')
    if not os.path.exists(json_path):
        tpl = io.open(os.path.join(tpl_dir, 'CommonModule.json'), encoding='utf-8', newline='').read()
        tpl = tpl.replace(TEMPLATE_MODULE, MODULE_NAME).replace('Арм общего назначения АРМ', MODULE_SYNONYM)
        io.open(json_path, 'w', encoding='utf-8', newline='').write(tpl)
    return new_uuid


COMMON_MODULE_CLASS = '0fe48980-252d-11d6-a3c7-0050bae0a776'


def register_in_extension(src_dir, module_uuid):
    """Добавляет uuid модуля в список общих модулей ConfigurationExtension.json (идемпотентно)."""
    path = os.path.join(src_dir, 'ConfigurationExtension.json')
    raw = io.open(path, encoding='utf-8', newline='').read()
    data = json.loads(raw)
    changed = False

    def walk(node):
        nonlocal changed
        if isinstance(node, list):
            if node and node[0] == COMMON_MODULE_CLASS and len(node) >= 2 and node[1].isdigit():
                count = int(node[1])
                ids = node[2:]
                if module_uuid not in ids:
                    ids.append(module_uuid)
                    node[1] = str(len(ids))
                    node[2:] = ids
                    changed = True
                return True
            for x in node:
                if walk(x):
                    return True
        elif isinstance(node, dict):
            for x in node.values():
                if walk(x):
                    return True
        return False

    if not walk(data):
        raise SystemExit('ConfigurationExtension.json: не найден список общих модулей %s' % COMMON_MODULE_CLASS)
    if changed:
        nl = '\r\n' if '\r\n' in raw else '\n'
        text = json.dumps(data, ensure_ascii=False, indent=2)
        if nl != '\n':
            text = text.replace('\n', nl)
        io.open(path, 'w', encoding='utf-8', newline='').write(text + (nl if raw.endswith(('\n', '\r\n')) else ''))
    return changed


def write_text(path, text):
    io.open(path, 'w', encoding='utf-8', newline='').write(text)


def main():
    src_dir = EXT_DIR
    model = build_model()
    write_text(JSON_OUT, json.dumps({
        'source': model['source'], 'canon': [MATRIX_TAB, MATRIX_LEVEL], 'role_bits': ROLE_BITS,
        'status_map': STATUS_MAP, 'field_map': FIELD_MAP, 'masks': model['masks'],
        'ignored_creator': model['ignored_creator'],
        'tab_divergences_vs_manager': model['tab_divergences_vs_manager'],
        'admin_fields': sorted(admin_fields()),
    }, ensure_ascii=False, indent=1) + '\n')

    module_uuid = ensure_module_metadata(src_dir)
    write_text(BSL_PATH, generate_bsl(model))
    changed = register_in_extension(src_dir, module_uuid)

    print('matrix: %s, статусов %d, колонок %d' % (model['source'], len(model['statuses']), len(model['columns'])))
    print('json:   %s' % os.path.relpath(JSON_OUT, ROOT))
    print('bsl:    %s' % os.path.relpath(BSL_PATH, ROOT))
    print('uuid:   %s (в ConfigurationExtension.json %s)' % (module_uuid, 'добавлен' if changed else 'уже есть'))
    for role, d in model['tab_divergences_vs_manager'].items():
        print('расхождение вкладки %-14s с manager: %d ячеек' % (role, d['cells']))
    print('creator-ячеек (игнор, D1c): %d' % len(model['ignored_creator']))
    return 0


if __name__ == '__main__':
    sys.exit(main())

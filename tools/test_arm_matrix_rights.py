#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Тесты ACL «роль × статус × поле» (T-map + T01 + T02 wiring) для расширения АРМ v2.11.

Запуск (из корня репо, без внешних зависимостей):
    python tools/test_arm_matrix_rights.py            # все тесты
    python tools/test_arm_matrix_rights.py -v         # подробно
    python -m unittest tools.test_arm_matrix_rights   # то же через unittest

Что проверяется:
  * сгенерированный BSL Арм_МатрицаПрав == результату генератора (нет ручных правок/устаревания);
  * данные в BSL (маски, карта полей, карта статусов, биты ролей, whitelist админа) == default-matrix.js
    (независимая выкладка из сырой матрицы, ячейка за ячейкой: 15 статусов × 51 колонка × все роли);
  * известные факты матрицы и решения владельца D1/D1b/D1c/D1d/D1e, T-map (ЗаблокированоФоном = запрет);
  * согласованность с перечислениями расширения, кодами колонок и ОписаниеКолонокПоМатрице() формы;
  * проводка в Form.obj.bsl / ФормаСнабжение / регистре: серверные проверки в каждом писателе, нет «только администратор»;
  * регистрация модуля в ConfigurationExtension.json; базовая парность скобок BSL (платформы 1С здесь нет).
Тесты НЕ запускают платформу 1С: проверяется текст/данные, а не выполнение BSL.
"""
import io
import json
import os
import re
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate_arm_matrix_rights as G  # noqa: E402

ROOT = G.ROOT
EXT = G.EXT_DIR
V210 = os.path.join(ROOT, 'src', 'АРМЗакупокИПродаж_v2.10')
FORM = os.path.join(EXT, 'DataProcessor', 'АС_АРМ2', 'Form', 'Форма', 'Form.obj.bsl')
FORM_V210 = os.path.join(V210, 'DataProcessor', 'АС_АРМ2', 'Form', 'Форма', 'Form.obj.bsl')
FORM_SUPPLY = os.path.join(EXT, 'DataProcessor', 'АС_АРМ2', 'Form', 'ФормаСнабжение', 'Form.obj.bsl')
REG_RIGHTS = os.path.join(EXT, 'InformationRegister', 'Арм_ПраваПользователей', 'InformationRegister.mgr.bsl')
STATUS_ENUM_JSON = os.path.join(EXT, 'Enum', 'Арм_СтатусыАРМ', 'Enum.json')
ROLE_ENUM_JSON = os.path.join(EXT, 'Enum', 'Арм_РолиИнтерфейса', 'Enum.json')
STATUS_MAP_MD = os.path.join(ROOT, 'tasks', 'status-map-matrix-arm.md')


def read(path):
    with io.open(path, encoding='utf-8', newline='') as fh:
        return fh.read()


def read_bytes(path):
    with open(path, 'rb') as fh:
        return fh.read()


def enum_values(path):
    """Имена значений перечисления из Enum.json (v8unpack): список, у которого первый элемент — uuid блока значений."""
    data = json.load(io.open(path, encoding='utf-8'))
    values_block = 'bee0a08c-07eb-40c0-8544-5c364c171465'

    def walk(node):
        if isinstance(node, list):
            if node and node[0] == values_block:
                return node
            for ch in node:
                r = walk(ch)
                if r is not None:
                    return r
        return None
    blk = walk(data['header'])
    assert blk is not None, 'не найден блок значений перечисления ' + path
    return [it[0][1][2].strip('"') for it in blk[2:]]


def function_body(text, name):
    m = re.search(r'(?:Функция|Процедура)\s+%s\s*\([^)]*\)[^\n]*\n(.*?)\n(?:КонецФункции|КонецПроцедуры)' % re.escape(name),
                  text, re.S)
    assert m, 'не найдена процедура/функция ' + name
    return m.group(1)


def string_literals(body):
    return re.findall(r'"((?:[^"]|"")*)"', body)


def parse_generated_bsl(text):
    """Достаёт данные из BSL модуля Арм_МатрицаПрав (обратная сторона генератора)."""
    out = {}
    # маски по статусам
    body = function_body(text, 'СписокМаскСтатуса')
    parts = re.split(r'(?:Если|ИначеЕсли)\s+ИдСтатуса\s*=\s*"(\w+)"\s*Тогда', body)
    masks = {}
    for i in range(1, len(parts), 2):
        sid, chunk = parts[i], parts[i + 1]
        masks[sid] = {m.group(1): int(m.group(2)) for m in re.finditer(r'"(\w+)=(\d+);"', chunk)}
    out['masks'] = masks
    # поле -> колонка
    body = function_body(text, 'СписокПолейМатрицы')
    out['fields'] = [(m.group(1), m.group(2)) for m in re.finditer(r'"(\w+)=(\w+);"', body)]
    # роли
    body = function_body(text, 'БитРоли')
    out['roles'] = [(m.group(1), int(m.group(2))) for m in re.finditer(
        r'Арм_РолиИнтерфейса\.(\w+)"\)\s*Тогда[^\n]*\n\s*Возврат\s+(\d+);', body)]
    # статусы
    body = function_body(text, 'МатричныйСтатусПоСтатусуАРМ')
    st = []
    for m in re.finditer(r'(?:Если|ИначеЕсли)\s+(СтатусАРМ[^\n]*?)\s*Тогда\s*\n\s*Возврат\s+"(\w+)";', body):
        names = re.findall(r'Арм_СтатусыАРМ\.(\w+)"\)', m.group(1))
        st.append((m.group(2), names))
    out['statuses'] = st
    # whitelist админа
    gen = ''.join(s for s in string_literals(function_body(text, 'ПоляОбщегоВвода')))
    ext = ''.join(s for s in string_literals(function_body(text, 'ПоляИзменяемыеАдминистратором')) if s != ',')
    out['admin_generic'] = [x for x in gen.split(',') if x]
    out['admin_extra'] = [x for x in ext.split(',') if x]
    return out


def bsl_can_edit(parsed, role_enum, status_enum, field):
    """Исполняет алгоритм ОтказПоПолю на данных, разобранных из BSL (не из генератора)."""
    bit = dict(parsed['roles']).get(role_enum, 0)
    if bit == 0:
        return False
    if status_enum == G.BLOCKED_STATUS_ENUM:
        return False
    if role_enum == G.ADMIN_ENUM:
        return field in set(parsed['admin_generic']) | set(parsed['admin_extra'])
    sid = next((s for s, names in parsed['statuses'] if status_enum in names), None)
    if sid is None:
        return False
    cid = dict(parsed['fields']).get(field)
    if cid is None:
        return False
    return bool(parsed['masks'].get(sid, {}).get(cid, 0) & bit)


class MatrixCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = G.load_matrix()
        cls.model = G.build_model(cls.raw)
        cls.bsl_text = read(G.BSL_PATH)
        cls.parsed = parse_generated_bsl(cls.bsl_text)
        cls.cols = cls.raw['columns']
        cls.status_enums = enum_values(STATUS_ENUM_JSON)
        cls.role_enums = enum_values(ROLE_ENUM_JSON)

    def raw_mask(self, status_id, col_id):
        i = self.cols.index(col_id)
        return self.raw['cells'][G.MATRIX_LEVEL][G.MATRIX_TAB][status_id][i]

    def can(self, role, status, field):
        return G.can_edit(self.model, role, status, field)


# ====================================================================== генерация / формат
class TestGeneration(MatrixCase):
    def test_bsl_matches_generator(self):
        self.assertEqual(self.bsl_text, G.generate_bsl(self.model),
                         'Арм_МатрицаПрав устарел: python tools/generate_arm_matrix_rights.py')

    def test_bsl_is_crlf_without_bom(self):
        b = read_bytes(G.BSL_PATH)
        self.assertFalse(b.startswith(b'\xef\xbb\xbf'))
        self.assertEqual(b.count(b'\n'), b.count(b'\r\n'), 'смешанные окончания строк')
        self.assertGreater(b.count(b'\r\n'), 100)

    def test_matrix_canon_is_manager_order(self):
        self.assertEqual((G.MATRIX_TAB, G.MATRIX_LEVEL), ('manager', 'order'))
        self.assertEqual(self.raw['roles'], ['manager', 'storekeeper', 'chief_mechanic', 'admin', 'supplier', 'client'])
        for i, r in enumerate(self.raw['roles']):
            self.assertEqual(G.ROLE_BITS[r], 1 << i, 'бит роли %s расходится с make_default_matrix.py' % r)

    def test_bit_layout_matches_make_default_matrix(self):
        src = read(os.path.join(HERE, 'make_default_matrix.py'))
        self.assertIn("ROLES = ['manager', 'storekeeper', 'chief_mechanic', 'admin', 'supplier', 'client']", src)
        self.assertIn('code = 64 if cell.get', src)       # required = 64
        self.assertIn('code |= 128', src)                 # creator = 128
        self.assertIn('code |= 256', src)                 # admin-only = 256
        self.assertIn('code |= 63', src)                  # all = 63


# ====================================================================== данные BSL == матрица
class TestGeneratedData(MatrixCase):
    def test_all_cells_every_role_match_raw_matrix(self):
        """15 статусов × 51 колонка × 7 ролей 1С: BSL-данные == независимая выкладка из default-matrix.js."""
        checked = 0
        for sid, status_names in G.STATUS_MAP:
            for cid, field in G.FIELD_MAP:
                raw = self.raw_mask(sid, cid)
                for role_enum, rid in G.ROLE_ENUM_MAP:
                    if rid == 'admin':
                        continue     # D1e=B — отдельный тест
                    expected = bool(raw & G.ROLE_BITS[rid])
                    for st in status_names:
                        self.assertEqual(bsl_can_edit(self.parsed, role_enum, st, field), expected,
                                         '%s/%s/%s raw=%d (BSL)' % (role_enum, st, field, raw))
                        self.assertEqual(self.can(role_enum, st, field), expected,
                                         '%s/%s/%s raw=%d (ref)' % (role_enum, st, field, raw))
                        checked += 1
        self.assertGreater(checked, 4000)

    def test_masks_have_only_editor_bits(self):
        for sid, cols in self.parsed['masks'].items():
            for cid, m in cols.items():
                self.assertTrue(0 < m <= G.EDITOR_MASK, (sid, cid, m))

    def test_masks_strip_required_creator_admin_only_bits(self):
        for sid, _ in G.STATUS_MAP:
            for cid, _f in G.FIELD_MAP:
                self.assertEqual(self.parsed['masks'].get(sid, {}).get(cid, 0), self.raw_mask(sid, cid) & 63)

    def test_roles_in_bsl(self):
        self.assertEqual(self.parsed['roles'], [(en, G.ROLE_BITS[rid]) for en, rid in G.ROLE_ENUM_MAP])

    def test_field_map_in_bsl(self):
        self.assertEqual(self.parsed['fields'], [(f, c) for c, f in G.FIELD_MAP])

    def test_status_map_in_bsl(self):
        self.assertEqual(self.parsed['statuses'], G.STATUS_MAP)

    def test_admin_whitelist_in_bsl(self):
        self.assertEqual(self.parsed['admin_generic'], G.ADMIN_GENERIC_FIELDS)
        self.assertEqual(self.parsed['admin_extra'], G.ADMIN_EXTRA_FIELDS)

    def test_control_flow_order_in_bsl(self):
        """Порядок проверок в ОтказПоПолю: нет роли -> ЗаблокированоФоном -> админ -> статус -> поле -> маска."""
        body = function_body(self.bsl_text, 'ОтказПоПолю')
        marks = ['Бит = БитРоли(Роль)', 'Арм_СтатусыАРМ.ЗаблокированоФоном', 'Арм_РолиИнтерфейса.Администратор',
                 'МатричныйСтатусПоСтатусуАРМ(СтатусСтроки)', 'КолонкаМатрицыПоПолюРегистра(ИмяПоляРегистра)',
                 'ПобитовоеИ(МаскаЯчейки(ИдСтатуса, ИдКолонки), Бит)']
        pos = [body.index(m) for m in marks]
        self.assertEqual(pos, sorted(pos), 'нарушен порядок проверок ACL')
        self.assertIn('Если Бит = 0 Тогда', body)

    def test_creator_not_mapped_to_author_row(self):
        """D1c: бит creator (128) игнорируется; АвторСтроки в ACL-модуле не используется."""
        code = '\n'.join(l for l in self.bsl_text.split('\r\n') if not l.lstrip().startswith('//'))
        self.assertNotIn('АвторСтроки', code)
        self.assertNotIn('128', code)

    def test_module_is_pure_no_db(self):
        code = '\n'.join(l for l in self.bsl_text.split('\r\n') if not l.lstrip().startswith('//'))
        for bad in ('Запрос', 'РегистрыСведений', 'ПараметрыСеанса', 'Справочники.'):
            self.assertNotIn(bad, code)


# ====================================================================== T-map
class TestStatusMap(MatrixCase):
    def test_matrix_statuses_equal_status_map(self):
        self.assertEqual(self.raw['statuses'], [s for s, _ in G.STATUS_MAP])
        self.assertEqual(len(G.STATUS_MAP), 15)

    def test_every_enum_status_mapped_or_blocked(self):
        mapped = [n for _, names in G.STATUS_MAP for n in names]
        self.assertEqual(len(mapped), len(set(mapped)), 'значение enum в двух статусах матрицы')
        self.assertEqual(len(self.status_enums), 18)
        self.assertEqual(sorted(set(mapped) | {G.BLOCKED_STATUS_ENUM}), sorted(self.status_enums))
        self.assertNotIn(G.BLOCKED_STATUS_ENUM, mapped)

    def test_paired_statuses_have_identical_rights(self):
        for a, b, sid in (('Подготовлено', 'Собран', 'ready_to_ship'), ('Выполнено', 'Завершено', 'closed')):
            self.assertEqual(G.status_id_by_enum(a), sid)
            self.assertEqual(G.status_id_by_enum(b), sid)
            for role, _ in G.ROLE_ENUM_MAP:
                for _cid, f in G.FIELD_MAP:
                    self.assertEqual(self.can(role, a, f), self.can(role, b, f), (role, a, b, f))

    def test_new_statuses_copy_neighbours_as_is(self):
        """D1: in_work / partially_ordered / to_stock — как есть (копия соседей из make_default_matrix.NEW_STATUSES)."""
        for new, like in (('in_work', 'new'), ('partially_ordered', 'ordered'), ('to_stock', 'acceptance')):
            for cid, _f in G.FIELD_MAP:
                self.assertEqual(self.raw_mask(new, cid) & 63, self.raw_mask(like, cid) & 63, (new, like, cid))

    def test_status_map_md_matches_code(self):
        md = read(STATUS_MAP_MD)
        rows = re.findall(r'^\|\s*\d+\s*\|\s*`(\w+)`\s*\|[^|]*\|\s*([^|]+?)\s*\|', md, re.M)
        self.assertEqual(len(rows), 15)
        doc = [(sid, re.findall(r'`(\w+)`', cell)) for sid, cell in rows]
        self.assertEqual(doc, G.STATUS_MAP)
        self.assertIn('`ЗаблокированоФоном`', md)

    def test_unknown_or_empty_status_denied(self):
        self.assertFalse(self.can('Менеджер', 'НесуществующийСтатус', 'КомментарийКСтроке'))
        self.assertFalse(self.can('Менеджер', None, 'КомментарийКСтроке'))
        self.assertFalse(self.can('Администратор', G.BLOCKED_STATUS_ENUM, 'КомментарийКСтроке'))


# ====================================================================== перечисления и колонки
class TestSchemaConsistency(MatrixCase):
    def test_roles_enum_fully_mapped(self):
        self.assertEqual(sorted(en for en, _ in G.ROLE_ENUM_MAP), sorted(self.role_enums))

    def test_every_matrix_column_has_register_field(self):
        self.assertEqual([c for c, _ in G.FIELD_MAP].sort(), self.cols.sort())
        self.assertEqual(sorted(c for c, _ in G.FIELD_MAP), sorted(self.cols))
        fields = [f for _, f in G.FIELD_MAP]
        self.assertEqual(len(fields), len(set(fields)))
        self.assertEqual(len(G.FIELD_MAP), len(self.cols))

    def test_field_codes_match_form_column_description(self):
        """FIELD_MAP согласован с ОписаниеКолонокПоМатрице() формы и column-codes.js (код колонки одинаков)."""
        form = read(FORM)
        body = function_body(form, 'ОписаниеКолонокПоМатрице')
        by_field = {}
        for line in body.split('\n'):
            m = re.match(r'\s*\|?\s*"?\|?(\w+)\|([^|]*)\|([^|]*)\|([^|"]*)"?;?\s*$', line.replace('Возврат', '').strip())
            parts = line.strip().lstrip('"').lstrip('|').rstrip('";').split('|')
            if len(parts) >= 4 and parts[0] and re.match(r'^\w+$', parts[0]):
                by_field[parts[0]] = parts[3].strip()
            elif len(parts) == 4 + 0 and False:
                pass
        # первая строка «ОтметкаСтроки|||А1»
        self.assertEqual(by_field.get('ОтметкаСтроки'), 'А1')
        js = read(os.path.join(ROOT, 'column-codes.js'))
        by_col = {}
        for g in re.finditer(r"\{code:'(\w+)', letter:'([^']+)'(?:, parent:'\w+')?(?:, start:(\d+))?, title:'[^']*', columns:\[([^\]]*)\]", js, re.S):
            start = int(g.group(3)) if g.group(3) is not None else 1
            cols = re.findall(r"'(\w+)'", g.group(4))
            for i, c in enumerate(cols):
                by_col[c] = g.group(2) + str(start + i)
        self.assertEqual(len(by_col), len(self.cols))
        for cid, field in G.FIELD_MAP:
            self.assertIn(field, by_field, 'поле %s нет в ОписаниеКолонокПоМатрице()' % field)
            self.assertEqual(by_field[field], by_col[cid], 'код колонки %s/%s' % (cid, field))

    def test_registered_fields_exist_in_register_or_list(self):
        reg = read(os.path.join(EXT, 'InformationRegister', 'Арм_ДанныеЗакупокИПродаж', 'InformationRegister.json'))
        list_only = {'Порядок', 'НоменклатураАртикул', 'НоменклатураАС_КодАвтоАльянс', 'НоменклатураЕдиницаИзмерения',
                     'ОстатокДляСтроки', 'Сумма'}   # T05: 5 бывших заглушек теперь ресурсы регистра
        for _cid, f in G.FIELD_MAP:
            if f in list_only:
                continue
            self.assertIn('"%s"' % f, reg.replace('\\"', '"'), 'поля %s нет в метаданных регистра' % f)

    def test_admin_whitelist_matches_v210_form(self):
        """D1e=B: whitelist администратора = v2.10 (ПоляРедактируемыеАдминистратором / ПоляИзменяемыеАдминистратором)."""
        for path in (FORM_V210, FORM):
            text = read(path)
            gen = ''.join(string_literals(function_body(text, 'ПоляРедактируемыеАдминистратором')))
            ext = ''.join(s for s in string_literals(function_body(text, 'ПоляИзменяемыеАдминистратором')) if s != ',')
            self.assertEqual(gen.split(','), G.ADMIN_GENERIC_FIELDS, path)
            self.assertEqual(ext.split(','), G.ADMIN_EXTRA_FIELDS, path)

    def test_admin_fields_are_mapped_matrix_fields(self):
        mapped = {f for _, f in G.FIELD_MAP}
        self.assertTrue(G.admin_fields() <= mapped, G.admin_fields() - mapped)


# ====================================================================== факты матрицы и решения владельца
class TestMatrixFacts(MatrixCase):
    ALL_STATUSES = [n for _, names in G.STATUS_MAP for n in names]

    def test_shipment_number_never_editable(self):
        """Номер отгрузки — системное поле из РН: ни одна роль, ни один статус, в т.ч. админ."""
        for role, _ in G.ROLE_ENUM_MAP:
            for st in self.ALL_STATUSES + [G.BLOCKED_STATUS_ENUM]:
                self.assertFalse(self.can(role, st, 'НомерОтгрузки'), (role, st))
        for sid, _ in G.STATUS_MAP:
            self.assertEqual(self.raw_mask(sid, 'shipment_number') & 63, 0)

    def test_manager_can_edit_customer_in_new(self):
        self.assertTrue(self.can('Менеджер', 'Черновик', 'Покупатель'))
        self.assertTrue(self.can('Менеджер', 'ВРаботе', 'Покупатель'))
        self.assertTrue(self.can('Менеджер', 'Черновик', 'Номенклатура'))
        self.assertTrue(self.can('Менеджер', 'Черновик', 'Количество'))
        self.assertTrue(self.can('Менеджер', 'Черновик', 'Цена'))
        self.assertTrue(self.can('Менеджер', 'Черновик', 'Коэффициент'))

    def test_manager_cannot_edit_customer_after_ordered(self):
        self.assertFalse(self.can('Менеджер', 'Заказано', 'Покупатель'))
        self.assertFalse(self.can('Менеджер', 'Отгружено', 'Количество'))
        self.assertFalse(self.can('Менеджер', 'Завершено', 'Покупатель'))

    def test_manager_cannot_edit_computed_fields(self):
        for f in ('Сумма', 'Себестоимость', 'ОстатокДляСтроки', 'Порядок', 'НоменклатураАртикул'):
            for st in self.ALL_STATUSES:
                self.assertFalse(self.can('Менеджер', st, f), (st, f))

    def test_line_status_change_d2(self):
        """D2: статус строки меняют менеджер (по матрице line_status) и администратор; клиент/поставщик — нет."""
        # D2: админ — всегда (кроме ЗаблокированоФоном), остальные — по бите line_status матрицы (в форме: МожноРедактироватьПоле)
        ch = lambda r, s: (s != G.BLOCKED_STATUS_ENUM and bool(G.status_id_by_enum(s))) if r == 'Администратор' \
            else self.can(r, s, 'СтатусСтроки')
        self.assertTrue(ch('Менеджер', 'Черновик'))
        self.assertTrue(ch('Менеджер', 'ВРаботе'))
        for sid, names in G.STATUS_MAP:
            for st in names:       # менеджер — ровно по биту line_status матрицы
                self.assertEqual(ch('Менеджер', st), bool(self.raw_mask(sid, 'line_status') & 1), st)
                self.assertEqual(ch('Клиент', st), bool(self.raw_mask(sid, 'line_status') & 32), st)
        self.assertFalse(ch('Клиент', 'Черновик'))
        self.assertFalse(ch('Поставщик', 'Черновик'))
        self.assertFalse(ch('', 'Черновик'))
        for st in self.ALL_STATUSES:
            self.assertTrue(ch('Администратор', st), st)
        self.assertFalse(ch('Администратор', G.BLOCKED_STATUS_ENUM))
        # колонка line_status — не поле «общего ввода» администратора: whitelist её не содержит
        self.assertNotIn('СтатусСтроки', G.admin_fields())

    def test_client_can_edit_comment(self):
        self.assertTrue(self.can('Клиент', 'Черновик', 'КомментарийКСтроке'))
        self.assertTrue(self.can('Клиент', 'Завершено', 'КомментарийКСтроке'))
        self.assertTrue(self.can('Клиент', 'Отгружено', 'КомментарийКСтроке'))

    def test_client_cannot_edit_customer_or_price(self):
        for st in self.ALL_STATUSES:
            self.assertFalse(self.can('Клиент', st, 'Покупатель'), st)
            self.assertFalse(self.can('Клиент', st, 'Цена'), st)
            self.assertFalse(self.can('Клиент', st, 'Номенклатура'), st)

    def test_client_not_blanket_deny(self):
        """Клиент/Поставщик в матрице — не «запретить всё»: у них есть разрешённые ячейки."""
        for role in ('Клиент', 'Поставщик'):
            n = sum(self.can(role, st, f) for st in self.ALL_STATUSES for _c, f in G.FIELD_MAP)
            self.assertGreater(n, 0, role)

    def test_supplier_territory_but_not_comment_price(self):
        self.assertTrue(self.can('Поставщик', 'Черновик', 'ТерриторияОтгрузкиПоставщиком'))
        self.assertFalse(self.can('Поставщик', 'Черновик', 'Цена'))
        self.assertFalse(self.can('Поставщик', 'Черновик', 'Покупатель'))

    def test_blocked_by_background_denies_everyone_everything(self):
        """T-map: ЗаблокированоФоном — запрет всегда, включая Администратора."""
        for role, _ in G.ROLE_ENUM_MAP:
            for _cid, f in G.FIELD_MAP:
                self.assertFalse(self.can(role, G.BLOCKED_STATUS_ENUM, f), (role, f))
                self.assertFalse(bsl_can_edit(self.parsed, role, G.BLOCKED_STATUS_ENUM, f), (role, f))

    def test_no_role_denies_fail_closed(self):
        """D1b: нет записи Арм_ПраваПользователей (пустая роль / None) — отказ, поля те же."""
        for role in (None, '', 'ПустаяСсылка', 'НеизвестнаяРоль'):
            for st in self.ALL_STATUSES:
                for _cid, f in G.FIELD_MAP:
                    self.assertFalse(self.can(role, st, f), (role, st, f))
        self.assertEqual(G.role_bit_by_enum(None), 0)

    def test_supply_role_equals_storekeeper(self):
        """D1d: Снабжение = права кладовщика во всех ячейках."""
        self.assertEqual(G.role_bit_by_enum('Снабжение'), G.role_bit_by_enum('Кладовщик'))
        for st in self.ALL_STATUSES:
            for _cid, f in G.FIELD_MAP:
                self.assertEqual(self.can('Снабжение', st, f), self.can('Кладовщик', st, f), (st, f))

    def test_creator_bit_ignored(self):
        """D1c: ячейка только с битом creator (128) — запрет для всех не-админских ролей."""
        self.assertTrue(self.model['ignored_creator'], 'в матрице нет creator-ячеек — тест потерял смысл')
        for sid, cid in self.model['ignored_creator']:
            raw = self.raw_mask(sid, cid)
            field = dict(G.FIELD_MAP)[cid]
            for st in dict(G.STATUS_MAP)[sid]:
                for role, rid in G.ROLE_ENUM_MAP:
                    if rid == 'admin':
                        continue
                    self.assertEqual(self.can(role, st, field), bool(raw & G.ROLE_BITS[rid] & 63), (role, st, field))
        # конкретно: договор в «Заказано» (raw=128) менеджеру недоступен
        self.assertEqual(self.raw_mask('ordered', 'contract'), 128)
        self.assertFalse(self.can('Менеджер', 'Заказано', 'Договор'))

    def test_admin_whitelist_without_status_gate(self):
        """D1e=B: админ правит whitelist в ЛЮБОМ статусе (кроме ЗаблокированоФоном) и не правит остальное."""
        wl = G.admin_fields()
        for st in self.ALL_STATUSES:
            for _cid, f in G.FIELD_MAP:
                self.assertEqual(self.can('Администратор', st, f), f in wl, (st, f))
        self.assertTrue(self.can('Администратор', 'Завершено', 'Покупатель'))
        self.assertTrue(self.can('Администратор', 'Отгружено', 'Количество'))
        self.assertFalse(self.can('Администратор', 'Черновик', 'СтатусСтроки'))
        self.assertFalse(self.can('Администратор', 'Черновик', 'Себестоимость'))

    def test_admin_path_separate_from_matrix(self):
        """Админ не зависит от бита admin в матрице: матрица даёт ему не то же, что whitelist."""
        diffs = 0
        for sid, names in G.STATUS_MAP:
            for cid, f in G.FIELD_MAP:
                if bool(self.raw_mask(sid, cid) & G.ROLE_BITS['admin']) != self.can('Администратор', names[0], f):
                    diffs += 1
        self.assertGreater(diffs, 0)

    def test_non_admin_only_by_matrix_not_by_whitelist(self):
        """Менеджер не наследует whitelist админа: в Заказано покупатель из whitelist, но менеджеру нельзя."""
        self.assertIn('Покупатель', G.admin_fields())
        self.assertFalse(self.can('Менеджер', 'Заказано', 'Покупатель'))
        self.assertTrue(self.can('Администратор', 'Заказано', 'Покупатель'))

    def test_unknown_field_denied(self):
        for role in ('Менеджер', 'Клиент', 'Кладовщик', 'Администратор'):
            self.assertFalse(self.can(role, 'Черновик', 'НесуществующееПоле'))
            self.assertFalse(self.can(role, 'Черновик', ''))

    def test_cell_select_not_gated_note(self):
        """А1 «ОтметкаСтроки» входит в матрицу (63 в new), но отметка строк в UI ACL-проверкой не закрыта (T02 backlog)."""
        self.assertTrue(self.can('Клиент', 'Черновик', 'ОтметкаСтроки'))


# ====================================================================== проводка в BSL
def procedure_text(text, name):
    m = re.search(r'(?:^|\n)(?:Процедура|Функция)\s+%s\s*\(.*?\n(?:КонецПроцедуры|КонецФункции)' % re.escape(name), text, re.S)
    assert m, 'нет процедуры ' + name
    return m.group(0)


class TestWiring(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.form = read(FORM)
        cls.supply = read(FORM_SUPPLY)
        cls.reg = read(REG_RIGHTS)
        cls.v210 = read(FORM_V210)

    WRITERS = [
        ('ЗафиксироватьПоставщикаНаСервере', 'ДанныеСтроки.ИдентификаторЗаписи', 'Поставщик'),
        ('ЗафиксироватьВидУслугиНаСервере', 'ДанныеСтроки.ИдентификаторЗаписи', 'ВидУслуги'),
        ('ЗафиксироватьФормуОплатыНаСервере', 'ДанныеСтроки.ИдентификаторЗаписи', 'ФормаОплаты'),
        ('ЗафиксироватьПартиюНаСервере', 'ДанныеСтроки.ИдентификаторЗаписи', 'Партия'),
        ('ЗафиксироватьДоговорНаСервере', 'ДанныеСтроки.ИдентификаторЗаписи', 'Договор'),
        ('ИзменитьЦенуНаСервере', 'ДанныеСтроки.ИдентификаторЗаписи', 'Цена'),
        ('ИзменитьКоэффициентНаСервере', 'ДанныеСтроки.ИдентификаторЗаписи', 'Коэффициент'),
        ('СохранитьКомментарийВРегистр', 'ИдентификаторЗаписи', 'КомментарийКСтроке'),
        ('ИзменитьДатуОтгрузкиНаСервере', 'ДанныеСтроки.ИдентификаторЗаписи', 'ДатаОтгрузки'),
        ('СохранитьГРЗВРегистр', 'ИдентификаторЗаписи', 'ГРЗКлиента'),
        ('ИзменитьКоличествоНаСервере', 'ДанныеСтроки.ИдентификаторЗаписи', 'Количество'),
        ('ЗаписатьЗначениеВРегистрНаСервереНоменклатура', 'Идентификатор', 'Номенклатура'),
    ]

    def test_every_writer_checks_acl_before_writing(self):
        for name, id_expr, field in self.WRITERS:
            body = procedure_text(self.form, name)
            call = 'ПроверитьПравоНаПолеИлиОтказать(%s, "%s");' % (id_expr, field)
            self.assertIn(call, body, name)
            self.assertLess(body.index(call), body.index('Набор.Записать()') if 'Набор.Записать()' in body
                            else body.index('Менеджер.Записать()'), name + ': проверка должна быть до записи')
            self.assertLess(body.index(call), body.index('РегистрыСведений.Арм_ДанныеЗакупокИПродаж.Создать'), name)

    def test_writer_fields_are_matrix_fields_and_admin_whitelisted(self):
        mapped = {f for _, f in G.FIELD_MAP}
        for _n, _i, field in self.WRITERS:
            self.assertIn(field, mapped)
            self.assertIn(field, G.admin_fields(), 'админ потерял бы поле ' + field)

    def test_generic_writer_uses_acl_not_admin_only(self):
        body = procedure_text(self.form, 'ЗаписатьПолеСтрокиАРМ')
        self.assertNotIn('доступно только администратору', body)
        self.assertIn('ОтказПоПравамАРМ(ИдентификаторЗаписи, ИмяПоля)', body)
        self.assertIn('СтрНайти("," + ПоляРедактируемыеАдминистратором() + ",", "," + ИмяПоля + ",") = 0', body)
        self.assertLess(body.index('ОтказПоПравамАРМ('), body.index('Набор.Записать()'))
        self.assertIn('доступно только администратору', procedure_text(self.v210, 'ЗаписатьПолеСтрокиАРМ'))   # было в v2.10

    def test_status_gate_replaced_by_acl_in_select_handler(self):
        body = procedure_text(self.form, 'ДанныеАРМОтображениеВыбор')
        self.assertNotIn('Невозможно редактировать строку на статусе', body)
        self.assertIn('ОтказПоПравамАРМ(ДанныеСтроки.ИдентификаторЗаписи, ИмяПоляАРМ)', body)
        self.assertIn('ИмяПоляРегистраПоЭлементуАРМ(Поле.Имя)', body)
        self.assertIn('Невозможно редактировать строку на статусе', procedure_text(self.v210, 'ДанныеАРМОтображениеВыбор'))
        # ACL до диалогов ввода
        self.assertLess(body.index('ОтказПоПравамАРМ('), body.index('ПоказатьВводСтроки('))
        self.assertLess(body.index('ОтказПоПравамАРМ('), body.index('ПоказатьВводЧисла('))

    def test_non_admin_general_input_goes_through_acl(self):
        sel = procedure_text(self.form, 'ДанныеАРМОтображениеВыбор')
        self.assertIn('Если РежимАдминистратораАРМ <> Истина Тогда\r\n\t\tЕсли ОбработатьВыборАдминистратора(Поле, ДанныеСтроки) Тогда',
                      sel.replace('\n', '\r\n') if '\r\n' not in sel else sel)
        fn = procedure_text(self.form, 'ОбработатьВыборАдминистратора')
        self.assertIn('ОтказПоПравамАРМ(ДанныеСтроки.ИдентификаторЗаписи, ИмяПоля)', fn)
        self.assertLess(fn.index('ОтказПоПравамАРМ('), fn.index('ПоказатьВводЗначения('))

    def test_element_to_field_map_is_admin_whitelisted_subset(self):
        body = procedure_text(self.form, 'ИмяПоляРегистраПоЭлементуАРМ')
        fields = set(re.findall(r'Возврат "(\w+)";', body)) - {''}
        mapped = {f for _, f in G.FIELD_MAP}
        self.assertTrue(fields <= mapped, fields - mapped)
        self.assertTrue(fields <= G.admin_fields(), fields - G.admin_fields())
        # колонка без обработчика правки (номер отгрузки, суммы, заглушки) в карту не входит
        self.assertNotIn('НомерОтгрузки', fields)
        self.assertNotIn('Сумма', fields)

    def test_supply_form_write_is_guarded(self):
        body = procedure_text(self.supply, 'ИзменитьДатуПоступленияНаСервере')
        self.assertIn('ОтказПоПравамНаПолеСтроки(ДанныеСтроки.ИдентификаторЗаписи, "ДатаПоступления")', body)
        self.assertLess(body.index('ОтказПоПравамНаПолеСтроки'), body.index('Набор.Записать()'))
        self.assertIn('ДатаПоступления', dict((f, c) for c, f in G.FIELD_MAP))   # поле есть в матрице (С2)

    def test_register_strict_role_and_acl_entry(self):
        self.assertIn('Функция ПолучитьРольИнтерфейсаСтрого(', self.reg)
        strict = procedure_text(self.reg, 'ПолучитьРольИнтерфейсаСтрого')
        self.assertNotIn('Перечисления.Арм_РолиИнтерфейса.Менеджер', strict)         # D1b: нет подстановки Менеджер
        self.assertIn('Перечисления.Арм_РолиИнтерфейса.ПустаяСсылка()', strict)
        acl = procedure_text(self.reg, 'ОтказПоПравамНаПолеСтроки')
        self.assertIn('Роль = ПолучитьРольИнтерфейсаСтрого(Пользователь);', acl)
        self.assertIn('Арм_МатрицаПрав.МожноРедактироватьПоле(Роль, СтатусСтроки, ИмяПоляРегистра)', acl)
        self.assertIn('Выборка.СтатусСтроки', acl)        # статус из регистра, а не от клиента
        self.assertIn('Функция ПользователиБезПравАРМ()', self.reg)
        # «мягкая» функция для выбора формы сохранена как была (fail-open только для открытия формы, не для прав)
        soft = procedure_text(self.reg, 'ПолучитьРольИнтерфейсаПользователя')
        self.assertIn('ЗначениеПоУмолчанию = Перечисления.Арм_РолиИнтерфейса.Менеджер', soft)
        self.assertNotIn('ПолучитьРольИнтерфейсаПользователя', G.generate_bsl(G.build_model()))

    def test_status_buttons_manager_and_admin_by_acl(self):
        """T03/D2: кнопки статусов - менеджер+админ; сервер проверяет роль и статус КАЖДОЙ строки по матрице."""
        fn = procedure_text(self.form, 'УстановитьСтатусСтрокАдминистраторомНаСервере')
        old = procedure_text(self.v210, 'УстановитьСтатусСтрокАдминистраторомНаСервере')
        self.assertIn('Если Не ЭтоАдминистраторАРМ() Тогда', old)           # было: только администратор
        self.assertNotIn('ЭтоАдминистраторАРМ', fn)
        self.assertIn('Если Не РольМожетМенятьСтатусыАРМ() Тогда', fn)
        self.assertIn('Арм_МатрицаПрав.МожноРедактироватьПоле(Роль, Запись.СтатусСтроки, "СтатусСтроки")', fn)
        self.assertIn('Роль <> Перечисления.Арм_РолиИнтерфейса.Администратор', fn)     # админ — всегда
        # проверка по строке - до записи набора
        self.assertLess(fn.index('МожноРедактироватьПоле'), fn.index('Набор.Записать()'))
        role = procedure_text(self.form, 'РольМожетМенятьСтатусыАРМ')
        self.assertIn('ПолучитьРольИнтерфейсаСтрого(', role)             # D1b: без записи - нет
        self.assertIn('Перечисления.Арм_РолиИнтерфейса.Менеджер', role)
        self.assertIn('Перечисления.Арм_РолиИнтерфейса.Администратор', role)
        for bad in ('Клиент', 'Поставщик', 'Кладовщик', 'Снабжение', 'ГлавныйМеханик'):
            self.assertNotIn('Арм_РолиИнтерфейса.' + bad, role)
        # клиентская процедура больше не режет менеджера по РежимАдминистратораАРМ
        cl = procedure_text(self.form, 'УстановитьСтатусСтрокАдминистратором')
        self.assertNotIn('РежимАдминистратораАРМ', cl)
        # кнопки появляются для менеджера и админа
        self.assertIn('Если Не РольМожетМенятьСтатусыАРМ() Тогда',
                      procedure_text(self.form, 'НастроитьКомандыСтатусовАдминистратора'))
        # набор статусов прежний (3 MVP-статуса) — расширение вне объёма T03-ACL
        self.assertEqual(re.findall(r'Статусы\.Добавить\(Новый Структура\("Имя, Заголовок", "(\w+)"',
                                    procedure_text(self.form, 'НастроитьКомандыСтатусовАдминистратора')),
                         ['Резервирование', 'ОжидаемПоступление', 'Возврат'])

    def test_formulas_untouched(self):
        # ОписаниеКолонокПоМатрице в v2.11 меняется намеренно (T05: колонки НомерШасси/Резерв/В пути/Дата УПД/№ УПД)
        for name in ('ПересчитатьЦеныСтрокиАРМ', 'БазаЦеныПродажиАРМ'):
            self.assertEqual(procedure_text(self.form, name), procedure_text(self.v210, name), name)

    def test_v211_vs_v210_only_expected_files_changed(self):
        changed = []
        for dp, _dn, fn in os.walk(EXT):
            for f in fn:
                p = os.path.join(dp, f)
                rel = os.path.relpath(p, EXT)
                q = os.path.join(V210, rel)
                if not os.path.isfile(q) or read_bytes(p) != read_bytes(q):
                    changed.append(rel.replace('\\', '/'))
        expected_prefix = ('CommonModule/' + G.MODULE_NAME + '/',)
        allowed = {
            'ConfigurationExtension.json',
            'DataProcessor/АС_АРМ2/Form/Форма/Form.obj.bsl',
            'DataProcessor/АС_АРМ2/Form/ФормаСнабжение/Form.obj.bsl',
            'InformationRegister/Арм_ПраваПользователей/InformationRegister.mgr.bsl',
            # T05/T07/T08: поля регистра и вспомогательные процедуры общего модуля АРМ
            'CommonModule/Арм_ОбщегоНазначенияАРМ/CommonModule.obj.bsl',
            'InformationRegister/Арм_ДанныеЗакупокИПродаж/InformationRegister.json',
        }
        # *.elem.json - шум повторной распаковки (v8unpack) формами, которые мы не правим; ловим только код/метаданные
        unexpected = [c for c in changed if c not in allowed and not c.startswith(expected_prefix)
                      and not c.endswith('.elem.json')]
        self.assertEqual(unexpected, [], 'в v2.11 изменено больше, чем заявлено')

    # -------------------------------------------------------------- T05..T09 (v2.11 pack 2)
    def test_stub_fields_are_register_resources(self):
        reg_path = os.path.join(EXT, 'InformationRegister', 'Арм_ДанныеЗакупокИПродаж', 'InformationRegister.json')
        data = json.loads(read(reg_path))
        resources = data['header'][0][3]
        self.assertEqual(int(resources[1]), len(resources) - 2, 'счётчик ресурсов не совпадает с числом элементов')
        names = [it[0][1][1][1][2].strip('"') for it in resources[2:]]
        self.assertEqual(len(names), len(set(names)), 'дубли имён ресурсов')
        for f in ('НомерШасси', 'КоличествоВРезерве', 'КоличествоВПути', 'ДатаУПД', 'НомерУПД'):
            self.assertIn(f, names)
            self.assertIn(f, {x for _, x in G.FIELD_MAP})
        uuids = []
        for it in resources[2:]:
            uuids.append(it[0][1][1][1][1][2])
        self.assertEqual(len(uuids), len(set(uuids)), 'дубли идентификаторов ресурсов')

    def test_acl_input_fields_consistent(self):
        expected = ['НомерШасси', 'КоличествоВРезерве', 'КоличествоВПути', 'ДатаУПД', 'НомерУПД']
        self.assertEqual(G.ACL_INPUT_FIELDS, expected)
        form_fn = ''.join(string_literals(function_body(self.form, 'ПоляВводаПоACL')))
        self.assertEqual(form_fn.split(','), expected)
        mod = read(os.path.join(EXT, 'CommonModule', G.MODULE_NAME, 'CommonModule.obj.bsl'))
        mod_fn = ''.join(string_literals(function_body(mod, 'ПоляВводаПоACL')))
        self.assertEqual(mod_fn.split(','), expected)
        self.assertFalse(set(expected) & set(G.admin_fields()), 'D1e=B: whitelist админа не расширяем')
        names = '\n'.join(procedure_text(self.form, n) for n in ('ОбработатьВыборАдминистратора', 'ЗаписатьПолеСтрокиАРМ'))
        self.assertIn('ПоляВводаПоACL()', names)

    def test_stub_columns_are_editable_regular_columns(self):
        desc = procedure_text(self.form, 'ОписаниеКолонокПоМатрице')
        for line in ('|НомерШасси|', '|КоличествоВРезерве|', '|КоличествоВПути|', '|ДатаУПД|', '|НомерУПД|'):
            self.assertIn(line, desc)
        self.assertNotIn('Заглушка', desc)

    def test_upd_from_pn_is_runtime_checked(self):
        oan = read(os.path.join(EXT, 'CommonModule', 'Арм_ОбщегоНазначенияАРМ', 'CommonModule.obj.bsl'))
        fn = procedure_text(oan, 'ЗаполнитьУПДИзПриходнойЕслиЕсть')
        self.assertIn('Метаданные.Документы', fn)            # реквизит ищется в метаданных, не жёстко
        self.assertEqual(oan.count('ЗаполнитьУПДИзПриходнойЕслиЕсть(ЗаписьПН)'), 2)   # два места привязки ПН

    def test_a3_toggle_non_admin_path(self):
        """T06: А3 правится не-админом через ACL; Истина чистит автора и отметку без привязки к роли."""
        self.assertIn('ДокументПодписанОригинал', G.ADMIN_GENERIC_FIELDS)
        body = procedure_text(self.form, 'ЗаписатьПолеСтрокиАРМ')
        i = body.index('ДокументПодписанОригинал')
        self.assertIn('АвторСтроки', body[i:])
        self.assertIn('ОтметкаСтроки', body[i:])
        model = G.build_model()
        f = 'ДокументПодписанОригинал'
        for role in ('Менеджер', 'Кладовщик', 'Снабжение', 'ГлавныйМеханик'):
            for st in ('Отгружено', 'Возврат'):
                self.assertTrue(G.can_edit(model, role, st, f), (role, st))
            self.assertFalse(G.can_edit(model, role, 'Черновик', f), role)
        for role in ('Клиент', 'Поставщик', ''):
            self.assertFalse(G.can_edit(model, role, 'Отгружено', f), role)

    def test_required_validation_ui_only(self):
        for name in ('СтатусКонтроляОбязательныхАРМ', 'НезаполненныеОбязательныеПоляАРМ', 'ОтказОчисткиОбязательногоПоляАРМ'):
            procedure_text(self.form, name)
        fn = procedure_text(self.form, 'УстановитьСтатусСтрокАдминистраторомНаСервере')
        self.assertIn('НезаполненныеОбязательныеПоляАРМ', fn)
        self.assertNotIn('ЭтоАдминистраторАРМ', fn)
        self.assertIn('ОтказОчисткиОбязательногоПоляАРМ', procedure_text(self.form, 'ЗаписатьПолеСтрокиАРМ'))
        # документные модули/фон/общие модули валидацию не вызывают
        for dp, _dn, fns in os.walk(EXT):
            for f in fns:
                if f.endswith('.bsl') and os.path.join(dp, f) != FORM:
                    self.assertNotIn('НезаполненныеОбязательныеПоляАРМ', read(os.path.join(dp, f)), f)

    def test_units_list_matches_index_html(self):
        fn = ''.join(string_literals(function_body(self.form, 'СписокЕдиницИзмеренияАРМ')))
        self.assertEqual(fn.split(','), ['шт', 'компл', 'л', 'кг', 'м', 'н/ч'])
        html = read(os.path.join(ROOT, 'index.html'))
        for u in fn.split(','):
            self.assertIn(u, html)
        sel = procedure_text(self.form, 'ОбработатьВыборАдминистратора')
        self.assertIn('ПоказатьВыборИзСписка', sel)
        self.assertIn('ПослеВыбораЕдиницыИзмерения', sel)
        self.assertIn('Процедура ПослеВыбораЕдиницыИзмерения(', self.form)

    def test_supply_status_chain_is_role_gated(self):
        oan = read(os.path.join(EXT, 'CommonModule', 'Арм_ОбщегоНазначенияАРМ', 'CommonModule.obj.bsl'))
        chain = procedure_text(oan, 'ИзменитьСтатусыВРегистреСнабжения')
        self.assertIn('ОтказРолиСнабжения()', chain)
        fn = procedure_text(oan, 'ОтказРолиСнабжения')
        self.assertIn('ПолучитьРольИнтерфейсаСтрого(', fn)
        for r in ('Менеджер', 'Снабжение', 'Кладовщик', 'Администратор'):
            self.assertIn('Арм_РолиИнтерфейса.' + r, fn)
        for bad in ('Клиент', 'Поставщик', 'ГлавныйМеханик'):
            self.assertNotIn('Арм_РолиИнтерфейса.' + bad, fn)

    def test_supply_form_marks_are_role_gated(self):
        # T07: отметки строк на ФормаСнабжение - гейт ролей до любой записи в регистр
        for name in ('ИнвертироватьФлагНаСервере', 'ВыделитьВсеСтрокиЗаказаНаСервере'):
            body = procedure_text(self.supply, name)
            self.assertIn('Арм_ОбщегоНазначенияАРМ.ОтказРолиСнабжения()', body, name)
            self.assertLess(body.index('ОтказРолиСнабжения'), body.index('Записать()'), name)

    def test_seed_has_prod_guard(self):
        ps = read(os.path.join(ROOT, 'seed-1c.ps1'))
        self.assertIn('[switch]$AllowProd', ps)
        self.assertIn('1c_bases', ps)
        self.assertIn('throw', ps[ps.index('1c_bases'):])
        self.assertNotRegex(ps, r'(?i)password\s*=\s*[\'"][^\'"]+[\'"]')   # нет вшитых паролей

    def test_no_bare_lf_in_changed_bsl(self):
        for path in (FORM, FORM_SUPPLY, REG_RIGHTS,
                     os.path.join(EXT, 'CommonModule', 'Арм_ОбщегоНазначенияАРМ', 'CommonModule.obj.bsl'),
                     os.path.join(EXT, 'CommonModule', G.MODULE_NAME, 'CommonModule.obj.bsl')):
            b = read_bytes(path)
            self.assertEqual(b.count(b'\n'), b.count(b'\r\n'), 'голый LF в ' + path)


# ====================================================================== регистрация и синтаксис
COMMON_MODULE_CLASS = '0fe48980-252d-11d6-a3c7-0050bae0a776'


def find_module_list(node):
    """Список общих модулей расширения: [classUuid, count, uuid...]."""
    if isinstance(node, list):
        if node and node[0] == COMMON_MODULE_CLASS and len(node) >= 2 and str(node[1]).isdigit():
            return node
        for ch in node:
            r = find_module_list(ch)
            if r is not None:
                return r
    elif isinstance(node, dict):
        for ch in node.values():
            r = find_module_list(ch)
            if r is not None:
                return r
    return None


class TestRegistrationAndSyntax(unittest.TestCase):
    def test_module_registered_in_extension(self):
        ext = json.load(io.open(G.EXT_JSON, encoding='utf-8'))
        lst = find_module_list(ext['header'])
        self.assertIsNotNone(lst)
        ids = lst[2:]
        self.assertEqual(int(lst[1]), len(ids))
        new = json.load(io.open(os.path.join(G.MODULE_DIR, 'CommonModule.id.json'), encoding='utf-8'))['uuid']
        self.assertIn(new, ids)
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(ids), 3)
        # uuid уникален среди всех *.id.json расширения
        seen = 0
        for dp, _dn, fn in os.walk(EXT):
            for f in fn:
                if f.endswith('.id.json'):
                    if json.load(io.open(os.path.join(dp, f), encoding='utf-8')).get('uuid') == new:
                        seen += 1
        self.assertEqual(seen, 1)

    def test_module_metadata(self):
        meta = json.load(io.open(os.path.join(G.MODULE_DIR, 'CommonModule.json'), encoding='utf-8'))
        self.assertEqual(meta['name'], G.MODULE_NAME)
        self.assertEqual(meta['name2']['ru'], G.MODULE_SYNONYM)
        self.assertIn('"%s"' % G.MODULE_NAME, json.dumps(meta, ensure_ascii=False))
        self.assertNotIn('ДанныеЗакупокИПродажФон', json.dumps(meta, ensure_ascii=False))
        # те же флаги, что у Арм_ДанныеЗакупокИПродажФон (серверный модуль без привилегий)
        tpl = json.load(io.open(os.path.join(EXT, 'CommonModule', 'Арм_ДанныеЗакупокИПродажФон', 'CommonModule.json'), encoding='utf-8'))
        norm = lambda h: [h[1][:2] + h[1][4:]] + h[2:]        # без имени и синонима
        self.assertEqual(norm(meta['header'][0][1]), norm(tpl['header'][0][1]))

    @staticmethod
    def strip(text):
        text = re.sub(r'"(?:[^"\n]|"")*"', '""', text)             # строки
        text = re.sub(r'//[^\n]*', '', text)                       # комментарии
        return text

    def balance(self, path):
        t = self.strip(read(path))
        c = lambda pat: len(re.findall(pat, t, re.I))
        res = {
            'Процедура': (c(r'(?<![\w.])Процедура(?!\w)'), c(r'(?<![\w.])КонецПроцедуры(?!\w)')),
            'Функция': (c(r'(?<![\w.])Функция(?!\w)'), c(r'(?<![\w.])КонецФункции(?!\w)')),
            'Если': (c(r'(?<![\w.])(?<!Иначе)Если(?!\w)'), c(r'(?<![\w.])КонецЕсли(?!\w)')),
            'Цикл': (c(r'(?<![\w.])Цикл(?!\w)'), c(r'(?<![\w.])КонецЦикла(?!\w)')),
            'Попытка': (c(r'(?<![\w.])Попытка(?!\w)'), c(r'(?<![\w.])КонецПопытки(?!\w)')),
            'Область': (c(r'#Область'), c(r'#КонецОбласти')),
        }
        for k, (a, b) in res.items():
            self.assertEqual(a, b, '%s: открывающих %d, закрывающих %d в %s' % (k, a, b, path))
        # круглые скобки
        self.assertEqual(t.count('('), t.count(')'), 'скобки в ' + path)

    def test_bsl_blocks_balanced(self):
        for p in (G.BSL_PATH, FORM, FORM_SUPPLY, REG_RIGHTS):
            self.balance(p)

    def test_balance_check_detects_breakage(self):
        """Самопроверка: ломаем текст — проверка парности обязана упасть."""
        broken = read(G.BSL_PATH).replace('КонецЕсли;', '', 1)
        tmp = os.path.join(HERE, '_tmp_broken.bsl')
        try:
            io.open(tmp, 'w', encoding='utf-8', newline='').write(broken)
            with self.assertRaises(AssertionError):
                self.balance(tmp)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    def test_no_forbidden_artifacts(self):
        """T01: нет обращения к process-api / LoadCfg в генераторе и модуле."""
        for p in (G.BSL_PATH, os.path.join(HERE, 'generate_arm_matrix_rights.py')):
            t = read(p)
            self.assertNotIn('LoadCfg', t.replace('LoadCfg на боевую', ''))
            self.assertNotIn('process-api', t)


if __name__ == '__main__':
    unittest.main(verbosity=2 if '-v' in sys.argv else 1, argv=[a for a in sys.argv if a != '-v'])

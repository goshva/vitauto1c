# -*- coding: utf-8 -*-
"""Тесты стандартного интерфейса OData 1С (публикация с расширением АРМ_OData): запросы и ответы.

Каждый тест — ожидаемое поведение OData v3 (как его описывает 1С). Упавший тест = то, что не работает.
Пишущие тесты меняют только своё (элемент «OData-тест …» в Арм_ВидыУслуги, временная строка АРМ) и убирают за собой.

    python odata/test_odata.py                 # http://127.0.0.1:8090/odata215, «Админ» без пароля
    set ODATA_URL=http://127.0.0.1:8090/odata215 & set ODATA_USER=Админ & set ODATA_PASSWORD= & python odata/test_odata.py
    python odata/test_odata.py -k Filter       # только тесты с Filter в имени

Отчёт — odata/test-odata-report.md (что прошло, что нет, с запросом и ответом).
Нужна база с данными seed (заказы SEED-309-*) — tools: seed-1c.ps1 -IbDir <база>.
"""
import base64
import datetime
import io
import json
import os
import re
import sys
import time
import unittest
import uuid
from urllib.parse import quote, unquote

import requests

BASE = os.environ.get('ODATA_URL', 'http://127.0.0.1:8090/odata215').rstrip('/') + '/odata/standard.odata'
USER = os.environ.get('ODATA_USER', 'Админ')
PASSWORD = os.environ.get('ODATA_PASSWORD', '')
REPORT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test-odata-report.md')
TIMEOUT = 300

ARM = 'InformationRegister_Арм_ДанныеЗакупокИПродаж'
ARM_KEYS = ['ДокументЗаказПокупателя_Key', 'ДокументЗаказПоставщика_Key', 'ДокументПриходнаяНакладная_Key',
            'КлючСвязиСтрок', 'ВидОперации', 'ИдентификаторЗаписи', 'РучнаяПравка', 'НомерЗаказаКлиента']
EMPTY = '00000000-0000-0000-0000-000000000000'

LOG = []          # (тест, метод, url, статус, мс, фрагмент ответа)


def auth_header(user=USER, password=PASSWORD):
    return 'Basic ' + base64.b64encode(('%s:%s' % (user, password)).encode('utf-8')).decode()


def url(path, query=None):
    u = BASE + '/' + quote(path, safe="/()$,=':")
    if query:
        u += '?' + quote(query, safe="$=&'(),:/")
    return u


def call(method, path, query=None, body=None, auth=True, headers=None, test=None):
    h = {'Accept': 'application/json'}
    if auth is True:
        h['Authorization'] = auth_header()
    elif auth:
        h['Authorization'] = auth
    if body is not None:
        h['Content-Type'] = 'application/json; charset=utf-8'
    h.update(headers or {})
    u = url(path, query)
    t0 = time.time()
    r = requests.request(method, u, headers=h, timeout=TIMEOUT,
                         data=None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8'))
    ms = int((time.time() - t0) * 1000)
    r.encoding = 'utf-8'
    LOG.append((test or '', method, unquote(u.replace(BASE, '')), r.status_code, ms, re.sub(r'\s+', ' ', r.text)[:220]))
    return r


def js(r):
    try:
        return r.json()
    except ValueError:
        return None


def key_of(rec):
    """Ключ записи независимого регистра сведений: все измерения."""
    parts = []
    for k in ARM_KEYS:
        v = rec[k]
        if k.endswith('_Key'):
            parts.append("%s=guid'%s'" % (k, v))
        elif isinstance(v, bool):
            parts.append('%s=%s' % (k, str(v).lower()))
        else:
            parts.append("%s='%s'" % (k, str(v).replace("'", "''")))
    return '(' + ','.join(parts) + ')'


class OData(unittest.TestCase):
    maxDiff = None

    def get(self, path, query=None, **kw):
        return call('GET', path, query, test=self.id().split('.')[-1], **kw)

    def req(self, method, path, query=None, body=None, **kw):
        return call(method, path, query, body, test=self.id().split('.')[-1], **kw)

    def ok(self, r, codes=(200,)):
        self.assertIn(r.status_code, codes, 'HTTP %s: %s' % (r.status_code, r.text[:400]))
        return js(r)

    @classmethod
    def arm_rows(cls):
        if not hasattr(OData, '_rows'):
            r = call('GET', ARM, '$format=json', test='(подготовка)')
            OData._rows = (js(r) or {}).get('value', [])
        return OData._rows


# ---------------------------------------------------------------- 1. сервис, $metadata, авторизация
class T1Service(OData):
    def test_service_document(self):
        d = self.ok(self.get('', '$format=json'))
        names = [x['name'] for x in d['value']]
        self.assertGreater(len(names), 4000)
        for s in (ARM, 'InformationRegister_Арм_ПраваПользователей', 'Catalog_Арм_ВидыУслуги', 'Catalog_Арм_ФормыОплаты'):
            self.assertIn(s, names)

    def test_metadata_xml(self):
        r = self.get('$metadata')
        self.ok(r)
        self.assertIn('xml', r.headers.get('Content-Type', ''))
        for t in ('<EntityType Name="%s"' % ARM, '<EnumType Name="Арм_СтатусыАРМ"', '<EnumType Name="Арм_ВидыОпераций"'):
            self.assertIn(t, r.text)

    def test_atom_xml_format(self):
        r = self.get('Catalog_Арм_ВидыУслуги', '$format=atom')
        self.ok(r)
        self.assertIn('atom', r.headers.get('Content-Type', ''))

    def test_json_utf8_cyrillic(self):
        d = self.ok(self.get('Catalog_Арм_ВидыУслуги', "$format=json&$filter=Description eq 'Ремонт'"))
        self.assertEqual([x['Description'] for x in d['value']], ['Ремонт'])

    def test_no_auth_401(self):
        self.assertEqual(self.get('Catalog_Арм_ВидыУслуги', '$format=json', auth=False).status_code, 401)

    def test_wrong_password_401(self):
        r = self.get('Catalog_Арм_ВидыУслуги', '$format=json', auth=auth_header(USER, 'неверный-пароль'))
        self.assertEqual(r.status_code, 401)

    def test_unknown_entity_404_with_odata_error(self):
        r = self.get('Catalog_НетТакого', '$format=json')
        self.assertEqual(r.status_code, 404)
        self.assertIn('odata.error', js(r) or {})

    def test_bad_filter_400(self):
        self.assertEqual(self.get(ARM, '$format=json&$filter=Количество eqq 1').status_code, 400)


# ---------------------------------------------------------------- 2. параметры запроса на строках АРМ
class T2Query(OData):
    def test_count_matches_collection(self):
        r = self.get(ARM + '/$count')
        self.ok(r)
        n = int(r.text.strip().lstrip('﻿'))
        self.assertEqual(n, len(self.arm_rows()))
        self.assertGreater(n, 0, 'в базе нет строк АРМ — запустите seed-1c.ps1')

    def test_inlinecount(self):
        d = self.ok(self.get(ARM, '$format=json&$top=2&$inlinecount=allpages'))
        self.assertEqual(int(d.get('odata.count', -1)), len(self.arm_rows()))
        self.assertEqual(len(d['value']), 2)

    def test_top_skip_paging(self):
        a = self.ok(self.get(ARM, '$format=json&$orderby=ИдентификаторЗаписи&$top=10'))['value']
        p1 = self.ok(self.get(ARM, '$format=json&$orderby=ИдентификаторЗаписи&$top=5'))['value']
        p2 = self.ok(self.get(ARM, '$format=json&$orderby=ИдентификаторЗаписи&$top=5&$skip=5'))['value']
        self.assertEqual([x['ИдентификаторЗаписи'] for x in a], [x['ИдентификаторЗаписи'] for x in p1 + p2])

    def test_select_only_requested(self):
        d = self.ok(self.get(ARM, '$format=json&$top=3&$select=НоменклатураКлиента,Количество'))
        for row in d['value']:
            self.assertLessEqual(set(row) - {'odata.metadata'}, {'НоменклатураКлиента', 'Количество'})

    def test_orderby_desc(self):
        v = [x['Количество'] for x in self.ok(self.get(ARM, '$format=json&$orderby=Количество desc&$select=Количество'))['value']]
        self.assertEqual(v, sorted(v, reverse=True))

    def test_filter_string_eq(self):
        d = self.ok(self.get(ARM, "$format=json&$filter=НомерЗаказаКлиента eq 'SEED-309-1'&$select=НомерЗаказаКлиента"))
        self.assertEqual(len(d['value']), 8)

    def test_filter_enum(self):
        d = self.ok(self.get(ARM, "$format=json&$filter=СтатусСтроки eq 'Черновик'&$select=СтатусСтроки"))
        self.assertTrue(d['value'])
        self.assertTrue(all(x['СтатусСтроки'] == 'Черновик' for x in d['value']))

    def test_filter_number_gt(self):
        d = self.ok(self.get(ARM, '$format=json&$filter=Количество gt 100&$select=Количество'))
        self.assertTrue(d['value'] and all(x['Количество'] > 100 for x in d['value']))

    def test_filter_and_or(self):
        d = self.ok(self.get(ARM, "$format=json&$filter=(СтатусСтроки eq 'Черновик' or СтатусСтроки eq 'Возврат') and Количество gt 0"
                                  "&$select=СтатусСтроки,Количество"))
        self.assertTrue(d['value'] and all(x['СтатусСтроки'] in ('Черновик', 'Возврат') for x in d['value']))

    def test_filter_substringof(self):
        # 1С сравнивает строки без учёта регистра (как в языке запросов): «Антифриз» находит и «антифриз»
        d = self.ok(self.get(ARM, "$format=json&$filter=substringof('Антифриз', НоменклатураКлиента)&$select=НоменклатураКлиента"))
        self.assertTrue(d['value'] and all('антифриз' in x['НоменклатураКлиента'].lower() for x in d['value']))

    def test_filter_functions_odata_v3(self):
        """Функции $filter OData v3: каждая — подтест; неподдерживаемая = HTTP 400 «не поддерживается»."""
        cases = {
            'startswith': "startswith(НоменклатураКлиента, 'Антифриз')",
            'endswith': "endswith(НоменклатураКлиента, 'PILOTS')",
            'substringof': "substringof('PILOTS', НоменклатураКлиента)",
            'indexof': "indexof(НоменклатураКлиента, 'PILOTS') ge 0",
            'length': 'length(НоменклатураКлиента) gt 5',
            'tolower': "tolower(НоменклатураКлиента) eq 'антифриз'",
            'toupper': "toupper(НоменклатураКлиента) eq 'АНТИФРИЗ'",
            'trim': "trim(НоменклатураКлиента) eq 'антифриз'",
            'concat': "concat(НоменклатураКлиента, 'x') eq 'антифризx'",
            'substring': "substring(НоменклатураКлиента, 0, 3) eq 'Ант'",
            'replace': "replace(НоменклатураКлиента, 'а', 'о') eq 'онтифриз'",
            'year': 'year(ДатаЗаказа) eq 2026',
            'month': 'month(ДатаЗаказа) eq 10',
            'day': 'day(ДатаЗаказа) eq 2',
            'hour': 'hour(ДатаЗаказа) eq 0',
            'round': 'round(Цена) ge 0',
            'floor': 'floor(Цена) ge 0',
            'ceiling': 'ceiling(Цена) ge 0',
            'add/mul (арифметика)': 'Количество mul 2 gt Количество add 1',
            'not': "not (СтатусСтроки eq 'Черновик')",
        }
        for name, f in cases.items():
            with self.subTest(функция=name):
                r = self.get(ARM, '$format=json&$top=1&$select=НоменклатураКлиента&$filter=' + f)
                self.assertEqual(r.status_code, 200, '%s: HTTP %s %s' % (name, r.status_code, (js(r) or {}).get('odata.error', {}).get('message', {}).get('value', r.text[:200])))

    def test_filter_like(self):
        d = self.ok(self.get(ARM, "$format=json&$filter=like(НомерЗаказаКлиента, 'SEED-309-%')&$select=НомерЗаказаКлиента"))
        self.assertEqual(len(d['value']), len(self.arm_rows()))

    def test_filter_datetime(self):
        d = self.ok(self.get(ARM, "$format=json&$filter=ДатаЗаказа eq datetime'2026-10-02T00:00:00'&$select=ДатаЗаказа"))
        self.assertTrue(d['value'])

    def test_filter_guid(self):
        g = next(x['Номенклатура_Key'] for x in self.arm_rows() if x['Номенклатура_Key'] != EMPTY)
        d = self.ok(self.get(ARM, "$format=json&$filter=Номенклатура_Key eq guid'%s'&$select=Номенклатура_Key" % g))
        self.assertTrue(d['value'] and all(x['Номенклатура_Key'] == g for x in d['value']))

    def test_filter_boolean(self):
        d = self.ok(self.get(ARM, '$format=json&$filter=Удаление eq false&$select=Удаление'))
        self.assertEqual(len(d['value']), len(self.arm_rows()))

    def test_filter_navigation_property(self):
        d = self.ok(self.get(ARM, "$format=json&$filter=Номенклатура/Description eq 'Дефектовка'&$select=НоменклатураКлиента"))
        self.assertTrue(d['value'])

    def test_expand_navigation(self):
        d = self.ok(self.get(ARM, "$format=json&$top=1&$filter=Номенклатура_Key ne guid'%s'&$expand=Номенклатура&$select=Номенклатура/Description" % EMPTY))
        self.assertTrue(d['value'][0].get('Номенклатура', {}).get('Description'))


# ---------------------------------------------------------------- 3. доступ по ключу, навигация, табличные части
class T3Keys(OData):
    def test_register_record_by_composite_key(self):
        rec = self.arm_rows()[0]
        d = self.ok(self.get(ARM + key_of(rec), '$format=json'))
        self.assertEqual(d['ИдентификаторЗаписи'], rec['ИдентификаторЗаписи'])

    def test_catalog_by_guid(self):
        g = next(x['Номенклатура_Key'] for x in self.arm_rows() if x['Номенклатура_Key'] != EMPTY)
        d = self.ok(self.get("Catalog_Номенклатура(guid'%s')" % g, '$format=json'))
        self.assertEqual(d['Ref_Key'], g)

    def test_navigation_path(self):
        g = next(x['Номенклатура_Key'] for x in self.arm_rows() if x['Номенклатура_Key'] != EMPTY)
        d = self.ok(self.get("Catalog_Номенклатура(guid'%s')/ЕдиницаИзмерения" % g, '$format=json'))
        self.assertIn('Description', d)

    def test_document_with_tabular_section(self):
        g = self.arm_rows()[0]['ДокументЗаказПокупателя_Key']
        d = self.ok(self.get("Document_ЗаказПокупателя(guid'%s')" % g, '$format=json'))
        self.assertIsInstance(d.get('Запасы'), list)
        self.assertTrue(d['Запасы'])

    def test_expand_single_entity(self):
        """$expand у одиночной сущности (по ключу) — в коллекции работает; 1С: 501 «не поддерживается»."""
        g = self.arm_rows()[0]['ДокументЗаказПокупателя_Key']
        self.ok(self.get("Document_ЗаказПокупателя(guid'%s')" % g, '$format=json&$expand=Контрагент&$select=Number,Контрагент/Description'))

    def test_tabular_section_set(self):
        g = self.arm_rows()[0]['ДокументЗаказПокупателя_Key']
        d = self.ok(self.get('Document_ЗаказПокупателя_Запасы', "$format=json&$filter=Ref_Key eq guid'%s'" % g))
        self.assertTrue(d['value'])

    def test_document_journal(self):
        d = self.ok(self.get('', '$format=json'))
        journals = [x['name'] for x in d['value'] if x['name'].startswith('DocumentJournal_')]
        self.assertTrue(journals)
        self.ok(self.get(journals[0], '$format=json&$top=1'))

    def test_constant(self):
        d = self.ok(self.get('', '$format=json'))
        const = next(x['name'] for x in d['value'] if x['name'].startswith('Constant_'))
        self.ok(self.get(const, '$format=json'))


# ---------------------------------------------------------------- 4. функции регистров и документов
class T4Functions(OData):
    def test_info_register_slice_last(self):
        self.ok(self.get('InformationRegister_ЦеныНоменклатуры/SliceLast()', '$format=json'))

    def test_info_register_slice_last_on_date(self):
        self.ok(self.get("InformationRegister_ЦеныНоменклатуры/SliceLast(Period=datetime'2026-10-13T00:00:00')", '$format=json'))

    def test_accumulation_balance(self):
        self.ok(self.get('AccumulationRegister_Запасы/Balance()', '$format=json'))

    def test_accumulation_turnovers(self):
        self.ok(self.get('AccumulationRegister_Запасы/Turnovers()', '$format=json'))

    def test_accumulation_balance_and_turnovers(self):
        self.ok(self.get('AccumulationRegister_Запасы/BalanceAndTurnovers()', '$format=json'))

    def _order(self):
        return self.arm_rows()[0]['ДокументЗаказПокупателя_Key']

    def test_seed_order_postable(self):
        """Заказ покупателя из seed можно провести: организация и номенклатура в строках «Запасы» заполнены.
        (seed пишет номенклатуру только в строки АРМ — в документе она пустая, проведение падает)"""
        d = self.ok(self.get("Document_ЗаказПокупателя(guid'%s')" % self._order(), '$format=json'))
        problems = []
        if d['Организация_Key'] == EMPTY:
            problems.append('пустая Организация')
        # Номенклатура в «Запасы» — составного типа: в OData поле «Номенклатура» (+ «Номенклатура_Type»)
        empty = [x['LineNumber'] for x in d['Запасы'] if x.get('Номенклатура_Key', x.get('Номенклатура')) in (EMPTY, None, '')]
        if empty:
            problems.append('пустая Номенклатура в строках Запасы: %d из %d' % (len(empty), len(d['Запасы'])))
        self.assertFalse(problems, 'заказ seed не проводится: ' + '; '.join(problems))

    def test_document_post_action(self):
        """Post(): вызов доходит до обработки проведения 1С — 200 или ошибка самой обработки проведения (данные)."""
        doc = "Document_ЗаказПокупателя(guid'%s')" % self._order()
        r = self.req('POST', doc + '/Post()', '$format=json')
        msg = ((js(r) or {}).get('odata.error', {}).get('message', {}) or {}).get('value', '')
        self.assertTrue(r.status_code in (200, 204) or (r.status_code == 500 and 'ОбработкаПроведения' in msg),
                        'HTTP %s: %s' % (r.status_code, msg or r.text[:300]))

    def test_document_unpost_action(self):
        doc = "Document_ЗаказПокупателя(guid'%s')" % self._order()
        self.ok(self.req('POST', doc + '/Unpost()', '$format=json'), (200, 204))
        self.assertFalse(self.ok(self.get(doc, '$format=json&$select=Posted'))['Posted'])


# ---------------------------------------------------------------- 5. запись: справочник, регистр АРМ
class T5Write(OData):
    def test_catalog_create_update_delete(self):
        name = 'OData-тест ' + uuid.uuid4().hex[:6]
        r = self.req('POST', 'Catalog_Арм_ВидыУслуги', '$format=json', {'Description': name})
        d = self.ok(r, (200, 201))
        g = d['Ref_Key']
        try:
            self.assertEqual(self.ok(self.get("Catalog_Арм_ВидыУслуги(guid'%s')" % g, '$format=json'))['Description'], name)
            self.ok(self.req('PATCH', "Catalog_Арм_ВидыУслуги(guid'%s')" % g, '$format=json', {'Description': name + ' изм'}), (200, 204))
            self.assertEqual(self.ok(self.get("Catalog_Арм_ВидыУслуги(guid'%s')" % g, '$format=json'))['Description'], name + ' изм')
            self.ok(self.req('PATCH', "Catalog_Арм_ВидыУслуги(guid'%s')" % g, '$format=json', {'DeletionMark': True}), (200, 204))
        finally:
            self.req('DELETE', "Catalog_Арм_ВидыУслуги(guid'%s')" % g)
        self.assertEqual(self.get("Catalog_Арм_ВидыУслуги(guid'%s')" % g, '$format=json').status_code, 404)

    def test_arm_register_patch_and_restore(self):
        rec = self.arm_rows()[1]
        k = key_of(rec)
        was = rec['КомментарийКСтроке2']
        try:
            self.ok(self.req('PATCH', ARM + k, '$format=json', {'КомментарийКСтроке2': 'OData-тест'}), (200, 204))
            self.assertEqual(self.ok(self.get(ARM + k, '$format=json'))['КомментарийКСтроке2'], 'OData-тест')
        finally:
            self.req('PATCH', ARM + k, '$format=json', {'КомментарийКСтроке2': was})

    def test_arm_register_patch_enum_and_number(self):
        rec = self.arm_rows()[2]
        k = key_of(rec)
        try:
            self.ok(self.req('PATCH', ARM + k, '$format=json', {'СтатусСтроки': 'Возврат', 'Количество': 7}), (200, 204))
            d = self.ok(self.get(ARM + k, '$format=json'))
            self.assertEqual((d['СтатусСтроки'], d['Количество']), ('Возврат', 7))
        finally:
            self.req('PATCH', ARM + k, '$format=json', {'СтатусСтроки': rec['СтатусСтроки'], 'Количество': rec['Количество']})

    def test_arm_register_post_and_delete_record(self):
        src = self.arm_rows()[0]
        rec = {k: v for k, v in src.items() if not k.startswith('odata.') and '@' not in k and not k.endswith('_Type')}
        rec['ИдентификаторЗаписи'] = str(uuid.uuid4())
        rec['КлючСвязиСтрок'] = str(uuid.uuid4())
        rec['КомментарийКСтроке2'] = 'OData-тест: временная строка'
        r = self.req('POST', ARM, '$format=json', rec)
        try:
            self.ok(r, (200, 201))
            self.ok(self.get(ARM + key_of(rec), '$format=json'))
        finally:
            dr = self.req('DELETE', ARM + key_of(rec))
        self.assertIn(dr.status_code, (200, 204))
        self.assertEqual(self.get(ARM + key_of(rec), '$format=json').status_code, 404)

    def test_patch_unknown_field_400(self):
        """Опечатка в имени поля должна давать ошибку, а не молча пропускаться."""
        rec = self.arm_rows()[0]
        self.assertEqual(self.req('PATCH', ARM + key_of(rec), '$format=json', {'НетТакогоПоля': 1}).status_code, 400)


# ---------------------------------------------------------------- 6. производительность
class T6Perf(OData):
    def test_catalog_1000_rows_under_10s(self):
        t0 = time.time()
        d = self.ok(self.get('Catalog_Номенклатура', '$format=json&$top=1000&$select=Ref_Key,Description'))
        self.assertLess(time.time() - t0, 10)
        self.assertGreater(len(d['value']), 0)

    def test_arm_all_rows_under_5s(self):
        t0 = time.time()
        self.ok(self.get(ARM, '$format=json'))
        self.assertLess(time.time() - t0, 5)


def write_report(result, total, started):
    fails = {t.id().split('.')[-1]: (k, tb) for k, lst in (('FAIL', result.failures), ('ERROR', result.errors)) for t, tb in lst}
    lines = ['# Тесты OData: запросы и ответы', '',
             'Публикация: `%s`, пользователь «%s». Запуск: %s, %.0f с.' % (BASE, USER, started.strftime('%d.%m.%Y %H:%M'),
                                                                          (datetime.datetime.now() - started).total_seconds()), '',
             '**Всего: %d, прошло: %d, не работает: %d.**' % (total, total - len(fails), len(fails)), '']
    if fails:
        lines += ['## Не работает', '', '| Тест | Итог | Причина |', '|---|---|---|']
        for name, (kind, tb) in fails.items():
            reason = [l for l in tb.strip().splitlines() if l.strip()][-1].replace('|', '\\|')[:300]
            lines.append('| `%s` | %s | %s |' % (name, kind, reason))
        lines.append('')
    lines += ['## Запросы', '', '| Тест | Запрос | Код | мс | Ответ (начало) |', '|---|---|---|---|---|']
    for t, m, u, s, ms, body in LOG:
        mark = ' ❌' if t in fails else ''
        lines.append('| `%s`%s | `%s %s` | %s | %s | %s |' % (t, mark, m, u.replace('|', '%7C')[:160], s, ms, body.replace('|', '\\|')[:160]))
    io.open(REPORT, 'w', encoding='utf-8-sig', newline='\r\n').write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    started = datetime.datetime.now()
    argv = [sys.argv[0]] + sys.argv[1:]
    prog = unittest.main(argv=argv, exit=False, verbosity=2)
    write_report(prog.result, prog.result.testsRun, started)
    print('Отчёт:', REPORT)
    sys.exit(0 if prog.result.wasSuccessful() else 1)

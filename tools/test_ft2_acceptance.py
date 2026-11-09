#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""L3-приёмка ФТ v2 по матрице прав: п. 3 «Профили и права», п. 5 «Снять резерв только автором»,
п. 9 «Права на документы».

Красный тест = функциональное требование ещё не обеспечено матрицей. Тесты пишутся ДО правки
и не ослабляются: пункт закрывается только когда зелёный весь прогон (go test ./...,
python tools/test_arm_matrix_rights.py, этот файл, приёмочный чек-лист), включая тест этого пункта.

Запуск: python tools/test_ft2_acceptance.py [-v]
"""
import io
import json
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MATRIX = os.path.join(ROOT, 'pwa', 'src', 'odata', 'matrix.json')


def load_matrix(path=MATRIX):
    m = json.load(io.open(path, encoding='utf-8'))
    by = {r: {c['id']: c['rights'] for c in cols} for r, cols in m['roles'].items()}
    return by, m['statuses']


class Ft2MatrixCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.by, cls.statuses = load_matrix()

    def rights(self, role, col):
        return self.by[role][col]

    def assert_no_edit(self, role, col, why):
        r = self.rights(role, col)
        self.assertNotIn('+', r, '%s/%s: право правки (%s); rights=%s' % (role, col, why, r))
        self.assertNotIn('c', r, '%s/%s: право «только автор» (%s); rights=%s' % (role, col, why, r))


class TestFt2Point3Profiles(Ft2MatrixCase):
    """ФТ п. 3: «Менеджер по продажам» — полный доступ к заказу и ценам;
    «Кладовщик» — складские документы и колонки движения, без цен закупки и себестоимости."""

    COST_COLUMNS = ('price', 'sum', 'rrc', 'coefficient', 'extra_field_1')

    def test_storekeeper_without_cost_price(self):
        for role in ('storekeeper', 'supply'):
            for col in self.COST_COLUMNS:
                self.assert_no_edit(role, col, 'ФТ п. 3: кладовщик без цен закупки и себестоимости')

    def test_storekeeper_without_payment_edit(self):
        for col in ('paid_status', 'invoice_number', 'invoice_date'):
            self.assert_no_edit('storekeeper', col, 'ФТ п. 3: кладовщик без оплаты и счетов')

    def test_manager_has_cost_and_price(self):
        for col in ('price', 'extra_field_1'):
            self.assertIn('+', self.rights('manager', col), 'ФТ п. 3: менеджер — полный доступ к ценам')


class TestFt2Point5ReserveAuthor(Ft2MatrixCase):
    """ФТ п. 5: «Снять резерв» доступно только пользователю, который резерв поставил (creator на Н2)."""

    def test_reserve_author_only(self):
        for role in ('manager', 'supply'):
            r = self.rights(role, 'reserve_qty')
            self.assertIn('c', r, 'ФТ п. 5: у %s нет «только автор» на «Кол-во в резерве» (rights=%s)' % (role, r))

    def test_admin_not_narrowed(self):
        r = self.rights('admin', 'reserve_qty')
        self.assertIn('+', r, 'ФТ п. 5: админ — полный доступ (rights=%s)' % r)
        self.assertNotIn('c', r, 'ФТ п. 5: админ не сужается «только автором»')


class TestFt2Point9Documents(Ft2MatrixCase):
    """ФТ п. 9: изменение — автор документа, просмотр — по профилю, администратор — полный доступ и НСИ."""

    DOC = 'doc_signed_original'
    AUTHORS = ('manager', 'storekeeper', 'chief_mechanic', 'supply')

    def test_change_only_by_author(self):
        for role in self.AUTHORS:
            r = self.rights(role, self.DOC)
            self.assertIn('c', r, 'ФТ п. 9: у %s нет «только автор» на контроль документов (rights=%s)' % (role, r))

    def test_admin_full_access(self):
        r = self.rights('admin', self.DOC)
        self.assertEqual(set(r), {'+'}, 'ФТ п. 9: админ — полный доступ (rights=%s)' % r)

    def test_author_rule_only_in_shipped_and_return(self):
        r = self.rights('manager', self.DOC)
        got = {s for s, ch in zip(self.statuses, r) if ch == 'c'}
        self.assertEqual(got, {'shipped', 'return'}, 'ФТ п. 9: правило автора только в «Отгружено»/«Возврат»; got=%s' % sorted(got))

    def test_no_right_for_other_roles(self):
        for role in ('supplier', 'client'):
            self.assertNotIn('+', self.rights(role, self.DOC), 'ФТ п. 9: %s не правит документы' % role)


if __name__ == '__main__':
    unittest.main(verbosity=2)

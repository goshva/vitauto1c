# -*- coding: utf-8 -*-
"""seed/data.json соответствует seed/Шаблон деталей.xlsx (python -m unittest tools.test_seed_from_xlsx)."""
import io
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import seed_from_xlsx as S  # noqa: E402
import generate_arm_matrix_rights as G  # noqa: E402

STATUSES = {s for _m, ss in G.STATUS_MAP for s in ss}
FIELDS = {f for f, _c in G._FIELD_PAIRS if f not in G.NOT_REGISTER_FIELDS} | {'Договор'}


class SeedFromXlsx(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.built = S.build(S.XLSX)
        cls.data = json.load(io.open(S.OUT, encoding='utf-8'))

    def test_data_json_is_up_to_date(self):
        for key, value in self.built.items():
            self.assertEqual(self.data[key], value, 'seed/data.json устарел — python tools/seed_from_xlsx.py')

    def test_scenarios(self):
        self.assertEqual([len(o['rows']) for o in self.data['orders']], [8, 13, 16, 10, 22])
        self.assertEqual(len({o['clientNumber'] for o in self.data['orders']}), 5)

    def test_statuses_and_fields_exist_in_arm(self):
        for o in self.data['orders']:
            for r in o['rows']:
                self.assertIn(r['fields']['СтатусСтроки'], STATUSES, r['step'])
                self.assertLessEqual(set(r['fields']), FIELDS, r['excelRow'])
        self.assertLessEqual(set(S.STEP_STATUS.values()), STATUSES)

    def test_assembly_date_only_after_assembly(self):
        for o in self.data['orders']:
            for r in o['rows']:
                f = r['fields']
                self.assertEqual('ДатаОтправкиНаСборку' in f, f['СтатусСтроки'] in S.AFTER_ASSEMBLY and 'Номенклатура' in f)


if __name__ == '__main__':
    unittest.main()

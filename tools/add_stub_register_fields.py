# -*- coding: utf-8 -*-
"""T05 (D4): добавить в регистр Арм_ДанныеЗакупокИПродаж (src/АРМЗакупокИПродаж_v2.11) пять ресурсов
под колонки-заглушки матрицы:

    НомерШасси        строка 50      (Е5, grz_fact)
    КоличествоВРезерве число 15.3    (Н2, reserve_qty)
    КоличествоВПути    число 15.3    (Н3, ordered_in_transit_qty)
    ДатаУПД           дата           (С3, upd_date)
    НомерУПД          строка 50      (С4, upd_number)

Скрипт идемпотентен: уже существующие имена пропускает. Блоки ресурсов клонируются с соседних ресурсов того же
типа (новый uuid), счётчик ресурсов в заголовке увеличивается. EOL файла (CRLF) сохраняется.
CFE не собирается и на ИБ не грузится — после правки нужен repack + CheckModules на ТЕСТОВОЙ ИБ.

Запуск:  python tools/add_stub_register_fields.py
"""
import copy
import io
import json
import os
import sys
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(ROOT, 'src', 'АРМЗакупокИПродаж_v2.11')
REG_JSON = os.path.join(EXT, 'InformationRegister', 'Арм_ДанныеЗакупокИПродаж', 'InformationRegister.json')

# (имя ресурса, синоним, имя ресурса-образца, переопределение Pattern)
NEW_FIELDS = [
    ('НомерШасси', '№ Шасси', 'Агрегат', ['"S"', '50', '1']),
    ('КоличествоВРезерве', 'Кол-во в резерве', 'Себестоимость', ['"N"', '15', '3', '0']),
    ('КоличествоВПути', 'Кол-во заказанного в пути', 'Себестоимость', ['"N"', '15', '3', '0']),
    ('ДатаУПД', 'Дата УПД', 'ДатаПоступления', None),
    ('НомерУПД', '№ УПД', 'Агрегат', ['"S"', '50', '1']),
]


def resource_name(item):
    return item[0][1][1][1][2].strip('"')


def main():
    with io.open(REG_JSON, 'rb') as f:
        raw = f.read().decode('utf-8')
    data = json.loads(raw)
    resources = data['header'][0][3]          # [classUuid, count, item, item, ...]
    items = resources[2:]
    by_name = {resource_name(i): i for i in items}
    added = []
    for name, synonym, template_name, pattern in NEW_FIELDS:
        if name in by_name:
            continue
        item = copy.deepcopy(by_name[template_name])
        head = item[0][1][1][1]                # ["3", ["1","0",uuid], "\"Имя\"", ["1","\"ru\"","\"Синоним\""], ...]
        head[1][2] = str(uuid.uuid4())
        head[2] = '"%s"' % name
        head[3][2] = '"%s"' % synonym
        if pattern is not None:
            head_pattern = item[0][1][1][2]    # ["\"Pattern\"", [...]]
            head_pattern[1] = list(pattern)
        resources.append(item)
        added.append(name)
    resources[1] = str(len(resources) - 2)
    out = json.dumps(data, ensure_ascii=False, indent=2).replace('\n', '\r\n')
    if added:
        with io.open(REG_JSON, 'wb') as f:
            f.write(out.encode('utf-8'))
    print('added:', ', '.join(added) if added else '(nothing, already present)')
    print('resources total:', resources[1])


if __name__ == '__main__':
    sys.exit(main())

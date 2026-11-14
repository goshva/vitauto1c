import { createRoute, z } from '@hono/zod-openapi';
import { createApi } from './api.ts';
import { pool } from './db.ts';

// Справочники: 6 операций чтения (задание §7, группа «Справочники»).
//
// Справочники нужны АРМ для выпадающих списков: номенклатура при сопоставлении (M2),
// ячейки при размещении (K2), контрагенты при загрузке листа (N1). Без них оператор
// вводил бы идентификаторы руками.
//
// Записывать справочники через API прототип НЕ умеет намеренно: в legacy их наполняла
// 1С, а в прототипе — `seed/templates/refs.sql`. Один вход данных, а не два.

export const refs = createApi();

interface RefSpec {
  path: string;
  table: string;
  /** Колонки выборки: перечислены явно, а не `*` — контракт должен быть виден. */
  columns: string;
  /** По каким колонкам работает поиск `?q=`. */
  search: string[];
  title: string;
  /**
   * Присоединение справочника: нужно там, где карточка показывает НАЗВАНИЕ связи,
   * а не её идентификатор (бренд номенклатуры — ФТ v2 п. 19).
   */
  join?: string;
  /** Псевдоним основной таблицы, если колонки пишутся с префиксом. */
  alias?: string;
}

const REFS: RefSpec[] = [
  {
    path: 'nomenclature', table: 'nomenclature', title: 'Номенклатура',
    // Карточка номенклатуры (ФТ v2 п. 19): бренд, код поставщика и наименование
    // для печати. Раньше `brand_id` в схеме был, а в ответе — нет: поле выглядело
    // заполненным, но выбрать бренд было негде.
    columns: `n.id, n.code, n.name, n.article, n.full_name, n.unit_id, n.kind, n.price,
              n.brand_id, b.name as brand, n.ext_code`,
    // Поиск и по коду поставщика: оператор ищет позицию по накладной поставщика,
    // где стоит ЕГО код, а не наш артикул. Без этого поле бесполезно на практике.
    search: ['name', 'article', 'code', 'ext_code'],
    join: 'left join brand b on b.id = n.brand_id and b.deleted_at is null',
    alias: 'n',
  },
  {
    path: 'brands', table: 'brand', title: 'Бренды',
    columns: 'id, code, name, country',
    search: ['name', 'code'],
  },
  {
    path: 'counterparties', table: 'counterparty', title: 'Контрагенты',
    columns: 'id, code, name, full_name, inn, kpp, is_customer, is_supplier, inactive',
    search: ['name', 'inn', 'code'],
  },
  {
    path: 'units', table: 'unit', title: 'Единицы измерения',
    columns: 'id, code, name, full_name, intl_code',
    search: ['name', 'code'],
  },
  {
    path: 'warehouses', table: 'warehouse', title: 'Склады',
    columns: 'id, code, name, organization_id, is_warehouse, is_main',
    search: ['name', 'code'],
  },
  {
    path: 'payment-forms', table: 'payment_form', title: 'Формы оплаты',
    columns: 'id, code, name',
    search: ['name', 'code'],
  },
  {
    path: 'service-kinds', table: 'service_kind', title: 'Виды услуг',
    columns: 'id, code, name',
    search: ['name', 'code'],
  },
];

const RefQuery = z.object({
  q: z.string().optional().describe('Поиск по названию, коду или артикулу'),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
});

/** Экранирование LIKE: `%` и `_` в запросе оператора — это символы, а не шаблоны. */
const likeArg = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Регистрирует чтение одного справочника. Табличная форма вместо шести почти
 * одинаковых обработчиков: расхождение между ними (забыл фильтр `deleted_at`,
 * забыл сортировку) — это ровно тот класс дефектов, который не видно в тестах
 * одного справочника.
 */
function addRef(spec: RefSpec): void {
  const route = createRoute({
    method: 'get',
    path: `/refs/${spec.path}`,
    tags: ['refs'],
    summary: spec.title,
    // query объявлен всегда: иначе `c.req.valid('query')` вырождается в never
    // у маршрутов без поиска, и обращение к полю не компилируется.
    request: { query: RefQuery },
    responses: {
      200: {
        description: `${spec.title}: список`,
        content: {
          'application/json': {
            schema: z.object({
              items: z.array(z.record(z.string(), z.unknown())),
              total: z.number().int(),
            }),
          },
        },
      },
    },
  });

  refs.openapi(route, async (c) => {
    const query = c.req.valid('query');
    const params: unknown[] = [];
    // С псевдонимом колонки надо уточнять: после присоединения справочника
    // `name` и `deleted_at` есть в ОБЕИХ таблицах, и запрос падает на
    // неоднозначности — причём только у одного справочника из семи.
    const p = (col: string): string => (spec.alias ? `${spec.alias}.${col}` : col);
    let where = `where ${p('deleted_at')} is null`;

    if (query.q && spec.search.length > 0) {
      params.push(likeArg(query.q));
      const n = params.length;
      where += ` and (${spec.search.map((col) => `${p(col)} ilike $${n}`).join(' or ')})`;
    }

    params.push(query.limit ?? 100);
    const r = await pool.query(
      `select ${spec.columns}
         from ${spec.table} ${spec.alias ?? ''}
         ${spec.join ?? ''}
         ${where}
        order by ${p('name')} limit $${params.length}`,
      params,
    );
    return c.json({ items: r.rows as never[], total: r.rowCount ?? 0 }, 200);
  });
}

// Поиск нужен не везде: у форм оплаты и видов услуг записей единицы.
for (const spec of REFS) addRef(spec);

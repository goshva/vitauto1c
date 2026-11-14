import { pool } from './db.ts';
import { statusTitle } from './domain/status.ts';

// Данные печатных форм ремонта: заказ-наряд и акт выполненных работ.
//
// Обе формы печатают ОДНО И ТО ЖЕ — работы и запчасти одного наряда, — и отличаются
// назначением: наряд показывает, ЧТО делать (со статусом обеспечения запчастей),
// акт — ЧТО сделано и сколько это стоит (с подписями сторон). Поэтому данные
// собираются один раз, а формы строятся поверх.
//
// Заказ-наряд перенесён из legacy (`backend/internal/arm/print.go`,
// `work_order.html.tmpl`): там форма собиралась из `doc.work_order_labor` и
// `doc.work_order_line`. Здесь обе роли играет `line`: работа отличается от
// запчасти наличием нормо-часов — тем же признаком, что и в карточке наряда.

export interface RepairLine {
  no: number;
  name: string;
  article: string | null;
  unit: string | null;
  /** Количество для запчасти, нормо-часы для работы. */
  amount: string;
  price: string | null;
  sum: number;
  status: string | null;
  statusTitle: string | null;
  executor: string | null;
}

export interface RepairDoc {
  id: string;
  number: string;
  date: string;
  status: string;
  statusTitle: string;
  counterparty: string | null;
  organization: string | null;
  car: string | null;
  vin: string | null;
  department: string | null;
  comment: string | null;
  labor: RepairLine[];
  parts: RepairLine[];
  laborSum: number;
  partsSum: number;
  total: number;
  normHoursTotal: number;
  partsCount: number;
  partsQtyTotal: number;
  /** Исполнители работ поимённо — для подписи в акте (Q3). */
  executors: string[];
}

const num = (v: string | null): number => (v === null ? 0 : Number(v));

/**
 * Собирает документ по идентификатору наряда.
 *
 * Возвращает `null`, если наряда нет: отказ формирует маршрут, а не загрузчик —
 * у маршрута есть контекст запроса и единый формат ошибки.
 */
export async function loadRepairDoc(workOrderId: string): Promise<RepairDoc | null> {
  const head = await pool.query<{
    id: string; number: string | null; date: Date; status: string; comment: string | null;
    counterparty: string | null; organization: string | null;
    car: string | null; vin: string | null; department: string | null;
  }>(
    `select w.id, w.number, w.date, w.status, w.comment,
            k.name as counterparty, o.name as organization,
            c.name as car, c.vin, d.name as department
       from work_order w
       left join counterparty k on k.id = w.counterparty_id and k.deleted_at is null
       left join organization o on o.id = w.organization_id and o.deleted_at is null
       left join car c on c.id = w.car_id and c.deleted_at is null
       left join department d on d.id = c.department_id and d.deleted_at is null
      where w.id = $1 and w.deleted_at is null`,
    [workOrderId],
  );
  if (head.rowCount === 0) return null;
  const h = head.rows[0]!;

  // Строки наряда: работа отличается от запчасти наличием нормо-часов.
  const lines = await pool.query<{
    id: string; norm_hours: string | null; quantity: string | null; sale_price: string | null;
    status: string | null; article: string | null; name: string | null;
    fact_name: string | null; fact_article: string | null; unit: string | null;
    executor: string | null; ext_code: string | null;
  }>(
    `select l.id, l.norm_hours::text, l.quantity::text, l.sale_price::text, l.status,
            n.article, f.fact_name, f.fact_article, u.name as unit,
            e.full_name as executor,
            -- Наименование ДЛЯ ПЕЧАТИ (ФТ v2 п. 19): в бланк идёт полное имя, а
            -- короткое остаётся для списков. COALESCE — потому что печатное имя
            -- необязательно, и пустая ячейка в документе недопустима.
            coalesce(n.full_name, n.name) as name,
            -- Код поставщика: по нему позицию находят у поставщика, и в документах
            -- для снабжения он нужен рядом с нашим артикулом.
            n.ext_code
       from line l
       left join nomenclature n on n.id = l.nomenclature_id and n.deleted_at is null
       left join unit u on u.id = n.unit_id and u.deleted_at is null
       left join line_fact f on f.id = l.id
       left join employee e on e.id = l.executor_id and e.deleted_at is null
      where l.work_order_id = $1 and not l.deleted
      order by l.id`,
    [workOrderId],
  );

  const labor: RepairLine[] = [];
  const parts: RepairLine[] = [];
  const executors = new Set<string>();
  let laborSum = 0;
  let partsSum = 0;
  let normHoursTotal = 0;
  let partsQtyTotal = 0;

  for (const x of lines.rows) {
    const isLabor = x.norm_hours !== null;
    const price = x.sale_price;
    const sum = isLabor
      ? num(x.norm_hours) * num(price)
      : num(x.quantity) * num(price);

    const row: RepairLine = {
      // Нумерация отдельная в каждой таблице: в печатной форме это два разных
      // списка, и «№ 3» в работах не должен значить «№ 3» в запчастях.
      no: (isLabor ? labor.length : parts.length) + 1,
      name: x.name ?? x.fact_name ?? '—',
      article: x.article ?? x.fact_article,
      unit: x.unit,
      amount: isLabor ? (x.norm_hours ?? '0') : (x.quantity ?? '0'),
      price,
      sum,
      status: x.status,
      statusTitle: x.status ? statusTitle(x.status) : null,
      executor: x.executor,
    };

    if (isLabor) {
      labor.push(row);
      laborSum += sum;
      normHoursTotal += num(x.norm_hours);
      if (x.executor) executors.add(x.executor);
    } else {
      parts.push(row);
      partsSum += sum;
      partsQtyTotal += num(x.quantity);
    }
  }

  return {
    id: h.id,
    number: h.number?.trim() || '—',
    date: h.date.toISOString().slice(0, 10),
    status: h.status,
    statusTitle: statusTitle(h.status),
    counterparty: h.counterparty,
    organization: h.organization,
    car: h.car,
    vin: h.vin,
    department: h.department,
    comment: h.comment,
    labor,
    parts,
    laborSum,
    partsSum,
    total: laborSum + partsSum,
    normHoursTotal,
    partsCount: parts.length,
    partsQtyTotal,
    executors: [...executors],
  };
}

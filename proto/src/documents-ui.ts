import { Hono } from 'hono';
import { pool } from './db.ts';
import { layout } from './views/html.ts';
import { documentsTable, type DocumentRow } from './views/documents.ts';
import { app } from './server.ts';
import { RETURN_STATES } from './domain/return-state.ts';
import { SHIPMENT_STATES } from './domain/shipment-state.ts';
import { SUPPLIER_ORDER_STATES } from './domain/supplier-order-state.ts';
import { WORK_ORDER_STATES } from './domain/work-order-state.ts';

// Экраны документов: возвраты, отгрузки, заказы поставщику, заказ-наряды.
//
// ОДИН экран на четыре вида, а не четыре похожих. Они отличаются только таблицей
// и таблицей состояний — обе уже есть в домене. Четыре копии разошлись бы при
// первой же правке одной из них, как это было в legacy с таблицей переходов.
//
// Действия ДЕЛЕГИРУЮТ В API через app.request(): логика перехода остаётся в одном
// месте. Если бы экран выполнял переход сам, появилась бы вторая реализация,
// и однажды кнопка и API разошлись бы.

interface StateSpec {
  title: string;
  next: string[];
}

interface DocKind {
  key: string;
  title: string;
  table: string;
  /** Префикс API: оттуда берутся действия. */
  api: string;
  states: Record<string, StateSpec>;
  /** Целевой статус → путь действия и тело. */
  action: (id: string, to: string) => { path: string; body?: unknown };
}

const KINDS: DocKind[] = [
  {
    key: 'returns', title: 'Возвраты', table: 'return_order', api: '/returns',
    states: RETURN_STATES,
    action: (id, to) => ({
      path: `/returns/${id}/${to === 'accepted' ? 'accept' : to === 'to_supplier' ? 'supplier' : 'close'}`,
    }),
  },
  {
    key: 'shipments', title: 'Отгрузки', table: 'shipment', api: '/shipments',
    states: SHIPMENT_STATES,
    action: (id, to) => ({ path: `/shipments/${id}/${to === 'shipped' ? 'ship' : 'close'}` }),
  },
  {
    key: 'supplier-orders', title: 'Заказы поставщику', table: 'supplier_order', api: '/supplier-orders',
    states: SUPPLIER_ORDER_STATES,
    action: (id, to) => ({ path: `/supplier-orders/${id}/${to}` }),
  },
  {
    key: 'work-orders', title: 'Заказ-наряды', table: 'work_order', api: '/work-orders',
    states: WORK_ORDER_STATES,
    action: (id, to) => ({ path: `/work-orders/${id}/transition`, body: { to } }),
  },
];

export const documentsUi = new Hono();

const kindOf = (key: string): DocKind | undefined => KINDS.find((k) => k.key === key);

/** Список документов вида: строки таблицы с заголовком состояния. */
async function loadDocs(kind: DocKind): Promise<DocumentRow[]> {
  const r = await pool.query<{ id: string; number: string | null; date: Date; status: string }>(
    `select id, number, date, status from ${kind.table} where deleted_at is null
      order by date desc, number limit 200`,
  );
  return r.rows.map((x) => ({
    id: x.id,
    number: x.number,
    date: x.date.toISOString().slice(0, 10),
    status: x.status,
    statusTitle: kind.states[x.status]?.title ?? x.status,
    next: (kind.states[x.status]?.next ?? []).map((to) => ({
      to,
      title: kind.states[to]?.title ?? to,
    })),
  }));
}

function page(kind: DocKind, rows: DocumentRow[]): string {
  const tabs = KINDS.map(
    (k) => `<a href="/documents/${k.key}" data-testid="tab-${k.key}"
      class="${k.key === kind.key ? 'tab-active' : ''}">${k.title}</a>`,
  ).join('\n      ');

  return layout({
    title: kind.title,
    testId: `page-documents-${kind.key}`,
    body: `<nav class="tabs" data-testid="doc-tabs">
      ${tabs}
    </nav>
    ${rows.length === 0
      ? `<p data-testid="documents-empty">Документов «${kind.title}» пока нет</p>`
      : documentsTable(kind.key, rows)}`,
  });
}

documentsUi.get('/documents/:kind', async (c) => {
  const kind = kindOf(c.req.param('kind'));
  if (!kind) {
    return c.html(
      layout({
        title: 'Документы',
        testId: 'page-documents',
        body: '<p>Выберите вид документа из списка выше</p>',
      }),
      404,
    );
  }
  return c.html(page(kind, await loadDocs(kind)));
});

/**
 * Действие над документом. Делегирует в API, чтобы переход выполнялся ОДНОЙ
 * реализацией: экран лишь передаёт запрос дальше и перерисовывает список.
 */
documentsUi.post('/ui/documents/:kind/:id/:to', async (c) => {
  const kind = kindOf(c.req.param('kind'));
  if (!kind) return c.html('<p data-testid="documents-error">Неизвестный вид документа</p>', 404);

  const id = c.req.param('id');
  const to = c.req.param('to');
  const { path, body } = kind.action(id, to);

  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const rows = await loadDocs(kind);
  const html = page(kind, rows);

  // Причина отказа показывается над таблицей, а не проглатывается: оператор
  // должен видеть, почему кнопка не сработала.
  if (!res.ok) {
    const problem = (await res.json()) as { message?: string };
    return c.html(
      html.replace(
        '<nav class="tabs"',
        `<p class="hint-partial" data-testid="document-error">${problem.message ?? 'Действие не выполнено'}</p><nav class="tabs"`,
      ),
    );
  }

  return c.html(html);
});

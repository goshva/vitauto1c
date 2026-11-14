import { Hono } from 'hono';
import { Problem, problemResponse } from './problem.ts';
import { loadRepairDoc } from './print-repair.ts';
import { workOrderPage } from './views/print-work-order.ts';
import { workActPage } from './views/print-act.ts';

// Печать документов ремонта (2 маршрута): заказ-наряд и акт выполненных работ.
//
// Отдельно от `print.ts`: там формы ПОСТРОЧНЫЕ (сборочный лист, ведомость — отбор
// строк по статусам), а здесь ДОКУМЕНТНЫЕ — по одному заказ-наряду. Общий у них
// только вид адреса.
//
// Регистрируются ДО `print`: иначе `/print/{kind}` перехватил бы `/print/work_order`
// и ответил «формы нет». Та же ловушка, что у `/lines/summary` и `/lines/{id}`.

export const printRepair = new Hono();

/** Идентификатор наряда из запроса: `?workOrderId=`. Отсутствие — ошибка ввода. */
function workOrderIdOf(c: { req: { query: (k: string) => string | undefined } }): string | Problem {
  const id = c.req.query('workOrderId');
  if (!id) {
    return new Problem(400, 'bad_request',
      'Не указан заказ-наряд: нужен параметр workOrderId (печать по конкретному наряду).',
      'workOrderId');
  }
  return id;
}

async function renderForm(
  rawId: string | Problem,
  render: (doc: Awaited<ReturnType<typeof loadRepairDoc>>) => string,
): Promise<{ problem: Problem } | { html: string }> {
  if (rawId instanceof Problem) return { problem: rawId };

  const doc = await loadRepairDoc(rawId);
  if (!doc) {
    return { problem: new Problem(404, 'not_found', `Заказ-наряд ${rawId} не найден`) };
  }
  return { html: render(doc) };
}

// --- GET /print/work_order — заказ-наряд (перенос из legacy) --------------------------

printRepair.get('/print/work_order', async (c) => {
  const result = await renderForm(workOrderIdOf(c), (doc) => workOrderPage(doc!));
  if ('problem' in result) return problemResponse(c, result.problem);
  return c.html(result.html);
});

// --- GET /print/work_act — акт выполненных работ -------------------------------------

printRepair.get('/print/work_act', async (c) => {
  const result = await renderForm(workOrderIdOf(c), (doc) => workActPage(doc!));
  if ('problem' in result) return problemResponse(c, result.problem);
  return c.html(result.html);
});

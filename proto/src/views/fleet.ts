import { esc } from './html.ts';

// Экраны автопарка: список ТС, список ТО, карточка машины.
//
// Отдельный файл от `fleet-ui.ts`: маршруты и разметка меняются по разным причинам,
// и вместе они не влезают в 200 строк (та же причина, что у `lines.ts` + `lines-ui.ts`).

export interface FleetRow {
  id: string;
  code: string | null;
  name: string;
  department: string | null;
  plate: string | null;
  mileage: number | null;
  status: string;
  statusTitle: string;
  due: { due: boolean; reason: string | null; remainingKm: number | null; remainingDays: number | null };
}

/** Причина на языке оператора. */
export const REASON_TITLES: Record<string, string> = {
  mileage: 'по пробегу',
  days: 'по сроку',
  never: 'ТО не делали',
};

/**
 * Что осталось до ТО — словами.
 *
 * Показывается ОСТАТОК, а не абсолютный пробег: «осталось 2 000 км» механику
 * понятнее, чем «131 000 км пробега», и сразу отвечает на вопрос «ехать сейчас?».
 */
export function dueText(due: FleetRow['due']): string {
  if (!due.due) return '—';
  const reason = REASON_TITLES[due.reason ?? ''] ?? due.reason ?? '';
  if (due.reason === 'never') return reason;

  const parts: string[] = [];
  if (due.remainingKm !== null) {
    parts.push(due.remainingKm <= 0
      ? `просрочено на ${Math.abs(due.remainingKm).toLocaleString('ru-RU')} км`
      : `осталось ${due.remainingKm.toLocaleString('ru-RU')} км`);
  }
  if (due.remainingDays !== null) {
    parts.push(due.remainingDays <= 0
      ? `срок истёк ${Math.abs(due.remainingDays)} дн. назад`
      : `осталось ${due.remainingDays} дн.`);
  }
  return `${reason}: ${parts.join(', ')}`;
}

function fleetRow(c: FleetRow): string {
  const due = c.due.due
    ? `<span class="due due-alert" data-testid="due-${esc(c.code ?? c.id)}">${esc(dueText(c.due))}</span>`
    : `<span class="due">${esc(dueText(c.due))}</span>`;

  return `<tr data-testid="fleet-${esc(c.code ?? c.id)}" data-status="${esc(c.status)}">
  <td class="c-code"><a href="/fleet/${esc(c.id)}">${esc(c.code ?? '—')}</a></td>
  <td>${esc(c.name)}</td>
  <td>${esc(c.plate ?? '—')}</td>
  <td>${esc(c.department ?? '—')}</td>
  <td class="c-num">${c.mileage === null ? '—' : c.mileage.toLocaleString('ru-RU')}</td>
  <td class="c-status s-${esc(c.status)}">${esc(c.statusTitle)}</td>
  <td>${due}</td>
</tr>`;
}

export function fleetTable(rows: FleetRow[]): string {
  if (rows.length === 0) {
    return '<p data-testid="fleet-empty">Машин нет. Заведите их в справочнике автопарка.</p>';
  }
  return `<table class="fleet" data-testid="fleet-table">
  <thead><tr>
    <th>Код</th><th>Машина</th><th>Госномер</th><th>Подразделение</th>
    <th class="c-num">Пробег, км</th><th>Состояние</th><th>До ТО</th>
  </tr></thead>
  <tbody>
${rows.map(fleetRow).join('\n')}
  </tbody>
</table>`;
}

/** Карточка ТС: пробег, срок ТО, форма отметки, история нарядов. */
export function fleetCard(
  car: FleetRow & { vin: string | null; year: number | null },
  workOrders: { id: string; number: string | null; date: string; status: string; total: string | null }[],
): string {
  const history = workOrders.length === 0
    ? '<p data-testid="card-work-orders">Нарядов по этой машине ещё не было.</p>'
    : `<table data-testid="card-work-orders">
    <thead><tr><th>Номер</th><th>Дата</th><th>Состояние</th><th class="c-num">Сумма</th><th>Печать</th></tr></thead>
    <tbody>${workOrders.map((w) => `<tr>
      <td>${esc(w.number ?? '—')}</td><td>${esc(w.date)}</td>
      <td>${esc(w.status)}</td><td class="c-num">${esc(w.total ?? '—')}</td>
      <td><a href="/print/work_order?workOrderId=${esc(w.id)}" data-testid="print-wo-${esc(w.id)}">Заказ-наряд</a>
        · <a href="/print/work_act?workOrderId=${esc(w.id)}" data-testid="print-act-${esc(w.id)}">Акт</a></td>
    </tr>`).join('\n')}</tbody></table>`;

  return `<div class="card" data-testid="fleet-card">
  <dl class="props">
    <dt>Код</dt><dd>${esc(car.code ?? '—')}</dd>
    <dt>Машина</dt><dd>${esc(car.name)}</dd>
    <dt>Госномер</dt><dd>${esc(car.plate ?? '—')}</dd>
    <dt>VIN</dt><dd>${esc(car.vin ?? '—')}</dd>
    <dt>Год</dt><dd>${car.year ?? '—'}</dd>
    <dt>Подразделение</dt><dd>${esc(car.department ?? '—')}</dd>
    <dt>Состояние</dt><dd class="c-status s-${esc(car.status)}">${esc(car.statusTitle)}</dd>
    <dt>Пробег</dt><dd>${car.mileage === null ? '—' : `${car.mileage.toLocaleString('ru-RU')} км`}</dd>
    <dt>До ТО</dt><dd data-testid="card-due">${esc(dueText(car.due))}</dd>
  </dl>

  <form class="card-actions" hx-post="/ui/fleet/service" hx-target="#fleet-panel" hx-swap="outerHTML">
    <input type="hidden" name="carId" value="${esc(car.id)}">
    <input type="hidden" name="view" value="card">
    <button type="submit" data-testid="service-done">Отметить ТО выполненным</button>
  </form>

  <h2>История обслуживания</h2>
  ${history}
</div>`;
}

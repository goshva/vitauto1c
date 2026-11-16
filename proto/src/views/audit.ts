import { esc } from './html.ts';

// Показ журнала действий.
//
// Читает его администратор при разборе: «кто изменил цену», «кто перевёл строку».
// Поэтому таблица отвечает не «что произошло вообще», а «было → стало»: без пары
// значений запись не объясняет ничего.

export interface AuditView {
  id: string;
  at: string;
  login: string | null;
  role: string | null;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  comment: string | null;
  entity?: string;
  entityId?: string;
}

const ACTION_TITLES: Record<string, string> = {
  create: 'создал',
  update: 'изменил',
  delete: 'удалил',
  transition: 'перевёл',
  // Сдвиг по шагам процесса — отдельное действие: «перевёл» не говорит, на каком шаге
  // строка была и на какой встала, а по журналу спрашивают именно это.
  step: 'сдвинул по шагу',
};

const FIELD_TITLES: Record<string, string> = {
  status: 'состояние',
  process_step: 'шаг процесса',
  sale_price: 'цена продажи',
  cost_price: 'себестоимость',
  coefficient: 'коэффициент',
  quantity: 'количество',
  nomenclature_id: 'номенклатура',
  supplier_id: 'поставщик',
  comment: 'комментарий',
  urgency: 'срочность',
  territory: 'база',
};

const fieldTitle = (f: string): string => FIELD_TITLES[f] ?? f;

/** Время в виде «15.11.2026 16:04» — так его читают, а не ISO. */
function when(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} `
    + `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** «Было → стало»: пустое значение показываем прочерком, а не пустотой. */
function change(x: AuditView): string {
  if (x.action === 'create') return `<span class="audit-new">${esc(x.newValue ?? '—')}</span>`;
  if (x.action === 'delete') return `<span class="audit-old">${esc(x.oldValue ?? '—')}</span>`;
  if (x.oldValue === x.newValue) return '<span class="hint">без изменений</span>';
  return `<span class="audit-old">${esc(x.oldValue ?? '—')}</span>`
    + ' <span class="audit-arrow">→</span> '
    + `<span class="audit-new">${esc(x.newValue ?? '—')}</span>`;
}

export function auditTable(items: AuditView[], options: { showEntity?: boolean } = {}): string {
  if (items.length === 0) {
    return `<p class="hint" data-testid="audit-empty">
      Записей нет. Журнал ведётся с момента его включения: правки, сделанные раньше,
      в нём не отражены.
    </p>`;
  }

  const head = options.showEntity ? '<th>Запись</th>' : '';

  return `<table class="audit" data-testid="audit-table">
  <thead><tr>
    <th>Когда</th><th>Кто</th>${head}<th>Что сделал</th><th>Поле</th><th>Было → стало</th>
  </tr></thead>
  <tbody>
${items.map((x) => `  <tr data-testid="audit-${esc(x.id)}">
    <td class="c-nowrap">${esc(when(x.at))}</td>
    <td>${esc(x.login ?? 'без входа')}${
  x.role ? ` <span class="hint">(${esc(x.role)})</span>` : ''}</td>
    ${options.showEntity ? `<td class="c-code">${esc(x.entity ?? '')}</td>` : ''}
    <td>${esc(ACTION_TITLES[x.action] ?? x.action)}${
  x.comment ? `<br><span class="hint">${esc(x.comment)}</span>` : ''}</td>
    <td>${x.field ? esc(fieldTitle(x.field)) : '—'}</td>
    <td>${change(x)}</td>
  </tr>`).join('\n')}
  </tbody>
</table>`;
}

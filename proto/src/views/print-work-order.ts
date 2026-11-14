import { esc } from './html.ts';
import { docDate, money, printShell, qty } from './print-shell.ts';
import type { RepairDoc, RepairLine } from '../print-repair.ts';

// Заказ-наряд: ПЕРЕНОС формы из legacy (`backend/internal/arm/work_order.html.tmpl`).
//
// Перенесено по существу, а не по названию. Legacy печатал:
//   — шапку: № и дата, организация, клиент, автомобиль с VIN, состояние, «напечатано»;
//   — работы: наименование, нормо-часы, ставка, сумма;
//   — запчасти: артикул, наименование, единица, количество, СОСТОЯНИЕ ОБЕСПЕЧЕНИЯ;
//   — итоги по работам и запчастям отдельно и общий;
//   — четыре подписи: принял, выполнил, выдал, получил.
//
// Состояние обеспечения у запчасти — не украшение: кладовщик по бумаге видит,
// что деталь ещё не пришла, и не начинает работу. Убрать его — потерять смысл формы.

// Экранирование ОБЯЗАТЕЛЬНО: legacy рендерил форму через `html/template`, который
// экранирует значения сам. Прямая подстановка в шаблонную строку потеряла бы это
// свойство, и название работы с угловой скобкой сломало бы документ.
function laborRow(r: RepairLine): string {
  return `<tr>
  <td class="n">${r.no}</td>
  <td>${esc(r.name)}</td>
  <td class="n">${qty(r.amount)}</td>
  <td class="n">${money(Number(r.price ?? 0))}</td>
  <td class="n">${money(r.sum)}</td>
</tr>`;
}

function partRow(r: RepairLine): string {
  return `<tr>
  <td class="n">${r.no}</td>
  <td>${esc(r.article ?? '—')}</td>
  <td>${esc(r.name)}</td>
  <td>${esc(r.unit ?? '—')}</td>
  <td class="n">${qty(r.amount)}</td>
  <td data-testid="wo-part-status">${esc(r.statusTitle ?? '—')}</td>
</tr>`;
}

const emptyRow = (cols: number): string => `<tr><td colspan="${cols}">—</td></tr>`;

export function workOrderPage(doc: RepairDoc): string {
  const req = [
    doc.organization ? `Организация: ${doc.organization}` : null,
    doc.counterparty ? `Клиент: ${doc.counterparty}` : null,
    doc.department ? `Подразделение: ${doc.department}` : null,
    doc.car ? `Автомобиль: ${doc.car}${doc.vin ? `, VIN: ${doc.vin}` : ''}` : null,
    `Состояние: ${doc.statusTitle}`,
    `Напечатано: ${new Date().toLocaleString('ru-RU')}`,
  ].filter((x): x is string => Boolean(x));

  return printShell(
    `Заказ-наряд № ${doc.number}`,
    'print-work-order',
    `<h1>Заказ-наряд № ${doc.number} от ${docDate(doc.date)}</h1>
${req.map((l) => `<p class="req">${l}</p>`).join('\n')}

<h2>Работы (нормо-часы)</h2>
<table data-testid="wo-labor">
  <thead><tr>
    <th style="width:5%">№</th><th>Наименование работ / услуг</th>
    <th style="width:12%">Нормо-часы</th><th style="width:13%">Ставка</th><th style="width:14%">Сумма</th>
  </tr></thead>
  <tbody>${doc.labor.length ? doc.labor.map(laborRow).join('\n') : emptyRow(5)}</tbody>
</table>
<p class="total">Работы: ${qty(doc.normHoursTotal)} н/ч${
  doc.laborSum > 0 ? `, сумма: ${money(doc.laborSum)}` : ''}</p>

<h2>Запчасти и материалы</h2>
<table data-testid="wo-parts">
  <thead><tr>
    <th style="width:5%">№</th><th style="width:16%">Артикул</th><th>Наименование</th>
    <th style="width:7%">Ед.</th><th style="width:9%">Кол-во</th><th style="width:22%">Состояние обеспечения</th>
  </tr></thead>
  <tbody>${doc.parts.length ? doc.parts.map(partRow).join('\n') : emptyRow(6)}</tbody>
</table>
<p class="total">Позиций: ${doc.partsCount}, количество: ${qty(doc.partsQtyTotal)}${
  doc.partsSum > 0 ? `, сумма: ${money(doc.partsSum)}` : ''}</p>

${doc.total > 0 ? `<p class="grand">Итого: ${money(doc.total)}</p>` : ''}

<div data-testid="wo-signs">
  <p class="sign">Принял в ремонт ____________________ / ____________________</p>
  <p class="sign">Выполнил ____________________ / ____________________</p>
  <p class="sign">Авто выдал ____________________ / ____________________
     &nbsp;&nbsp; Клиент получил ____________________ / ____________________
     &nbsp; дата ____________</p>
</div>`,
  );
}

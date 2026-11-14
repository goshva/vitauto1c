import { esc } from './html.ts';
import { docDate, money, printShell, qty } from './print-shell.ts';
import type { RepairDoc, RepairLine } from '../print-repair.ts';

// Акт выполненных работ — НОВАЯ форма.
//
// Отличие от заказ-наряда не в вёрстке, а в назначении: наряд говорит, ЧТО делать
// (и показывает состояние обеспечения запчастей), акт — ЧТО сделано и сколько это
// стоит. Отсюда два следствия:
//
//  1. В акте НЕТ состояния обеспечения: к моменту подписания работы выполнены,
//     и «деталь ещё не пришла» в закрывающем документе неуместно.
//  2. В акте ЕСТЬ исполнитель поимённо. Документ юридически значим, и подпись
//     «выполнил» должна принадлежать конкретному человеку, а не роли (Q3).
//
// Работы и запчасти идут ОДНОЙ таблицей: заказчику предъявляется стоимость ремонта
// целиком, а не два отдельных списка.

function row(r: RepairLine, isLabor: boolean): string {
  // Единица измерения: у работы — нормо-часы, у запчасти — её единица.
  const unit = isLabor ? 'н/ч' : (r.unit ?? '—');
  return `<tr>
  <td class="n">${r.no}</td>
  <td>${esc(r.name)}</td>
  <td>${esc(r.article ?? '—')}</td>
  <td>${esc(unit)}</td>
  <td class="n">${qty(r.amount)}</td>
  <td class="n">${money(Number(r.price ?? 0))}</td>
  <td class="n">${money(r.sum)}</td>
</tr>`;
}

export function workActPage(doc: RepairDoc): string {
  const labor = doc.labor.map((r) => ({ r, isLabor: true }));
  const parts = doc.parts.map((r) => ({ r, isLabor: false }));
  const rows = [...labor, ...parts];

  // Исполнители — поимённо. Если работы ни на кого не записаны, честно говорим
  // об этом в документе: пустая строка подписи хуже, чем явное «не указан».
  const executor = doc.executors.length ? doc.executors.join(', ') : 'не указан';

  return printShell(
    `Акт выполненных работ № ${doc.number}`,
    'print-work-act',
    `<h1>Акт выполненных работ № ${doc.number} от ${docDate(doc.date)}</h1>

<p class="req"><strong>Исполнитель:</strong> ${esc(doc.organization ?? '—')}</p>
<p class="req"><strong>Заказчик:</strong> ${esc(doc.counterparty ?? '—')}</p>
<p class="req"><strong>Основание:</strong> Заказ-наряд № ${esc(doc.number)} от ${docDate(doc.date)}</p>
${doc.car ? `<p class="req"><strong>Объект работ:</strong> ${esc(doc.car)}${doc.vin ? `, VIN: ${esc(doc.vin)}` : ''}</p>` : ''}
<p class="req"><strong>Исполнитель работ:</strong>
  <span data-testid="act-executor">${esc(executor)}</span></p>

<h2>Выполненные работы и использованные материалы</h2>
<table data-testid="act-table">
  <thead><tr>
    <th style="width:5%">№</th><th>Наименование</th><th style="width:14%">Артикул</th>
    <th style="width:7%">Ед.</th><th style="width:9%">Кол-во</th>
    <th style="width:13%">Цена</th><th style="width:14%">Сумма</th>
  </tr></thead>
  <tbody>${
    rows.length
      ? rows.map(({ r, isLabor }) => row(r, isLabor)).join('\n')
      : '<tr><td colspan="7">—</td></tr>'
  }</tbody>
</table>

<p class="total">Работы: ${qty(doc.normHoursTotal)} н/ч на сумму ${money(doc.laborSum)}</p>
<p class="total">Запчасти и материалы: ${doc.partsCount} поз. на сумму ${money(doc.partsSum)}</p>
<p class="grand" data-testid="act-total">Всего к оплате: ${money(doc.total)}</p>
<p class="muted">НДС не облагается.</p>

${doc.comment
    ? `<p data-testid="act-comment"><strong>Заявленная неисправность:</strong> ${esc(doc.comment)}</p>`
    : ''}

<p>Работы выполнены в полном объёме, претензий по качеству и срокам не имеется.</p>

<div data-testid="act-signs">
  <p class="sign">Работы сдал (исполнитель) ____________________ / ${esc(executor)} &nbsp; дата ____________</p>
  <p class="sign">Работы принял (заказчик) ____________________ / ____________________ &nbsp; дата ____________</p>
</div>`,
  );
}

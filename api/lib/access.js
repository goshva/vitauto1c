'use strict';
// Права по матрице index.html: ячейка matrix[уровень][роль][статус][колонка] = {editable, editableRoles, required}.
//   editable: none — никто; role — роли из editableRoles; creator — только автор строки; admin — только администратор.
// Уровень статуса (statusLevel): order — права по статусу заказа, line — по статусу строки.

function cellFor(access, role, status, column) {
  const byRole = access.matrix[access.statusLevel] && access.matrix[access.statusLevel][role];
  const byStatus = byRole && byRole[status];
  return byStatus ? byStatus[column] || null : null;
}

function statusFor(access, order, line) {
  return access.statusLevel === 'line' && line ? line.status : order.status;
}

// { ok, rule, reason } — можно ли пользователю менять колонку строки в текущем статусе.
function checkEdit(access, actor, order, line, column) {
  const status = statusFor(access, order, line);
  const cell = cellFor(access, actor.role, status, column);
  if (!cell) return { ok: false, rule: null, reason: `в матрице нет ячейки для статуса «${status}»` };
  switch (cell.editable) {
    case 'role':
      return cell.editableRoles.includes(actor.role)
        ? { ok: true, rule: 'role' }
        : { ok: false, rule: 'role', reason: `роль «${actor.role}» не входит в editableRoles` };
    case 'creator':
      return line && line.createdBy === actor.user
        ? { ok: true, rule: 'creator' }
        : { ok: false, rule: 'creator', reason: 'менять может только автор строки' };
    case 'admin':
      return actor.role === 'admin'
        ? { ok: true, rule: 'admin' }
        : { ok: false, rule: 'admin', reason: 'менять может только администратор' };
    default:
      return { ok: false, rule: 'none', reason: 'колонка не редактируется в этом статусе' };
  }
}

// Колонки, обязательные для заполнения ролями roles в статусе status.
function requiredColumns(access, roles, status) {
  const out = new Set();
  for (const role of roles) {
    const byStatus = access.matrix[access.statusLevel] && access.matrix[access.statusLevel][role] && access.matrix[access.statusLevel][role][status];
    if (!byStatus) continue;
    for (const [col, cell] of Object.entries(byStatus)) if (cell.required) out.add(col);
  }
  return [...out];
}

function isEmptyValue(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

module.exports = { cellFor, statusFor, checkEdit, requiredColumns, isEmptyValue };

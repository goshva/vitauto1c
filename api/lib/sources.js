'use strict';
// Значения по умолчанию берутся из прототипов — единый источник правды:
//   index.html        — роли, статусы, колонки матрицы;
//   default-matrix.js — права «уровень × роль × статус × колонка»;
//   column-codes.js   — коды колонок (Е4, Р2…);
//   process.html      — узлы процесса и сценарии.
// Массивы извлекаются из текста страниц без их запуска: литерал после `var ИМЯ = ` вычисляется в пустом контексте.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const LEVELS = ['order', 'line'];
const EDIT_VALUES = ['none', 'role', 'creator', 'admin'];

function read(file) { return fs.readFileSync(path.join(ROOT, file), 'utf8'); }

// Литерал массива или объекта после `var name = ` (строки и комментарии в нём не мешают поиску скобок).
function extractLiteral(src, name, file) {
  const start = src.indexOf('var ' + name + ' = ');
  if (start < 0) throw new Error(`${file}: не найдено «var ${name} = »`);
  let i = src.indexOf('=', start) + 1;
  while (/\s/.test(src[i])) i++;
  const open = src[i];
  const close = open === '[' ? ']' : '}';
  let depth = 0, quote = null, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      if (c === '\\') { j++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) break;
  }
  return vm.runInNewContext('(' + src.slice(i, j + 1) + ')');
}

function runBrowserScript(file) {
  const window = {};
  vm.runInNewContext(read(file), { window });
  return window;
}

// Ячейка default-matrix.js: число = биты ролей (0..5) + 64 required + 128 creator + 256 admin.
function decodeCell(value, roles) {
  const cell = { editable: 'none', editableRoles: [], required: !!(value & 64) };
  if (value & 128) cell.editable = 'creator';
  else if (value & 256) cell.editable = 'admin';
  else if (value & 63) {
    cell.editable = 'role';
    cell.editableRoles = roles.filter((r, i) => value & (1 << i));
  }
  return cell;
}

// Те же правила, что enforceConstraints() в index.html.
function normalizeCell(cell, roleId, roleIds) {
  const out = {
    editable: EDIT_VALUES.includes(cell && cell.editable) ? cell.editable : 'none',
    editableRoles: Array.isArray(cell && cell.editableRoles) ? roleIds.filter(r => cell.editableRoles.includes(r)) : [],
    required: !!(cell && cell.required)
  };
  if (out.editable === 'role' && !out.editableRoles.length) out.editable = 'none';
  if (out.required && out.editable === 'none') { out.editable = 'role'; out.editableRoles = [roleId]; }
  if (out.editable !== 'role') out.editableRoles = [];
  return out;
}

function loadDefaultAccess() {
  const index = read('index.html');
  const roles = extractLiteral(index, 'ROLES', 'index.html');
  const statuses = extractLiteral(index, 'STATUSES', 'index.html');
  const columns = extractLiteral(index, 'COLUMNS', 'index.html');
  const codesWindow = runBrowserScript('column-codes.js');
  const codes = codesWindow.VITAUTO_COLUMN_CODES || {};
  const defaults = runBrowserScript('default-matrix.js').VITAUTO_DEFAULT_MATRIX;
  const roleIds = roles.map(r => r.id);

  const matrix = {};
  for (const level of LEVELS) {
    matrix[level] = {};
    for (const role of roleIds) {
      matrix[level][role] = {};
      for (const st of statuses) {
        const row = defaults && defaults.cells[level] && defaults.cells[level][role] && defaults.cells[level][role][st.id];
        matrix[level][role][st.id] = {};
        for (const col of columns) {
          const ci = defaults ? defaults.columns.indexOf(col.id) : -1;
          const raw = row && ci >= 0 && typeof row[ci] === 'number' ? decodeCell(row[ci], defaults.roles) : null;
          matrix[level][role][st.id][col.id] = normalizeCell(raw, role, roleIds);
        }
      }
    }
  }
  return {
    statusLevel: 'order',
    roles: roles.map(r => ({ id: r.id, title: r.title })),
    statuses: statuses.map(s => ({ id: s.id, title: s.title })),
    columns: columns.map(c => ({ id: c.id, title: c.title, code: codes[c.id] ? codes[c.id].code : null })),
    matrix,
    source: defaults ? defaults.source : null
  };
}

function loadDefaultProcesses() {
  const src = read('process.html');
  const nodes = extractLiteral(src, 'NODES', 'process.html').map(n => ({
    id: n.id, role: n.role, title: n.title, description: n.full || '',
    statuses: n.status || [], columns: n.cols || [], next: (n.next || []).map(x => ({ to: x.to, label: x.label || '' }))
  }));
  const groups = extractLiteral(src, 'SCENARIO_GROUPS', 'process.html');
  const scenarios = extractLiteral(src, 'SCENARIOS', 'process.html').map(s => ({
    id: s.id, group: s.group, title: s.title,
    steps: s.steps.map(st => ({ nodes: st.nodes || [st.node], status: st.status, note: st.note || '' }))
  }));
  return { groups: groups.map(g => ({ id: g.id, title: g.title })), nodes, scenarios };
}

module.exports = { loadDefaultAccess, loadDefaultProcesses, normalizeCell, extractLiteral, LEVELS, EDIT_VALUES };

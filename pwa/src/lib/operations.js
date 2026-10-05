// 29 операций контракта openapi/arm-pwa.openapi.yaml: шаблоны пути, параметров и тела для консоли.
// {name} в пути и значениях подставляется из «контекста» консоли (id, найденные smoke-прогоном).
export const OPERATIONS = [
  { group: 'Сессия', method: 'POST', path: '/session', body: { login: 'arm.manager', password: '1' }, note: 'вход (без токена)' },
  { group: 'Сессия', method: 'GET', path: '/session' },
  { group: 'Сессия', method: 'DELETE', path: '/session', note: 'выход — токен станет недействительным' },
  { group: 'Матрица', method: 'GET', path: '/matrix' },
  { group: 'Строки', method: 'GET', path: '/lines', query: { view: 'sales', limit: 20, hideDeleted: true, groupByCustomerOrder: false } },
  { group: 'Строки', method: 'POST', path: '/lines', body: { view: 'sales', customerOrderId: '{customerOrderId}', nomenclatureIds: ['{nomenclatureId}'] } },
  { group: 'Строки', method: 'GET', path: '/lines/{lineId}' },
  { group: 'Строки', method: 'PATCH', path: '/lines/{lineId}', body: { field: 'КомментарийКСтроке', value: 'из консоли' } },
  { group: 'Строки', method: 'DELETE', path: '/lines/{lineId}', note: 'вычеркнуть строку' },
  { group: 'Строки', method: 'POST', path: '/lines/{lineId}/mark' },
  { group: 'Выделение', method: 'GET', path: '/selection', query: { view: 'sales' } },
  { group: 'Выделение', method: 'POST', path: '/selection', body: { view: 'sales', customerOrderId: '{customerOrderId}', marked: true } },
  { group: 'Продажи', method: 'POST', path: '/sales/jobs', body: { allowSplit: false } },
  { group: 'Продажи', method: 'POST', path: '/sales/prepared' },
  { group: 'Продажи', method: 'POST', path: '/sales/customer-orders', body: { customerId: '{customerId}', contractId: '{contractId}', clientOrderNumber: 'C-1', date: '{today}' } },
  { group: 'Продажи', method: 'POST', path: '/sales/customer-orders/{customerOrderId}/post' },
  { group: 'Продажи', method: 'DELETE', path: '/sales/customer-orders/{customerOrderId}', note: 'пометка удаления заказа' },
  { group: 'Продажи', method: 'POST', path: '/sales/supplier-orders', body: {} },
  { group: 'Продажи', method: 'POST', path: '/sales/shipments', body: { customerOrderId: '{customerOrderId}', shipmentDate: '{today}', shipmentNumber: 'ОТГ-1' } },
  { group: 'Продажи', method: 'POST', path: '/sales/imports', body: { customerId: '{customerId}', rows: [{ clientNumber: 'Л-1', urgency: '', plate: 'А123ВС', territory: 'Склад', article: 'ART-1', name: 'Фильтр', quantity: '1' }] } },
  { group: 'Снабжение', method: 'POST', path: '/supply/status', body: { status: 'paid' } },
  { group: 'Задания', method: 'GET', path: '/jobs/{jobId}' },
  { group: 'Документы', method: 'GET', path: '/documents/customer_order/{customerOrderId}' },
  { group: 'Справочники', method: 'GET', path: '/directories/counterparties', query: { q: '' } },
  { group: 'Справочники', method: 'GET', path: '/directories/contracts', query: { ownerId: '{customerId}' } },
  { group: 'Справочники', method: 'GET', path: '/directories/nomenclature', query: { q: 'а' } },
  { group: 'Справочники', method: 'GET', path: '/directories/batches', query: { nomenclatureId: '{nomenclatureId}' } },
  { group: 'Справочники', method: 'GET', path: '/directories/service-types' },
  { group: 'Справочники', method: 'GET', path: '/directories/payment-forms' }
].map((op, i) => ({ id: i, ...op }));

export function fill(value, ctx) {
  if (typeof value === 'string') return value.replace(/\{(\w+)\}/g, (m, k) => (ctx[k] !== undefined && ctx[k] !== '' ? ctx[k] : m));
  if (Array.isArray(value)) return value.map(v => fill(v, ctx));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, ctx)]));
  return value;
}

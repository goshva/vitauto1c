'use strict';
// OpenAPI 3.0 из списка маршрутов app.js. Маршрут без описания здесь — ошибка при старте:
// спецификация и сервис не могут разойтись.

const ref = name => ({ $ref: '#/components/schemas/' + name });
const arr = items => ({ type: 'array', items });
const json = schema => ({ content: { 'application/json': { schema } } });
const ok = (schema, description = 'Успешно') => ({ description, ...json(schema) });

const ERR = {
  400: { description: 'Ошибка в запросе', ...json(ref('Error')) },
  401: { description: 'Нет токена или токен неизвестен', ...json(ref('Error')) },
  403: { description: 'Не хватает прав роли (матрица или процесс)', ...json(ref('Error')) },
  404: { description: 'Не найдено', ...json(ref('Error')) },
  409: { description: 'Конфликт с текущим состоянием', ...json(ref('Error')) },
  422: { description: 'Не заполнены обязательные колонки', ...json(ref('Error')) }
};

const schemas = {
  Error: { type: 'object', required: ['error', 'message'], properties: {
    error: { type: 'string', example: 'forbidden' }, message: { type: 'string' },
    details: { type: 'object', description: 'Подробности: запрещённые колонки (denied), незаполненные обязательные (missing), ошибки проверки (problems)' } } },
  Actor: { type: 'object', properties: { id: { type: 'string' }, user: { type: 'string' }, role: { type: 'string' } } },
  Role: { type: 'object', properties: { id: { type: 'string', example: 'manager' }, title: { type: 'string' } } },
  Status: { type: 'object', properties: { id: { type: 'string', example: 'in_work' }, title: { type: 'string' } } },
  Column: { type: 'object', properties: { id: { type: 'string', example: 'gosnomer_fact' }, title: { type: 'string' }, code: { type: 'string', nullable: true, example: 'Е4' } } },
  Meta: { type: 'object', properties: {
    statusLevel: { type: 'string', enum: ['order', 'line'] }, levels: arr({ type: 'string' }),
    roles: arr(ref('Role')), statuses: arr(ref('Status')), columns: arr(ref('Column')) } },
  Cell: { type: 'object', description: 'Ячейка матрицы прав', properties: {
    editable: { type: 'string', enum: ['none', 'role', 'creator', 'admin'] },
    editableRoles: arr({ type: 'string' }), required: { type: 'boolean' } } },
  Access: { type: 'object', description: 'Матрица прав: matrix[уровень][роль][статус][колонка] = Cell', properties: {
    statusLevel: { type: 'string', enum: ['order', 'line'] }, roles: arr(ref('Role')), statuses: arr(ref('Status')),
    columns: arr(ref('Column')), matrix: { type: 'object', additionalProperties: true } } },
  AccessReplace: { type: 'object', required: ['matrix'], description: 'Формат сервиса или экспорт index.html («Экспорт JSON»): отсутствующие ячейки не меняются', properties: {
    statusLevel: { type: 'string', enum: ['order', 'line'] }, settings: { type: 'object', properties: { statusLevel: { type: 'string' } } },
    matrix: { type: 'object', additionalProperties: true } } },
  AccessPatch: { type: 'object', properties: {
    statusLevel: { type: 'string', enum: ['order', 'line'] },
    cells: arr({ type: 'object', required: ['role', 'status', 'column'], properties: {
      level: { type: 'string', enum: ['order', 'line', '*'], default: '*' }, role: { type: 'string' }, status: { type: 'string' }, column: { type: 'string' },
      editable: { type: 'string', enum: ['none', 'role', 'creator', 'admin'] }, editableRoles: arr({ type: 'string' }), required: { type: 'boolean' } } }) } },
  Node: { type: 'object', properties: {
    id: { type: 'string', example: 'M2' }, role: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
    statuses: arr({ type: 'string' }), columns: arr({ type: 'string' }),
    next: arr({ type: 'object', properties: { to: { type: 'string' }, label: { type: 'string' } } }) } },
  NodeInput: { type: 'object', required: ['role', 'title'], properties: {
    role: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
    statuses: arr({ type: 'string' }), columns: arr({ type: 'string' }),
    next: arr({ type: 'object', properties: { to: { type: 'string' }, label: { type: 'string' } } }) } },
  Step: { type: 'object', properties: {
    nodes: arr({ type: 'string' }), status: { type: 'string', nullable: true, description: 'null — статус не меняется' }, note: { type: 'string' } } },
  Scenario: { type: 'object', properties: { id: { type: 'string', example: 'happy' }, group: { type: 'string', nullable: true }, title: { type: 'string' }, steps: arr(ref('Step')) } },
  ScenarioInput: { type: 'object', required: ['title', 'steps'], properties: { group: { type: 'string' }, title: { type: 'string' }, steps: arr(ref('Step')) } },
  Processes: { type: 'object', properties: {
    groups: arr({ type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } }),
    nodes: arr(ref('Node')), scenarios: arr(ref('Scenario')) } },
  Line: { type: 'object', properties: {
    id: { type: 'string' }, status: { type: 'string' }, createdBy: { type: 'string' },
    values: { type: 'object', additionalProperties: true, description: 'Значения по id колонок матрицы' } } },
  LineInput: { type: 'object', properties: { values: { type: 'object', additionalProperties: true, example: { name_fact: 'Фонарь задний КАМАЗ', qty_fact: '1' } } } },
  HistoryEntry: { type: 'object', properties: {
    at: { type: 'string', format: 'date-time' }, user: { type: 'string' }, role: { type: 'string' }, action: { type: 'string' },
    step: { type: 'integer' }, nodes: arr({ type: 'string' }), status: { type: 'string' }, comment: { type: 'string' } } },
  Order: { type: 'object', properties: {
    id: { type: 'string' }, scenarioId: { type: 'string' }, stepIndex: { type: 'integer' }, status: { type: 'string' },
    createdBy: { type: 'string' }, createdRole: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }, lines: arr(ref('Line')), history: arr(ref('HistoryEntry')) } },
  OrderInput: { type: 'object', required: ['scenarioId'], properties: { scenarioId: { type: 'string', example: 'happy' }, lines: arr(ref('LineInput')) } },
  StepInfo: { type: 'object', properties: {
    index: { type: 'integer' }, nodes: arr({ type: 'string' }), roles: arr({ type: 'string' }), status: { type: 'string' }, note: { type: 'string' } } },
  Actions: { type: 'object', properties: {
    orderId: { type: 'string' }, scenarioId: { type: 'string' }, status: { type: 'string' },
    currentStep: ref('StepInfo'), nextStep: { type: 'object', allOf: [ref('StepInfo')], nullable: true, description: 'null — сценарий завершён' },
    missingRequired: arr({ type: 'object', properties: { line: { type: 'string' }, column: { type: 'string' } } }),
    canAdvance: { type: 'boolean' }, reason: { type: 'string' } } },
  Permissions: { type: 'object', properties: {
    role: { type: 'string' }, status: { type: 'string' }, statusLevel: { type: 'string' },
    columns: arr({ type: 'object', properties: {
      column: { type: 'string' }, code: { type: 'string' }, editable: { type: 'boolean' }, rule: { type: 'string' }, required: { type: 'boolean' } } }) } },
  User: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } },
  UserWithToken: { type: 'object', properties: { user: ref('User'), token: { type: 'string', description: 'Показывается один раз' } } },
  AuditEntry: { type: 'object', properties: {
    id: { type: 'string' }, at: { type: 'string', format: 'date-time' }, user: { type: 'string', nullable: true }, role: { type: 'string', nullable: true },
    action: { type: 'string' }, target: { type: 'string' }, details: { type: 'object', nullable: true } } }
};

const P = (name, description) => ({ name, in: 'path', required: true, schema: { type: 'string' }, description });
const Q = (name, description, schema = { type: 'string' }) => ({ name, in: 'query', required: false, schema, description });

// Описание каждого маршрута: tag, summary, description, parameters, request, response, errors
const DOCS = {
  'GET /health': { tag: 'Служебное', summary: 'Проверка, что сервис работает', response: ok({ type: 'object', properties: { ok: { type: 'boolean' } } }) },
  'GET /meta': { tag: 'Справочно', summary: 'Роли, статусы и колонки матрицы', response: ok(ref('Meta')) },
  'GET /me': { tag: 'Справочно', summary: 'Текущий пользователь API и его роль', response: ok(ref('Actor')) },
  'GET /processes': { tag: 'Процессы', summary: 'Узлы и сценарии процессов (process.html)', response: ok(ref('Processes')) },
  'GET /processes/{scenarioId}': { tag: 'Процессы', summary: 'Сценарий по id', parameters: [P('scenarioId', 'например happy')], response: ok(ref('Scenario')), errors: [404] },
  'GET /orders': { tag: 'Заказы', summary: 'Список заказов', parameters: [Q('status', 'отбор по статусу'), Q('scenarioId', 'отбор по сценарию')], response: ok(arr(ref('Order'))) },
  'POST /orders': { tag: 'Заказы', summary: 'Начать заказ по сценарию',
    description: 'Начать может роль узла первого шага сценария или admin. Значения строк проверяются по матрице для статуса первого шага.',
    request: ref('OrderInput'), response: ok(ref('Order'), 'Заказ создан'), status: 201, errors: [400, 403, 404] },
  'GET /orders/{orderId}': { tag: 'Заказы', summary: 'Заказ со строками и историей шагов', parameters: [P('orderId')], response: ok(ref('Order')), errors: [404] },
  'GET /orders/{orderId}/actions': { tag: 'Заказы', summary: 'Текущий и следующий шаг, можно ли перейти', parameters: [P('orderId')], response: ok(ref('Actions')), errors: [404] },
  'POST /orders/{orderId}/advance': { tag: 'Заказы', summary: 'Перейти на следующий шаг сценария',
    description: 'Переходит роль узла следующего шага или admin. Не пускает, пока не заполнены колонки, обязательные (required) для ролей текущего шага. force: true — только admin.',
    parameters: [P('orderId')], request: { type: 'object', properties: { comment: { type: 'string' }, force: { type: 'boolean' } } },
    response: ok(ref('Order')), errors: [403, 404, 409, 422] },
  'POST /orders/{orderId}/goto': { tag: 'Заказы', summary: 'Перевести заказ на любой шаг (admin)', parameters: [P('orderId')],
    request: { type: 'object', required: ['stepIndex'], properties: { stepIndex: { type: 'integer' }, comment: { type: 'string' } } },
    response: ok(ref('Order')), errors: [400, 403, 404] },
  'POST /orders/{orderId}/lines': { tag: 'Заказы', summary: 'Добавить строку', description: 'Добавляет роль текущего шага или admin; значения — с правом по матрице.',
    parameters: [P('orderId')], request: ref('LineInput'), response: ok(ref('Line'), 'Строка добавлена'), status: 201, errors: [400, 403, 404] },
  'PATCH /orders/{orderId}/lines/{lineId}': { tag: 'Заказы', summary: 'Изменить значения колонок строки',
    description: 'Каждая колонка проверяется по матрице для роли и текущего статуса. Если хоть одна запрещена — не меняется ничего, в details.denied — список.',
    parameters: [P('orderId'), P('lineId')], request: ref('LineInput'), response: ok(ref('Line')), errors: [400, 403, 404] },
  'GET /orders/{orderId}/lines/{lineId}/permissions': { tag: 'Заказы', summary: 'Права текущей роли на колонки строки', parameters: [P('orderId'), P('lineId')], response: ok(ref('Permissions')), errors: [404] },
  'GET /settings/access': { tag: 'Настройки: права', summary: 'Матрица прав', response: ok(ref('Access')) },
  'PUT /settings/access': { tag: 'Настройки: права', summary: 'Загрузить матрицу прав (admin)', description: 'Принимает экспорт index.html. Неизвестные роли, статусы и колонки — ошибка 400.',
    request: ref('AccessReplace'), response: ok({ type: 'object', properties: { changedCells: { type: 'integer' }, statusLevel: { type: 'string' } } }), errors: [400, 403] },
  'PATCH /settings/access': { tag: 'Настройки: права', summary: 'Изменить отдельные ячейки и уровень статуса (admin)',
    request: ref('AccessPatch'), response: ok({ type: 'object', properties: { statusLevel: { type: 'string' }, cells: arr({ type: 'object', properties: {
      level: { type: 'string' }, role: { type: 'string' }, status: { type: 'string' }, column: { type: 'string' }, cell: ref('Cell') } }) } }), errors: [400, 403] },
  'PUT /settings/processes/nodes/{nodeId}': { tag: 'Настройки: процессы', summary: 'Создать или изменить узел процесса (admin)', parameters: [P('nodeId')], request: ref('NodeInput'), response: ok(ref('Node')), errors: [400, 403] },
  'DELETE /settings/processes/nodes/{nodeId}': { tag: 'Настройки: процессы', summary: 'Удалить узел (admin)', description: 'Нельзя, если узел есть в сценариях (409).', parameters: [P('nodeId')], status: 204, errors: [403, 404, 409] },
  'PUT /settings/processes/scenarios/{scenarioId}': { tag: 'Настройки: процессы', summary: 'Создать или изменить сценарий (admin)', parameters: [P('scenarioId')], request: ref('ScenarioInput'), response: ok(ref('Scenario')), errors: [400, 403, 409] },
  'DELETE /settings/processes/scenarios/{scenarioId}': { tag: 'Настройки: процессы', summary: 'Удалить сценарий (admin)', description: 'Нельзя, если по нему есть заказы (409).', parameters: [P('scenarioId')], status: 204, errors: [403, 404, 409] },
  'POST /settings/reset': { tag: 'Настройки: процессы', summary: 'Вернуть права и/или процессы к прототипам (admin)',
    request: { type: 'object', properties: { what: { type: 'string', enum: ['access', 'processes', 'all'] } } }, response: ok({ type: 'object', properties: { reset: { type: 'string' } } }), errors: [400, 403, 409] },
  'GET /settings/users': { tag: 'Настройки: пользователи API', summary: 'Пользователи API (admin)', response: ok(arr(ref('User'))), errors: [403] },
  'POST /settings/users': { tag: 'Настройки: пользователи API', summary: 'Создать пользователя API с ролью (admin)', description: 'Возвращает токен — один раз.',
    request: { type: 'object', required: ['name', 'role'], properties: { name: { type: 'string' }, role: { type: 'string' } } }, response: ok(ref('UserWithToken'), 'Создан'), status: 201, errors: [400, 403, 409] },
  'PATCH /settings/users/{userId}': { tag: 'Настройки: пользователи API', summary: 'Сменить роль или выпустить новый токен (admin)', parameters: [P('userId')],
    request: { type: 'object', properties: { role: { type: 'string' }, rotateToken: { type: 'boolean' } } }, response: ok(ref('UserWithToken')), errors: [400, 403, 404, 409] },
  'DELETE /settings/users/{userId}': { tag: 'Настройки: пользователи API', summary: 'Удалить пользователя API (admin)', parameters: [P('userId')], status: 204, errors: [403, 404, 409] },
  'GET /audit': { tag: 'Служебное', summary: 'Журнал изменений (admin)', parameters: [Q('limit', 'сколько последних записей, 1..2000', { type: 'integer', default: 100 })], response: ok(arr(ref('AuditEntry'))), errors: [403] }
};

function buildOpenApi(routes) {
  const paths = {};
  for (const r of routes) {
    const key = `${r.method} ${r.path}`;
    const d = DOCS[key];
    if (!d) throw new Error(`OpenAPI: нет описания маршрута ${key}`);
    const op = {
      tags: [d.tag], summary: d.summary, operationId: (r.method.toLowerCase() + r.path).replace(/[{}]/g, '').replace(/\/(\w)/g, (m, c) => c.toUpperCase()),
      responses: {}
    };
    if (d.description) op.description = d.description;
    if (d.parameters) op.parameters = d.parameters;
    if (d.request) op.requestBody = { required: true, ...json(d.request) };
    op.responses[String(d.status || 200)] = d.status === 204 ? { description: 'Выполнено' } : d.response;
    if (r.auth === 'none') op.security = [];
    else op.responses['401'] = ERR[401];
    if (r.auth === 'admin' && !(d.errors || []).includes(403)) op.responses['403'] = ERR[403];
    for (const code of d.errors || []) op.responses[String(code)] = ERR[code];
    (paths[r.path] = paths[r.path] || {})[r.method.toLowerCase()] = op;
  }
  const missing = Object.keys(DOCS).filter(k => !routes.some(r => `${r.method} ${r.path}` === k));
  if (missing.length) throw new Error('OpenAPI: описаны несуществующие маршруты: ' + missing.join(', '));
  return {
    openapi: '3.0.3',
    info: {
      title: 'Витавто — API процессов и прав', version: '1.0.0',
      license: { name: 'Внутреннее использование Витавто' },
      description: 'Работа с заказами по сценариям process.html с проверкой прав роли по матрице index.html; ' +
        'запись настроек прав, процессов и пользователей API. Аутентификация: Authorization: Bearer <токен>; роль задаётся пользователю API.'
    },
    servers: [{ url: '/api/v1' }],
    security: [{ bearer: [] }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }, schemas },
    paths
  };
}

module.exports = { buildOpenApi };

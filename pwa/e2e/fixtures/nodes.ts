import { readModel } from './model';
import { domain, type DomainNode } from './domain';

// Единственный источник узлов — модель (P1). Никаких хардкод-списков в спеках.
//
// Два файла модели, и они РАЗНЫЕ (C2):
//   • docs/migration/ddd/node-map.json  — nodes это ОБЪЕКТ из 45 ключей;
//     поля: context, aggregate, command, api, emits, notifies, screen, stage, tests, manual.
//     НЕТ title и role.
//   • docs/migration/ddd/domain-model.json — nodes это МАССИВ из 45;
//     поля: id, role, title, full, cov, statuses, cols, next, tz, code, conflict.
//     Генерируется из process.html (tools/migration/extract-domain.mjs:52).
//
// Поэтому узел с ролью и названием берём из domain-model, а мету контекста/агрегата —
// из node-map, и склеиваем по id. Расхождение множеств id — ошибка модели, а не теста.

/** Узел модели + мета из node-map.json. */
export interface ProcessNode extends DomainNode {
  context?: string;
  aggregate?: string;
  command?: string;
  api?: string;
  stage?: number;
  tests?: string[];
}

export const nodeMap = readModel<{ nodes: Record<string, Partial<ProcessNode>> }>(
  'docs/migration/ddd/node-map.json',
);

const meta = nodeMap.nodes;

/** 45 узлов: роль/название/покрытие из domain-model, мета — из node-map. */
export const allNodes: ProcessNode[] = domain.nodes.map(n => ({
  ...n,
  ...(meta[n.id] ?? {}),
  id: n.id,
  role: n.role,
  title: n.title,
  cov: n.cov,
}));

/** Узлы domain-model, которых нет в node-map.json — расхождение моделей. */
export const nodesMissingMeta: string[] = allNodes.filter(n => !meta[n.id]).map(n => n.id);

/** Записи node-map.json, которых нет в domain-model. */
export const metaWithoutNode: string[] = Object.keys(meta).filter(id => !domain.nodes.some(n => n.id === id));

export const nodesByRole = (role: string): ProcessNode[] => allNodes.filter(n => n.role === role);
export const nodeById = (id: string): ProcessNode | undefined => allNodes.find(n => n.id === id);
export const rolesWithLanes = domain.roles;

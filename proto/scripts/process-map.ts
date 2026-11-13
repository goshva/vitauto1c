import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Карта процессов: 11 сценариев и 45 узлов модели → `db/process-map.json`.
//
// Тот же приём, что у `scripts/map.ts` (карта 82 столбцов): документ модели
// превращается в машинный артефакт, и приложение читает АРТЕФАКТ, а не markdown
// и не JSON репозитория. Иначе прототип зависел бы от раскладки каталогов.
//
// Детерминированность: повторный запуск даёт тот же файл (гейт этапа 1).

const SRC = resolve(import.meta.dir, '../../docs/migration/ddd/domain-model.json');
const OUT = resolve(import.meta.dir, '../db/process-map.json');

interface RawNode { id: string; role?: string; title?: string; full?: string }
interface RawStep { nodes?: string[]; note?: string; status?: string }
interface RawScenario { id: string; group?: string; title?: string; steps?: RawStep[] }
interface RawModel { scenarios?: RawScenario[]; nodes?: RawNode[] | Record<string, RawNode> }

const model = JSON.parse(readFileSync(SRC, 'utf8')) as RawModel;

const nodes = Array.isArray(model.nodes) ? model.nodes : Object.values(model.nodes ?? {});
const byId = new Map(nodes.map((n) => [n.id, n]));

const scenarios = (model.scenarios ?? []).map((s) => ({
  id: s.id,
  group: s.group ?? '',
  title: s.title ?? s.id,
  steps: (s.steps ?? []).map((st, i) => {
    const ids = st.nodes ?? [];
    return {
      n: i + 1,
      nodes: ids,
      /** Подписи узлов: приложение не должно знать про модель. */
      titles: ids.map((id) => byId.get(id)?.title ?? id),
      /** Роли узлов — по ним видно, кто выполняет шаг. */
      roles: [...new Set(ids.map((id) => byId.get(id)?.role ?? '').filter(Boolean))],
      note: st.note ?? '',
      /** Состояние строки ПОСЛЕ шага — по нему схема связывается с данными. */
      status: st.status ?? null,
    };
  }),
}));

if (scenarios.length !== 11) {
  throw new Error(`сценариев ${scenarios.length}, ожидалось 11 — модель изменилась`);
}
if (nodes.length !== 45) {
  throw new Error(`узлов ${nodes.length}, ожидалось 45 — модель изменилась`);
}

const uniqueStatuses = [...new Set(scenarios.flatMap((s) => s.steps.map((x) => x.status).filter(Boolean)))].sort();

const map = {
  generated: { scenarios: scenarios.length, nodes: nodes.length },
  statuses: uniqueStatuses,
  scenarios,
};

writeFileSync(OUT, `${JSON.stringify(map, null, 2)}\n`, 'utf8');

console.log(`db/process-map.json: ${scenarios.length} процессов, ${nodes.length} узлов`);
console.log(`задействованных состояний: ${uniqueStatuses.length} — ${uniqueStatuses.join(', ')}`);
for (const s of scenarios) console.log(`  ${s.id.padEnd(17)} шагов=${String(s.steps.length).padStart(2)}  ${s.title}`);

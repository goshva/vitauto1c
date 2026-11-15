import { pool } from './db.ts';
import { suggest, type Suggestion } from './domain/matching.ts';

// Живое подключение алгоритма похожести к экрану (п. 2).
//
// ПОЧЕМУ ОТДЕЛЬНЫМ МОДУЛЕМ. `unidentified-ui.ts` уже держит экран и привязку, и добавление
// поиска похожих вместе с пакетным разбором перевело бы его за предел 200 строк из §12.
// Здесь — только то, что связывает БАЗУ и чистый счётчик из `domain/matching.ts`.
//
// ЧТО ЗНАЧИТ «ПОХОЖЕ» ЗДЕСЬ. Сравниваем то, КАК НАПИСАЛ КЛИЕНТ (`line_fact.fact_name`),
// с названиями справочника. Артикул тоже смотрим — но лишь как способ показать его рядом:
// у клиента артикул свой, и совпадает он далеко не всегда.

/** Одна позиция с предложениями. */
export interface LineMatches {
  lineId: string;
  /** Как написал клиент. Пусто — писать нечего, сопоставлять не с чем. */
  written: string;
  /** Артикул от клиента — показывается рядом, в сравнении не участвует. */
  article: string | null;
  /** Заголовок позиции для экрана: то, что видит оператор. */
  title: string;
  suggestions: Suggestion[];
  /** Полоса лучшего предложения. */
  band: 'auto' | 'choose' | 'none';
}

/** Справочник и бренды: одинаковы для всех строк, читаются один раз. */
export interface MatchingContext {
  candidates: { id: string; name: string; article: string | null }[];
  brands: string[];
}

export async function matchingContext(): Promise<MatchingContext> {
  const c = await pool.query<{ id: string; name: string; article: string | null }>(
    `select id, name, article from nomenclature where deleted_at is null order by name`,
  );
  const b = await pool.query<{ name: string }>(
    `select name from brand where deleted_at is null`,
  );
  return { candidates: c.rows, brands: b.rows.map((x) => x.name) };
}

/** Строки, ждущие опознания, вместе с предложениями по каждой. */
export async function matchesForUnidentified(
  lines: { id: string; factName: string | null; factArticle: string | null }[],
  ctx: MatchingContext,
): Promise<LineMatches[]> {
  return lines.map((l) => {
    const written = (l.factName ?? '').trim();
    // Пустое написание — не «не найдено», а «нечего сопоставлять»: подсказывать тут
    // нечем, и показывать полосу `none` с чужими словами было бы обманом.
    const suggestions = written === ''
      ? []
      : suggest(written, ctx.candidates, { brands: ctx.brands, limit: 5 });

    return {
      lineId: l.id,
      written,
      article: l.factArticle,
      title: written || 'без названия',
      suggestions,
      band: suggestions[0]?.band ?? 'none',
    };
  });
}

/** Сколько в каждой полосе — для сводки и для пакетного разбора. */
export function bandCounts(items: LineMatches[]): { auto: number; choose: number; none: number } {
  const counts = { auto: 0, choose: 0, none: 0 };
  for (const m of items) counts[m.band]++;
  return counts;
}

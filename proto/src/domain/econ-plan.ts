import { round2, type LaborPlan, type MonthParams, type MonthPlan, type PartPlan } from './econ.ts';

// ПЛАН МЕСЯЦА: синтетические входные значения.
//
// Здесь НЕТ денег «на выходе» — только то, что вводится: сколько позиций, по какой
// закупочной цене, с каким множителем и сколько нормо-часов. Цена продажи считается
// из множителя, а не задаётся: иначе проверять было бы нечего — модель просто
// повторяла бы заранее известный ответ.
//
// Генератор детерминированный (LCG): месяц повторяется до копейки, и падение теста
// можно воспроизвести тем же `seed`.

/** Линейный конгруэнтный генератор. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Запчасти: артикул и закупочная цена. Артикулы — из сида справочников. */
const PARTS: { article: string; cost: number }[] = [
  { article: 'FLT-OIL-001', cost: 395 },
  { article: 'FLT-OIL-002', cost: 460 },
  { article: 'MOT5W30-5L', cost: 1200 },
  { article: 'FLT-AIR-001', cost: 1300 },
  { article: 'FLT-CAB-001', cost: 1050 },
  { article: 'BRK-FR-001', cost: 2250 },
  { article: 'SPK-IR-001', cost: 1200 },
  { article: 'ANT-G12-5L', cost: 1650 },
];

const WORKS = ['Замена масла и фильтра', 'Замена тормозных колодок', 'Диагностика подвески',
  'Замена свечей', 'ТО-2 (регламент)', 'Замена воздушного фильтра'];

const PROCESSES = { happy: 'happy', stock: 'stock', repair: 'car_repair_in' } as const;

/** Цена нормо-часа для работ месяца, ₽. */
const HOUR_RATE = 1500;

/** Предварительный план месяца: те же числа, что уйдут в сид. */
export function planMonth(p: MonthParams): MonthPlan {
  const next = rng(p.seed);
  const parts: PartPlan[] = [];
  const works: LaborPlan[] = [];

  /** Одна позиция заявки: закупка, множитель и цена продажи. */
  const makePart = (process: string, key: string, orderKey: string | null): PartPlan => {
    const item = PARTS[Math.floor(next() * PARTS.length)]!;
    const qty = 1 + Math.floor(next() * 3);
    const coefficient = round2(1.3 + next() * 0.35);
    return {
      key, process, orderKey, article: item.article, qty,
      costPrice: item.cost, coefficient,
      // Тот же порядок, что у сервера: закупка × множитель, округление до копеек.
      salePrice: round2(item.cost * coefficient),
    };
  };

  for (let i = 0; i < p.happyLines; i++) parts.push(makePart(PROCESSES.happy, `happy-${i + 1}`, null));
  for (let i = 0; i < p.stockLines; i++) parts.push(makePart(PROCESSES.stock, `stock-${i + 1}`, null));

  for (let o = 1; o <= p.workOrders; o++) {
    for (let k = 1; k <= p.partsPerOrder; k++) {
      parts.push(makePart(PROCESSES.repair, `repair-${o}-p${k}`, `repair-${o}`));
    }
    for (let w = 1; w <= p.laborPerOrder; w++) {
      const normHours = round2(1 + next() * 5);
      works.push({
        key: `repair-${o}-w${w}`,
        orderKey: `repair-${o}`,
        name: WORKS[Math.floor(next() * WORKS.length)]!,
        normHours,
        hourRate: HOUR_RATE,
        amount: round2(normHours * HOUR_RATE),
      });
    }
  }

  const byProcess: Record<string, number> = {};
  for (const part of parts) byProcess[part.process] = (byProcess[part.process] ?? 0) + 1;

  return { params: p, parts, works, byProcess };
}

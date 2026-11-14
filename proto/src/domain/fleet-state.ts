// Состояния ТС и срок регламентного ТО.
//
// Заказчик (Q2): пробег — триггер планового ТО. Ключевое решение: срок считается
// ОТ ПОСЛЕДНЕГО ВЫПОЛНЕННОГО ТО, а не от календаря. Машина, стоявшая полгода в
// гараже, не должна получать заявку на ТО, а проехавшая 20 000 км за месяц —
// должна. Поэтому нужны и `mileageAtService`, и `lastServiceAt`.

type VehicleStatus = 'on_line' | 'in_repair' | 'written_off';

export const VEHICLE_STATUSES: Record<VehicleStatus, { title: string }> = {
  on_line: { title: 'На линии' },
  in_repair: { title: 'В ремонте' },
  written_off: { title: 'Списано' },
};

/** Название состояния для оператора. Неизвестное отдаётся как есть, не пустой строкой. */
export const vehicleStatusTitle = (status: string): string =>
  VEHICLE_STATUSES[status as VehicleStatus]?.title ?? status;

export interface CarState {
  mileage: number | null;
  mileageAtService: number | null;
  lastServiceAt: Date | null;
}

export interface MaintenanceRule {
  mileageInterval: number | null;
  dayInterval: number | null;
}

interface MaintenanceDue {
  due: boolean;
  /** Почему подняли: по пробегу, по сроку, либо ТО не делали ни разу. */
  reason: 'mileage' | 'days' | 'never' | null;
  /** Сколько км осталось до ТО; отрицательное — просрочено. */
  remainingKm: number | null;
  /** Сколько дней осталось; отрицательное — просрочено. */
  remainingDays: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Пора ли на ТО.
 *
 * Правило с пустыми интервалами не поднимает никого — это «правило-заглушка»,
 * а не «поднять всех». Иначе одна забытая запись подняла бы весь автопарк.
 */
export function maintenanceDue(car: CarState, rule: MaintenanceRule, now: Date): MaintenanceDue {
  const hasMileage = rule.mileageInterval !== null && rule.mileageInterval > 0;
  const hasDays = rule.dayInterval !== null && rule.dayInterval > 0;

  if (!hasMileage && !hasDays) {
    return { due: false, reason: null, remainingKm: null, remainingDays: null };
  }

  // ТО не делали ни разу: новая машина попадает в список сразу. Для машины с
  // историей это означало бы «нет данных» — но `lastServiceAt` заполняется
  // вместе с приёмкой, и пустое значение здесь означает именно «не делали».
  if (car.lastServiceAt === null && car.mileageAtService === null) {
    return { due: true, reason: 'never', remainingKm: null, remainingDays: null };
  }

  const remainingKm = hasMileage && car.mileage !== null
    ? rule.mileageInterval! - (car.mileage - (car.mileageAtService ?? 0))
    : null;

  const remainingDays = hasDays && car.lastServiceAt !== null
    ? rule.dayInterval! - Math.floor((now.getTime() - car.lastServiceAt.getTime()) / MS_PER_DAY)
    : null;

  // По пробегу судим только если пробег ИЗВЕСТЕН: без него нельзя сказать
  // «проехала достаточно», и остаётся календарь.
  const byMileage = remainingKm !== null && remainingKm <= 0;
  const byDays = remainingDays !== null && remainingDays <= 0;

  if (!byMileage && !byDays) {
    return { due: false, reason: null, remainingKm, remainingDays };
  }

  return {
    due: true,
    // Пробег важнее календаря: если сработали оба, показываем пробег — он
    // понятнее механику.
    reason: byMileage ? 'mileage' : 'days',
    remainingKm,
    remainingDays,
  };
}

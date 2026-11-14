import { maintenanceDue, vehicleStatusTitle } from './domain/fleet-state.ts';

// Общий запрос автопарка: список ТС с подразделением, госномером и правилом ТО.
//
// Вынесено из `fleet.ts`: там уже три маршрута, и на карточку с правкой файл
// перевалил за 200 строк. Запрос один и тот же у списка, у карточки и у списка
// ТО — три копии разошлись бы при первой правке правила выбора нормы ТО.

/** Все машины с подразделением, госномером и подходящим правилом ТО. */
export const LIST_SQL = `
  select c.id, c.code, c.name, c.vin, c.year, c.mileage, c.mileage_at_service,
         c.last_service_at, c.status,
         d.name as department,
         (select a.value_value from car_attribute a
           where a.car_id = c.id and a.attr_kind = 'plate' and a.deleted_at is null limit 1) as plate,
         r.mileage_interval, r.day_interval
    from car c
    left join department d on d.id = c.department_id and d.deleted_at is null
    left join lateral (
      -- Правило для модели важнее общего: сначала ищем подходящее по модели,
      -- и только потом берём правило «для всех» (car_model_id is null).
      --
      -- Второй ключ сортировки обязателен: правило БЕЗ интервалов («Без
      -- регламента») не должно перебивать настоящее. Без него заглушка с кодом,
      -- который сортируется первым по алфавиту, выбиралась для всех машин,
      -- и список ТО оказывался пустым.
      select mileage_interval, day_interval
        from maintenance_rule r2
       where r2.deleted_at is null
         and (r2.car_model_id = c.model_id or r2.car_model_id is null)
       order by (r2.car_model_id is not null) desc,
                ((r2.mileage_interval is not null) or (r2.day_interval is not null)) desc,
                r2.code
       limit 1
    ) r on true
   where c.deleted_at is null`;

export interface CarRow {
  id: string; code: string | null; name: string; vin: string | null; year: number | null;
  mileage: number | null; mileage_at_service: number | null; last_service_at: Date | null;
  status: string; department: string | null; plate: string | null;
  mileage_interval: number | null; day_interval: number | null;
}

/** Строка БД → элемент ответа. Срок ТО считается здесь, а не в SQL: формула — домен. */
export const toItem = (r: CarRow, now: Date) => ({
  id: r.id, code: r.code, name: r.name, vin: r.vin, year: r.year,
  mileage: r.mileage, mileageAtService: r.mileage_at_service,
  status: r.status, statusTitle: vehicleStatusTitle(r.status),
  department: r.department, plate: r.plate,
  due: maintenanceDue(
    { mileage: r.mileage, mileageAtService: r.mileage_at_service, lastServiceAt: r.last_service_at },
    { mileageInterval: r.mileage_interval, dayInterval: r.day_interval },
    now,
  ),
});

/** Причина на языке оператора: не «mileage», а «по пробегу». */
export const REASON_TITLES: Record<string, string> = {
  mileage: 'по пробегу',
  days: 'по сроку',
  never: 'ТО не делали',
};

/** Фильтры списка ТС. */
export function whereOf(query: { departmentId?: string; status?: string }): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (query.departmentId) { params.push(query.departmentId); parts.push(`c.department_id = $${params.length}`); }
  if (query.status) { params.push(query.status); parts.push(`c.status = $${params.length}`); }
  return { sql: parts.length ? ` and ${parts.join(' and ')}` : '', params };
}

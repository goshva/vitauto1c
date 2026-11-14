import { describe, expect, test } from 'bun:test';
import { maintenanceDue, vehicleStatusTitle, VEHICLE_STATUSES } from '../../src/domain/fleet-state.ts';
import { checkInvoiceTransition, INVOICE_STATES } from '../../src/domain/invoice-state.ts';

// Домен автопарка: срок ТО и состояния.
//
// Тест написан ДО реализации. Главное, что проверяется, — СРОК СЧИТАЕТСЯ ОТ
// ПОСЛЕДНЕГО ТО, а не от календаря: иначе машина, стоявшая полгода в гараже,
// получит заявку на ТО ни за что, а машина, проехавшая 20 000 км за месяц,
// не получит её вовсе.

describe('срок регламентного ТО', () => {
  const rule = { mileageInterval: 10_000, dayInterval: 365 };

  test('пробег не дошёл — ТО не требуется', () => {
    const due = maintenanceDue(
      { mileage: 100_000, mileageAtService: 95_000, lastServiceAt: new Date('2026-01-01') },
      rule,
      new Date('2026-06-01'),
    );
    expect(due.due).toBe(false);
    expect(due.remainingKm).toBe(5_000);
  });

  test('пробег дошёл ровно до интервала — ТО требуется', () => {
    const due = maintenanceDue(
      { mileage: 105_000, mileageAtService: 95_000, lastServiceAt: new Date('2026-01-01') },
      rule,
      new Date('2026-06-01'),
    );
    expect(due.due).toBe(true);
    expect(due.remainingKm).toBe(0);
    expect(due.reason).toBe('mileage');
  });

  test('пробег перевалил — остаток отрицательный, ТО тем более требуется', () => {
    const due = maintenanceDue(
      { mileage: 107_500, mileageAtService: 95_000, lastServiceAt: new Date('2026-01-01') },
      rule,
      new Date('2026-06-01'),
    );
    expect(due.due).toBe(true);
    expect(due.remainingKm).toBe(-2_500);
  });

  test('календарный срок истёк, пробег нет — ТО по сроку', () => {
    const due = maintenanceDue(
      { mileage: 96_000, mileageAtService: 95_000, lastServiceAt: new Date('2025-01-01') },
      rule,
      new Date('2026-06-01'),
    );
    expect(due.due).toBe(true);
    expect(due.reason).toBe('days');
    expect(due.remainingDays).toBeLessThanOrEqual(0);
  });

  test('ТО ни разу не делали — требуется сразу', () => {
    const due = maintenanceDue(
      { mileage: 500, mileageAtService: null, lastServiceAt: null },
      rule,
      new Date('2026-06-01'),
    );
    expect(due.due, 'новая машина без ТО должна попадать в список').toBe(true);
    expect(due.reason).toBe('never');
  });

  test('правило без интервалов никого не поднимает', () => {
    const due = maintenanceDue(
      { mileage: 999_999, mileageAtService: 0, lastServiceAt: new Date('2000-01-01') },
      { mileageInterval: null, dayInterval: null },
      new Date('2026-06-01'),
    );
    expect(due.due).toBe(false);
  });

  test('пробег неизвестен — судим по календарю, а не гадаем', () => {
    const due = maintenanceDue(
      { mileage: null, mileageAtService: null, lastServiceAt: new Date('2025-01-01') },
      rule,
      new Date('2026-06-01'),
    );
    expect(due.due).toBe(true);
    expect(due.reason).toBe('days');
  });
});

describe('состояния ТС', () => {
  test('три состояния с названиями для оператора', () => {
    expect(Object.keys(VEHICLE_STATUSES)).toEqual(['on_line', 'in_repair', 'written_off']);
    expect(vehicleStatusTitle('on_line')).toBe('На линии');
    expect(vehicleStatusTitle('in_repair')).toBe('В ремонте');
    expect(vehicleStatusTitle('written_off')).toBe('Списано');
  });

  test('неизвестное состояние не превращается в пустую строку', () => {
    expect(vehicleStatusTitle('что-то')).toBe('что-то');
  });
});

describe('состояния счёта', () => {
  test('три состояния: черновик → отправлен → оплачен', () => {
    expect(Object.keys(INVOICE_STATES)).toEqual(['draft', 'sent', 'paid']);
    expect(INVOICE_STATES.paid.title).toBe('Оплачен');
  });

  test('допустимые переходы', () => {
    expect(checkInvoiceTransition('draft', 'sent')).toBeNull();
    expect(checkInvoiceTransition('sent', 'paid')).toBeNull();
    expect(checkInvoiceTransition('draft', 'paid'), 'нельзя оплатить неотправленный').toBeTruthy();
    expect(checkInvoiceTransition('paid', 'sent'), 'оплаченный не откатывается').toBeTruthy();
  });
});

// Перевод ссылки 1С из хранения PostgreSQL (_IDRRef, 16 байт) в UUID, который 1С показывает как Ref_Key / УникальныйИдентификатор().
// Правило проверено на vitauto_dev (гейт G0.3): байты 9–16 идут первыми, затем группы 3, 2, 1 GUID в обратном порядке.
// Тот же алгоритм — SQL-функция onec.uuid (план, раздел 5.2) и Go backend/internal/onec.
export const EMPTY_REF = '00000000000000000000000000000000';

export function onecUuid(hex) {
  const h = String(hex).toLowerCase().replace(/^\\x/, '');
  if (!/^[0-9a-f]{32}$/.test(h)) throw new TypeError(`_IDRRef: ожидается 32 hex-символа, получено «${hex}»`);
  if (h === EMPTY_REF) return null; // пустая ссылка 1С -> NULL
  return `${h.slice(24, 32)}-${h.slice(20, 24)}-${h.slice(16, 20)}-${h.slice(0, 4)}-${h.slice(4, 16)}`;
}

export function onecIdrref(uuid) {
  const u = String(uuid).toLowerCase().replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(u)) throw new TypeError(`UUID: «${uuid}»`);
  // u = g1(8) g2(4) g3(4) g4(4) g5(12) -> hex = g4 g5 g3 g2 g1
  return u.slice(16, 20) + u.slice(20, 32) + u.slice(12, 16) + u.slice(8, 12) + u.slice(0, 8);
}

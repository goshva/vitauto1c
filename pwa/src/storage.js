// localStorage может быть недоступен (приватный режим) — приложение работает и без него.
export function load(key, fallback) {
  try {
    const v = localStorage.getItem('arm.' + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

// Сессия (Basic-токен содержит пароль) — только sessionStorage: живёт до закрытия вкладки.
export function loadSession(key, fallback) {
  try {
    const v = sessionStorage.getItem('arm.' + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function saveSession(key, value) {
  try {
    if (value === undefined || value === null) sessionStorage.removeItem('arm.' + key);
    else sessionStorage.setItem('arm.' + key, JSON.stringify(value));
  } catch { /* без сохранения */ }
}

export function save(key, value) {
  try {
    if (value === undefined || value === null) localStorage.removeItem('arm.' + key);
    else localStorage.setItem('arm.' + key, JSON.stringify(value));
  } catch { /* без сохранения */ }
}

// localStorage может быть недоступен (приватный режим) — приложение работает и без него.
export function load(key, fallback) {
  try {
    const v = localStorage.getItem('arm.' + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    if (value === undefined || value === null) localStorage.removeItem('arm.' + key);
    else localStorage.setItem('arm.' + key, JSON.stringify(value));
  } catch { /* без сохранения */ }
}

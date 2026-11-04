// mitt.js — мини-эммитер (как mitt): on/off/emit по имени события.
export function mitt() {
  const map = new Map();
  return {
    on(type, handler) {
      (map.get(type) || map.set(type, new Set()).get(type)).add(handler);
    },
    off(type, handler) {
      map.get(type)?.delete(handler);
    },
    emit(type, event) {
      map.get(type)?.forEach(h => { try { h(event); } catch { /* обработчик не роняет шину */ } });
    }
  };
}

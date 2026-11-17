// ПАНЕЛЬ ВСТАВКИ ЗАЯВКИ КЛИЕНТА (N1 → M1).
//
// Вынесена из `lines-ui.ts` по размеру, но разделение вышло по смыслу: это САМОСТОЯТЕЛЬНЫЙ
// БЛОК РАЗМЕТКИ — форма загрузки листа клиента, — и он не зависит ни от списка строк, ни от
// отбора. У него своя причина меняться: меняются поля заявки, а не экран целиком.

/**
 * Панель свёрнута в `details`: загрузка листа нужна не каждый день, а место занимает.
 *
 * ВСТАВКА ИЗ БУФЕРА — ОТДЕЛЬНАЯ ФОРМА, а не поле в этой: заявку присылают таблицей из Excel,
 * и вставлять её надо ЦЕЛИКОМ, а не по одной строке. Шаблон скачивают, заполняют и вставляют
 * одним куском — это быстрее и меньше поводов ошибиться.
 */
export function importPanel(): string {
  return `<details class="import" data-testid="import-panel">
      <summary>Загрузить лист клиента (N1 → M1)</summary>

      <p class="hint">Вставить заявку таблицей из Excel —
        <a href="/ui/lines/paste-form" data-testid="paste-open"
           hx-get="/ui/lines/paste-form" hx-target="#paste-panel" hx-swap="outerHTML">открыть
        вставку из буфера</a>: скачайте шаблон, заполните и вставьте целиком.</p>
      <div id="paste-panel" data-testid="paste-panel"></div>

      <form data-testid="import-form" hx-post="/ui/lines/import"
            hx-target="#lines-panel" hx-swap="outerHTML">
        <label>Наименование <input name="name" data-testid="import-name" required></label>
        <label>Артикул <input name="article" data-testid="import-article"></label>
        <label>Кол-во <input name="qty" data-testid="import-qty" size="4"></label>
        <label>Ед. <input name="unit" data-testid="import-unit" size="4" value="шт"></label>
        <label>№ заказа клиента <input name="clientNumber" data-testid="import-client-number"></label>
        <button type="submit" data-testid="import-submit">Создать заказ</button>
      </form>
    </details>`;
}

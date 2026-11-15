import { esc } from './html.ts';
import { COLUMNS } from '../import-template.ts';

// Форма вставки заявки (ФТ v2 п. 8).
//
// Экран устроен так, чтобы оператор не гадал:
//   1. ссылка на ШАБЛОН — файлом, потому что заполняют его в Excel;
//   2. образец шаблона прямо на экране — чтобы было видно, что копировать;
//   3. большое поле вставки, куда вставляют ЦЕЛИКОМ, вместе с шапкой.

export interface PasteDone {
  number: string;
  lines: number;
}

export function importPanel(
  template: string,
  errors: string[] = [],
  done?: PasteDone,
): string {
  const errorBlock = errors.length > 0
    ? `<div class="hint-partial" data-testid="paste-errors">
        <strong>Что не разобралось:</strong>
        <ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
      </div>`
    : '';

  const doneBlock = done
    ? `<p class="hint" data-testid="paste-done">
        Заказ <strong>${esc(done.number)}</strong> создан: строк ${done.lines}.
        Строки в состоянии «Новый» — их видно в <a href="/lines">списке</a>.
      </p>`
    : '';

  return `<div id="paste-panel" data-testid="paste-panel">
  ${doneBlock}
  ${errorBlock}

  <p class="hint">
    Заполните <a href="/ui/lines/template" data-testid="paste-template-link" download>шаблон</a>
    и вставьте заполненное сюда — целиком, вместе с шапкой. Разделитель: табуляция,
    «;» или «,». Дробная часть: и запятая, и точка.
  </p>

  <details class="paste-hint" data-testid="paste-example">
    <summary>Показать образец шаблона</summary>
    <pre data-testid="paste-example-text">${esc(template.trimEnd())}</pre>
    <p class="hint">Колонки: ${COLUMNS.map((c) => esc(c)).join(' · ')}</p>
  </details>

  <form hx-post="/ui/lines/paste" hx-target="#paste-panel" hx-swap="outerHTML"
        data-testid="paste-form">
    <label class="paste-field">Вставьте заявку (Ctrl+V)
      <textarea name="pasted" rows="8" data-testid="paste-input"
        placeholder="Наименование;Артикул;Кол-во;Ед.;Гос. номер;Срочно;База"></textarea>
    </label>
    <input type="hidden" name="customerId" value="66666666-6666-6666-6666-666666666601">
    <button type="submit" data-testid="paste-submit">Загрузить заявку</button>
  </form>
</div>`;
}

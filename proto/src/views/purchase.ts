import { esc } from './html.ts';

// Форма закупки (ФТ v2 п. 16): выбор поставщика, подсказка «у кого и по какой цене»
// и блок «Аналоги».
//
// Отдельный файл от `actions.ts`: тот держит панель действий списка, а это —
// самостоятельная форма со своими данными. Смешивать их значило бы вернуть в один
// файл две разные задачи.

export interface SupplierOption {
  id: string;
  name: string;
  /** Сколько раз у него покупали. По этому и выбирают. */
  purchases: number;
}

export interface PurchaseHistoryRow {
  supplier: string | null;
  price: string | null;
  date: string | null;
  number: string | null;
}

export interface AnalogOption {
  id: string;
  name: string;
  article: string | null;
  onHand: string;
}

export interface PurchaseFormProps {
  lineId: string;
  title: string;
  article: string | null;
  identified: boolean;
  suppliers: SupplierOption[];
  history: PurchaseHistoryRow[];
  analogs: AnalogOption[];
}

/** «У кого и по какой цене» — то, ради чего форма и существует. */
function historyBlock(rows: PurchaseHistoryRow[]): string {
  if (rows.length === 0) {
    return `<p class="hint" data-testid="purchase-no-history">
      Позицию ещё не покупали — выбирайте поставщика сами.</p>`;
  }

  const list = rows.map((h) => `<li data-testid="purchase-history-row">
    <strong>${esc(h.supplier ?? 'поставщик не указан')}</strong>
    — ${esc(h.price ?? 'цена не указана')} ₽
    ${h.date ? `· ${esc(h.date)}` : ''}
    ${h.number ? `· ${esc(h.number)}` : ''}
  </li>`).join('\n    ');

  return `<div class="purchase-history" data-testid="purchase-history">
    <span class="chain-label">У кого и по какой цене покупали:</span>
    <ul>${list}</ul>
  </div>`;
}

/** «Аналоги» — чем заменить, если позиции нет. */
function analogsBlock(rows: AnalogOption[]): string {
  if (rows.length === 0) {
    return `<p class="hint" data-testid="purchase-no-analogs">Аналогов не заведено.</p>`;
  }

  const list = rows.map((a) => `<li data-testid="purchase-analog-row">
    ${esc(a.name)}${a.article ? ` · ${esc(a.article)}` : ''}
    — на складе ${esc(a.onHand)}
  </li>`).join('\n    ');

  return `<div class="purchase-analogs" data-testid="purchase-analogs">
    <span class="chain-label">Аналоги:</span>
    <ul>${list}</ul>
  </div>`;
}

export function purchasePanel(p: PurchaseFormProps): string {
  // Без номенклатуры закупать нечего: сначала опознание (K8, A1). Иначе заказ
  // поставщику ушёл бы на позицию «как написал клиент», и поставщик её не найдёт.
  if (!p.identified) {
    return `<div id="purchase-panel" data-testid="purchase-panel">
      <p class="hint-partial" data-testid="purchase-need-identify">
        Позиция «${esc(p.title)}» ещё не опознана — сначала сопоставьте её с номенклатурой
        на экране <a href="/unidentified">Неопознанные</a>.
      </p>
    </div>`;
  }

  const options = p.suppliers.map((s) => `<option value="${esc(s.id)}">${
    esc(s.name)}${s.purchases > 0 ? ` · закупок: ${s.purchases}` : ''}</option>`).join('\n      ');

  return `<div id="purchase-panel" data-testid="purchase-panel">
  <span class="chain-label" data-testid="purchase-title">
    Новая закупка: ${esc(p.title)}${p.article ? ` · ${esc(p.article)}` : ''}
  </span>

  ${historyBlock(p.history)}
  ${analogsBlock(p.analogs)}

  <form class="purchase-form" data-testid="purchase-form"
        hx-post="/ui/supply/purchase" hx-target="#purchase-panel" hx-swap="outerHTML">
    <input type="hidden" name="lineId" value="${esc(p.lineId)}">
    <label>Поставщик
      <select name="supplierId" data-testid="purchase-supplier">
        <option value="">— выберите —</option>
        ${options}
      </select>
    </label>
    <button type="submit" data-testid="purchase-submit">Создать закупку</button>
  </form>
</div>`;
}

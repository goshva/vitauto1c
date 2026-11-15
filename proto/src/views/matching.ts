import { esc } from './html.ts';
import { MATCH_BANDS, type Suggestion } from '../domain/matching.ts';
import type { LineMatches } from '../matching-lines.ts';

// Показ предложений по сопоставлению (п. 2).
//
// ТРИ ПОЛОСЫ — ТРИ РАЗНЫХ ЭКРАНА, и различие тут не украшение:
//
//   ≥ 0.80  подставляем САМИ и говорим об этом прямо («подставлено автоматически»).
//           Оператор видит не «мы что-то сделали», а что именно и с какой оценкой;
//   0.45-0.80 показываем список. Решает человек: сюда попадают уточнения
//           («иридиевая»), опечатки в справочнике и близнецы-аналоги;
//   < 0.45  говорим «в справочнике нет» и ПРЕДЛАГАЕМ завести позицию. Молчаливое
//           подставление ближайшего сюда было бы выдумыванием данных: 15 из 23
//           написаний в legacy именно такие.
//
// ОЦЕНКА ПОКАЗЫВАЕТСЯ ВСЕГДА и рядом с ней — какие слова совпали. Без объяснения
// оператор не понимает, ПОЧЕМУ предложено, и не может проверить.

/** Полоса словами — вместе с тем, что она означает для работы. */
export function bandTitle(band: string): string {
  if (band === 'auto') return 'подставить';
  if (band === 'choose') return 'выбрать';
  return 'в справочнике нет';
}

function suggestionRow(m: LineMatches, s: Suggestion): string {
  return `<li class="match-option">
    <form hx-post="/ui/unidentified/bind" hx-target="#unidentified-panel" hx-swap="outerHTML">
      <input type="hidden" name="lineId" value="${esc(m.lineId)}">
      <input type="hidden" name="nomenclatureId" value="${esc(s.id)}">
      <button type="submit" data-testid="match-apply-${esc(m.lineId)}-${esc(s.id)}">
        <span class="match-score">${s.score.toFixed(2)}</span>
        <span class="match-name">${esc(s.name)}</span>
        ${s.article ? `<span class="match-article">${esc(s.article)}</span>` : ''}
      </button>
    </form>
    <span class="hint">совпало: ${s.common.map((w) => esc(w)).join(', ') || '—'}${
    s.headMatch ? ' · главное слово совпало' : ''}</span>
  </li>`;
}

function lineBlock(m: LineMatches): string {
  const head = `<div class="match-head">
    <b data-testid="match-written-${esc(m.lineId)}">${esc(m.title)}</b>
    ${m.article ? `<span class="match-article hint">арт. ${esc(m.article)}</span>` : ''}
    <span class="match-band match-band-${esc(m.band)}"
          data-testid="match-band-${esc(m.lineId)}">${esc(bandTitle(m.band))}</span>
  </div>`;

  if (m.written === '') {
    return `<div class="match" data-testid="match-${esc(m.lineId)}">${head}
      <p class="hint">Клиент не написал название — сопоставлять нечего.
        Заведите позицию или привяжите вручную ниже.</p>
    </div>`;
  }

  if (m.suggestions.length === 0) {
    // НИЧЕГО НЕ НАЙДЕНО — это ответ, а не пустота. Молчание заставило бы оператора
    // думать, что поиск сломан.
    return `<div class="match" data-testid="match-${esc(m.lineId)}">${head}
      <p class="hint" data-testid="match-none-${esc(m.lineId)}">
        Похожего в справочнике нет — ближайшее ниже порога похожести.
        Заведите позицию в
        <a href="/unidentified" data-testid="match-create-${esc(m.lineId)}">справочнике</a>,
        иначе позиция останется неопознанной.
      </p>
    </div>`;
  }

  const top = m.suggestions[0]!;
  const auto = m.band === 'auto'
    ? `<p class="hint" data-testid="match-auto-${esc(m.lineId)}">
         Подставлено автоматически: <b>${esc(top.name)}</b>
         (оценка ${top.score.toFixed(2)}, порог ${MATCH_BANDS.auto}).
         Если это не та деталь — выберите другую ниже.
       </p>`
    : '';

  return `<div class="match" data-testid="match-${esc(m.lineId)}">${head}
    ${auto}
    <ul class="match-list">${m.suggestions.map((s) => suggestionRow(m, s)).join('')}</ul>
  </div>`;
}

/** Панель сопоставления целиком. */
export function matchesPanel(items: LineMatches[], counts: {
  auto: number; choose: number; none: number;
}, options: { canAuto?: boolean } = {}): string {
  if (items.length === 0) {
    return `<div id="matches-panel" data-testid="matches-panel" data-total="0">
      <p class="hint" data-testid="matches-empty">
        Неопознанных позиций нет — сопоставлять нечего.
      </p>
    </div>`;
  }

  const autoBlock = options.canAuto !== true || counts.auto === 0
    ? ''
    : `<form hx-post="/ui/unidentified/auto-match" hx-target="#unidentified-panel"
             hx-swap="outerHTML" data-testid="auto-match-form">
        <button type="submit" data-testid="auto-match-run">
          Подставить автоматически: ${counts.auto}
        </button>
        <span class="hint">
          Будут привязаны только позиции с оценкой ${MATCH_BANDS.auto} и выше.
          Остальные ${counts.choose + counts.none} останутся вам.
        </span>
        <span class="hint">Сначала покажем, что именно изменится, — без подтверждения
          ничего не меняется.</span>
      </form>`;

  return `<div id="matches-panel" data-testid="matches-panel" data-total="${items.length}"
     data-auto="${counts.auto}" data-choose="${counts.choose}" data-none="${counts.none}">
  <p class="hint" data-testid="matches-summary">
    Неопознанных: ${items.length}.
    Подставить можно ${counts.auto} (оценка ${MATCH_BANDS.auto} и выше),
    выбрать вручную ${counts.choose},
    в справочнике нет ${counts.none}.
  </p>
  ${autoBlock}
  ${items.map(lineBlock).join('\n')}
</div>`;
}

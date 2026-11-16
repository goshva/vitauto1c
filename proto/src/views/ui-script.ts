// КЛИЕНТСКИЙ СКРИПТ страницы: тема, сворачивание меню и отбор по клику на ячейку.
//
// ВЫНЕСЕН ИЗ `html.ts` по размеру и по смыслу: там сборка разметки, здесь поведение в
// браузере. Разные области — разные причины меняться.
//
// ВНИМАНИЕ ПРИ ПРАВКАХ: это ШАБЛОННАЯ СТРОКА. Обратная кавычка внутри текста закроет её
// и порвёт разметку — так уже случалось, когда в комментарии пометили имя атрибута.
// Проверка типов такое ловит, но сообщение у неё невнятное.

export const UI_SCRIPT = `(function(){try{
var t=localStorage.getItem('arm.theme');if(t)document.documentElement.setAttribute('data-theme',t);
var n=localStorage.getItem('arm.nav');document.documentElement.setAttribute('data-nav',n||'expanded');
}catch(e){document.documentElement.setAttribute('data-nav','expanded');}})();
function armTheme(){var r=document.documentElement;
var now=r.getAttribute('data-theme')||'';
var next=now==='dark'?'light':now==='light'?'':'dark';
if(next)r.setAttribute('data-theme',next);else r.removeAttribute('data-theme');
try{localStorage.setItem('arm.theme',next||'');}catch(e){}}
function armNav(){var r=document.documentElement;
var collapsed=r.getAttribute('data-nav')==='collapsed';
var next=collapsed?'expanded':'collapsed';
r.setAttribute('data-nav',next);
var b=document.getElementById('nav-toggle');
if(b){b.setAttribute('aria-expanded',String(!(next==='collapsed')));
b.setAttribute('title',collapsed?'Свернуть меню':'Развернуть меню');
b.setAttribute('aria-label',collapsed?'Свернуть меню':'Развернуть меню');}
try{localStorage.setItem('arm.nav',next);}catch(e){}}
/* ОТБОР ПО КЛИКУ НА ЯЧЕЙКУ РЕЕСТРА.
 *
 * Поле отбора берётся из атрибута data-filter у ячейки — связь задана в разметке, а не
 * порядковым номером колонки: номер пришлось бы держать в двух местах, и первая же
 * вставка колонки сломала бы отбор молча.
 *
 * ДЛЯ СПИСКА СРАВНИВАЕМ ПО ПОДПИСИ, А НЕ ПО ЗНАЧЕНИЮ. В ячейке написано «Новый», а в
 * списке состояний значение — new. Искать по значению значило бы переводить одно в
 * другое здесь же; подпись уже переведена на сервере, и она у них общая.
 *
 * ПУСТАЯ ЯЧЕЙКА («—») ОТБОР НЕ ЗАПОЛНЯЕТ: отбор «по пустоте» не предусмотрен, и
 * подставлять туда прочерк значило бы искать строки со словом «—».
 *
 * ВНИМАНИЕ: обратные кавычки в этом тексте НЕДОПУСТИМЫ — он сам внутри шаблонной
 * строки, и первая же кавычка закрыла бы её. Я на этом попался: пометки вокруг имён
 * атрибутов порвали разметку страницы.
 */
function armFilter(td){
  var name=td.getAttribute('data-filter');
  if(!name)return;
  var form=document.querySelector('[data-testid="filters-panel"]');
  if(!form)return;
  var field=form.querySelector('[name="'+name+'"]');
  if(!field)return;
  var text=(td.textContent||'').trim();
  if(!text||text==='—')return;
  if(field.tagName==='SELECT'){
    var hit=null;
    for(var i=0;i<field.options.length;i++){
      if(field.options[i].textContent.trim()===text){hit=field.options[i];break;}
    }
    if(!hit)return;
    field.value=hit.value;
  }else{
    field.value=text;
  }
  /* Отбор применяется СРАЗУ: «автоматическое заполнение по клику» — это про то, чтобы
   * не ходить за кнопкой. Значения остальных полей сохраняются: форма отправляется
   * целиком, и условия складываются. */
  form.requestSubmit?form.requestSubmit():form.submit();
}
document.addEventListener('click',function(e){
  var td=e.target.closest?e.target.closest('table.lines td[data-filter]'):null;
  if(!td)return;
  /* Клик по вложенному полю (флажок отметки, список варианта) — это работа с ним, а не
   * отбор: иначе выбор варианта поставки заодно навязывал бы отбор. */
  if(e.target.closest('input,select,button,a,label'))return;
  armFilter(td);
});`;

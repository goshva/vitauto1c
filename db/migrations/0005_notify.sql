-- +goose Up
-- Уведомления АРМ по смене статуса строки (перенос Арм_УведомленияСервер.ПослеЗаписиДанныхАРМ, узлы M8, M9, M10, M11, K9/M17).
-- Триггер на arm.line: уведомления дают все пути записи — REST API, задания, импорт (как модуль набора записей в 1С).
--   M8      закупка -> НаСкладе                          -> Менеджер   «Приход на склад»
--   K9, M17 закупка -> Отгружено (самовывоз, N4)         -> Кладовщик и Менеджер «Самовывоз»
--   M11     продажа -> Собран / Подготовлено             -> Менеджер   «Готово к отгрузке»
--   M10     продажа Собран/Подготовлено -> Комплектуется -> Кладовщик «Комплектация отклонена» (причина — Комментарий 2)
--   M9      продажа -> Комплектуется                     -> Кладовщик  «Задание на комплектацию»
-- Одно непрочитанное уведомление на узел, роль и заказ за день: новые строки дописываются в текст без повторов.
-- Автор — пользователь сессии API (set_config('vitauto.user_id', …, true) в транзакции).

-- +goose StatementBegin
create function arm.notice_add(p_node text, p_kind text, p_role text, l arm.line, p_note text) returns void
language plpgsql as $$
declare
  v_line   text;
  v_head   text := '';
  v_id     uuid;
  v_text   text;
  v_author uuid := nullif(current_setting('vitauto.user_id', true), '')::uuid;
begin
  select coalesce(n.name, l.fact_name, '') into v_line from (select 1) x left join ref.nomenclature n on n.id = l.nomenclature_id;
  v_line := v_line || ' — ' || coalesce(trim_scale(l.quantity)::text, '0') || case when coalesce(p_note, '') = '' then '' else ' (' || btrim(p_note) || ')' end;
  if l.customer_order_id is not null then
    select 'Заказ ' || btrim(o.number)
           || case when coalesce(l.client_order_number, '') <> '' then ' (клиент № ' || btrim(l.client_order_number) || ')' else '' end
           || case when c.name is not null then ', ' || c.name else '' end || ': '
      into v_head
      from doc.customer_order o left join ref.counterparty c on c.id = l.customer_id
     where o.id = l.customer_order_id;
    select id, text into v_id, v_text from arm.notice
     where not is_read and node = p_node and recipient_role = p_role and customer_order_id = l.customer_order_id
       and created_at >= date_trunc('day', localtimestamp)
     order by created_at desc limit 1;
  end if;
  if v_id is not null then
    if position(v_line in v_text) = 0 then
      update arm.notice set text = left(v_text || '; ' || v_line, 1000), created_at = localtimestamp,
             version = version + 1, updated_at = now() where id = v_id;
    end if;
  else
    v_id := uuidv7();
    insert into arm.notice (id, onec_record_id, created_at, node, kind, recipient_role, text, customer_order_id, author_id, is_read, onec_key)
    values (v_id, v_id::text, localtimestamp, p_node, p_kind, p_role, left(coalesce(v_head, '') || v_line, 1000), l.customer_order_id, v_author, false, 'app:' || v_id);
  end if;
end $$;
-- +goose StatementEnd

-- +goose StatementBegin
create function arm.line_status_notice() returns trigger language plpgsql as $$
declare
  purchase boolean := new.operation = 'Закупка';
begin
  if new.deleted or new.status is not distinct from old.status then
    return new;
  end if;
  if purchase and new.status = 'НаСкладе' then
    perform arm.notice_add('M8', 'Приход на склад', 'Менеджер', new, null);
  elsif purchase and new.status = 'Отгружено' then
    perform arm.notice_add('K9', 'Самовывоз', 'Кладовщик', new, null);
    perform arm.notice_add('M17', 'Самовывоз', 'Менеджер', new, null);
  elsif not purchase and new.status in ('Собран', 'Подготовлено') and old.status not in ('Собран', 'Подготовлено') then
    perform arm.notice_add('M11', 'Готово к отгрузке', 'Менеджер', new, null);
  elsif not purchase and new.status = 'Комплектуется' then
    if old.status in ('Собран', 'Подготовлено') then
      perform arm.notice_add('M10', 'Комплектация отклонена', 'Кладовщик', new, split_part(coalesce(new.comment2, ''), '|', 1));
    else
      perform arm.notice_add('M9', 'Задание на комплектацию', 'Кладовщик', new, null);
    end if;
  end if;
  return new;
end $$;
-- +goose StatementEnd

create trigger line_status_notice after update of status on arm.line
  for each row execute function arm.line_status_notice();

-- +goose Down
drop trigger if exists line_status_notice on arm.line;
drop function if exists arm.line_status_notice();
drop function if exists arm.notice_add(text, text, text, arm.line, text);

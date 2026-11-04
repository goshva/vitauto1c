-- +goose Up
-- Миграция 0010: WebSocket-события (план, раздел 11). Уведомление arm.notice дублируется в канал pg_notify,
-- API-подписчик читает LISTEN vitauto_notices и рассылает клиентам WS по роли получателя.

-- +goose StatementBegin
create or replace function arm.line_status_notice() returns trigger language plpgsql as $$
declare
  v_id     uuid;
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

-- Уведомление, созданное arm.notice_add (вставка либо дозапись в существующее), уходит в vitauto_notices.
-- Дозапись (update) тоже шлёт событие: клиент обновляет текст и счётчик непрочитанных.
-- +goose StatementBegin
create or replace function arm.notice_notify() returns trigger language plpgsql as $$
begin
  if new.deleted then
    return new;
  end if;
  perform pg_notify('vitauto_notices', jsonb_build_object(
    'noticeId', new.id, 'node', new.node, 'kind', new.kind, 'role', new.recipient_role,
    'orderId', new.customer_order_id, 'text', left(new.text, 300), 'read', new.is_read)::text);
  return new;
end $$;
-- +goose StatementEnd

create trigger notice_notify after insert or update of text, is_read on arm.notice
  for each row execute function arm.notice_notify();

-- +goose Down
drop trigger if exists notice_notify on arm.notice;
drop function if exists arm.notice_notify();

-- +goose Up
-- Миграция 0011: сигнальная система WebSocket (asyncapi.yaml, Change).
-- При изменении новых документов в канал vitauto_changes уходит МИНИМАЛЬНЫЙ сигнал инвалидации:
-- {"e":"<entity>","id":"<uuid>","op":"insert|update","roles":["manager",...]}
-- Клиент по сигналу сам перезапрашивает нужный GET-эндпоинт — WS не перевозит данные.

-- +goose StatementBegin
create or replace function sys.notify_change() returns trigger language plpgsql as $fn$
declare
  v_entity text := TG_ARGV[0];
  v_roles  text[] := TG_ARGV[1]::text[];
  v_op     text := case when TG_OP = 'INSERT' then 'insert' else 'update' end;
begin
  perform pg_notify('vitauto_changes', jsonb_build_object(
    'e', v_entity, 'id', new.id, 'op', v_op, 'roles', v_roles)::text);
  return new;
end $fn$;
-- +goose StatementEnd

-- Возвраты: менеджер (создание), кладовщик (приёмка K6), админ
create trigger return_order_change after insert or update of posted on doc.return_order
  for each row execute function sys.notify_change('return', '{manager,storekeeper,admin}');

-- Заказ-наряды: механик, менеджер, админ
create trigger work_order_change after insert or update on doc.work_order
  for each row execute function sys.notify_change('work_order', '{chief_mechanic,manager,admin}');

-- Неопознанные: менеджер, механик, кладовщик (розыск K8), админ
create trigger unidentified_change after insert or update of nomenclature_id, found on doc.unidentified_item
  for each row execute function sys.notify_change('unidentified', '{manager,chief_mechanic,storekeeper,admin}');

-- Запрос доступа: решение администратора → сигнал заявителю и админам
-- +goose StatementBegin
create or replace function sys.access_request_change() returns trigger language plpgsql as $fn$
begin
  if new.status = 'new' then
    return new; -- создание уже сигналит уведомлением A3 администратору
  end if;
  perform pg_notify('vitauto_changes', jsonb_build_object(
    'e', 'access_request', 'id', new.id, 'op', 'update',
    'roles', array['admin'])::text);
  return new;
end $fn$;
-- +goose StatementEnd

create trigger access_request_change after update of status on auth.access_request
  for each row execute function sys.access_request_change();

-- Строки АРМ: смена статуса/флага самовывоза — сигнал на обновление списков строк всем активным ролям АРМ.
-- Триггер line_status_notice уже пишет уведомления; здесь — лёгкий сигнал инвалидации без текста.
-- +goose StatementBegin
create or replace function sys.line_change() returns trigger language plpgsql as $$
begin
  if new.deleted or (new.status is not distinct from old.status and new.self_pickup is not distinct from old.self_pickup) then
    return new;
  end if;
  perform pg_notify('vitauto_changes', jsonb_build_object(
    'e', 'line', 'id', new.id, 'op', 'update',
    'order', new.customer_order_id,
    'roles', array['manager','supply','storekeeper','chief_mechanic','admin'])::text);
  return new;
end $$;
-- +goose StatementEnd

create trigger line_change after update of status, self_pickup on arm.line
  for each row execute function sys.line_change();

-- +goose Down
drop trigger if exists line_change on arm.line;
drop function if exists sys.line_change();
drop trigger if exists access_request_change on auth.access_request;
drop function if exists sys.access_request_change();
drop trigger if exists unidentified_change on doc.unidentified_item;
drop trigger if exists work_order_change on doc.work_order;
drop trigger if exists return_order_change on doc.return_order;
drop function if exists sys.notify_change();

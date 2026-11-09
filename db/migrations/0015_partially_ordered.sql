-- +goose Up
-- Статус «Частично заказано» (матрица № 2, код API partially_ordered) выставляется автоматически,
-- пока потребность продажи покрыта размещёнными закупками не полностью (решение 09.11.2026).
--
-- Покрытие = сумма количества связанных закупок (тот же link_key) в статусах «Заказано» и далее.
-- Черновые и заблокированные фоном закупки, а также «Возврат» в покрытие не входят.
--
-- Инвариант для открытых строк продажи без партии (Черновик / ВРаботе / ЧастичноЗаказано / Заказано):
--   0 < покрытие < количество                              -> «ЧастичноЗаказано»
--   покрытие >= количество и текущий статус «ЧастичноЗаказано» -> «Заказано» (частичный статус снимается)
--   покрытие = 0 и текущий статус «ЧастичноЗаказано»        -> «ВРаботе» (причина статуса исчезла)
-- Полное покрытие само по себе статус «Заказано» не выставляет: строку в «Заказано» переводит
-- заказ поставщику (как и раньше — только при совпадении количества), триггер лишь снимает «частично».
--
-- Статус «Ожидаем поступление» (awaiting_receipt) — вне объёма: приложение его не выставляет
-- (значение только читается из данных 1С).
--
-- Триггер висит на arm.line, поэтому срабатывает на всех путях записи: REST API, задания,
-- импорт, сиды и ручные правки в базе.

-- +goose StatementBegin
create function arm.partial_ordered_sync() returns trigger language plpgsql as $$
declare
  v_key         text;
  v_self        uuid;
  v_is_purchase boolean;
  v_covered     numeric;
  v_status      text;
  r             record;
begin
  -- защита от рекурсии: триггер сам обновляет строку продажи
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_key := old.link_key;
    v_self := old.id;
    v_is_purchase := old.operation = 'Закупка';
  else
    v_key := new.link_key;
    v_self := new.id;
    v_is_purchase := new.operation = 'Закупка';
  end if;
  if v_key is null or btrim(v_key) = '' then
    return null;
  end if;

  for r in
    select l.id, coalesce(l.quantity, 0) as quantity, l.status
      from arm.line l
     where l.operation = 'Продажа'
       and not coalesce(l.deleted, false)
       and l.batch_id is null
       and l.link_key = v_key
       and l.status in ('Черновик', 'ВРаботе', 'ЧастичноЗаказано', 'Заказано')
       and (v_is_purchase or l.id = v_self)
  loop
    if r.quantity <= 1e-9 then
      continue;
    end if;
    select coalesce(sum(p.quantity), 0)
      into v_covered
      from arm.line p
     where p.operation = 'Закупка'
       and not coalesce(p.deleted, false)
       and p.link_key = v_key
       and p.status in ('Заказано', 'Оплачено', 'ТоварВПути', 'ОжидаемПоступление', 'Приходуется',
                        'НаСкладе', 'Резервирование', 'Комплектуется', 'Подготовлено', 'Собран',
                        'Отгружено', 'Выполнено', 'Завершено');

    if v_covered <= 1e-9 then
      if r.status = 'ЧастичноЗаказано' then
        v_status := 'ВРаботе';
      else
        v_status := null;
      end if;
    elsif v_covered + 1e-9 < r.quantity then
      v_status := 'ЧастичноЗаказано';
    elsif r.status = 'ЧастичноЗаказано' then
      v_status := 'Заказано';
    else
      v_status := null;
    end if;

    if v_status is not null and v_status is distinct from r.status then
      update arm.line set status = v_status, version = version + 1, updated_at = now() where id = r.id;
    end if;
  end loop;
  return null;
end $$;
-- +goose StatementEnd

create trigger line_partial_ordered after insert or update or delete on arm.line
  for each row execute function arm.partial_ordered_sync();

-- Разовая инициализация: строки, у которых покрытие уже частичное, получают статус сразу.
update arm.line l
   set status = 'ЧастичноЗаказано', version = l.version + 1, updated_at = now()
 where l.operation = 'Продажа'
   and not coalesce(l.deleted, false)
   and l.batch_id is null
   and l.status in ('Черновик', 'ВРаботе', 'Заказано')
   and l.link_key is not null and btrim(l.link_key) <> ''
   and l.quantity > 1e-9
   and (select coalesce(sum(p.quantity), 0)
          from arm.line p
         where p.operation = 'Закупка'
           and not coalesce(p.deleted, false)
           and p.link_key = l.link_key
           and p.status in ('Заказано', 'Оплачено', 'ТоварВПути', 'ОжидаемПоступление', 'Приходуется',
                            'НаСкладе', 'Резервирование', 'Комплектуется', 'Подготовлено', 'Собран',
                            'Отгружено', 'Выполнено', 'Завершено'))
       between 1e-9 and l.quantity - 1e-9;

comment on function arm.partial_ordered_sync() is
  'Авто-статус «Частично заказано»: покрытие продажи закупками неполное (матрица № 2, решение 09.11.2026)';

-- +goose Down
drop trigger if exists line_partial_ordered on arm.line;
drop function if exists arm.partial_ordered_sync();

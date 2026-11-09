-- Демо «Срочно» (К1 «Срочность (ФАКТ) / комментарий заказчика»): метка для подсветки в списках.
-- Идемпотентно: заполняет пустую срочность на выбранных строках сценария.
update arm.line set urgency = 'срочно'
 where onec_key in ('demo:stage:happy:N1', 'demo:stage:happy:M1') and coalesce(urgency, '') = '';
update arm.line set urgency = 'очень срочно'
 where onec_key in ('demo:stage:happy:M12', 'demo:stage:happy:K3') and coalesce(urgency, '') = '';
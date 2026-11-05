update arm.line set status = 'Подготовлено' where onec_key in ('demo:repair:1','demo:repair:2','demo:repair:3');
select onec_key, status from arm.line where onec_key like 'demo:repair:%' order by sort_order;

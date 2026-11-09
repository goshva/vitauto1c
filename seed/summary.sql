select 'arm.line: ' || count(*) from arm.line where onec_key like 'demo:%';
select 'arm.line stage: ' || count(*) from arm.line where onec_key like 'demo:stage:%';
select 'arm.line scenario: ' || count(*) from arm.line where onec_key ~ '^demo:(happy|stock|mixed|split|virt|defect|cancel|return|repair)';
select 'notice: ' || count(*) from arm.notice where onec_key like 'demo:%';
select 'return_order: ' || count(*) from doc.return_order where onec_key like 'demo:%';
select 'return_line: ' || count(*) from doc.return_line where onec_key like 'demo:%';
select 'work_order: ' || count(*) from doc.work_order where onec_key like 'demo:%';
select 'work_order_line: ' || count(*) from doc.work_order_line where onec_key like 'demo:%';
select 'work_order_labor: ' || count(*) from doc.work_order_labor where onec_key like 'demo:%';
select 'corder: ' || count(*) from doc.customer_order where id::text like 'a0000000%';
select 'sorder: ' || count(*) from doc.supplier_order where id::text like 'b0000000%';
select 'receipt: ' || count(*) from doc.receipt where id::text like 'c1000000%';
select 'shipment: ' || count(*) from doc.shipment where id::text like 'd1000000%';
select 'car demo: ' || count(*) from ref.car where id::text like 'bb000000%';
select 'labor: ' || count(*) from ref.labor_price where id::text like 'cc000000%';
select 'batch: ' || count(*) from ref.batch where id::text like 'dd000000%';
select 'contract: ' || count(*) from ref.contract where id::text like 'ee000000%';
select 'zone lines: ' || coalesce(string_agg(z.code || '=' || coalesce(c.cnt, 0), ', ' order by z.sort), '—')
from ref.warehouse_zone z
left join (select c.zone_id, count(*) as cnt from arm.line l join ref.storage_cell c on c.id = l.cell_id
           where not coalesce(l.deleted, false) group by c.zone_id) c on c.zone_id = z.id;
select 'status ЧастичноЗаказано: ' || count(*) from arm.line where status = 'ЧастичноЗаказано';

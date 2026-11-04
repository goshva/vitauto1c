select
  count(*)                                            as total,
  count(*) filter (where fact_name ~ ' / .*\)$')      as with_stage,
  count(*) filter (where fact_name ~ 'вне сценариев') as orphan,
  count(*) filter (where fact_name !~ ' / ')          as no_stage_mark
from arm.line
where onec_key like 'demo:stage:%';

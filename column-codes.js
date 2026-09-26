// Буквенно-цифровые коды колонок и группировка — общие для index.html и questionnaire.html.
// Буква — группа, цифра — подгруппа (C1, C2, F1, F2); код колонки = код группы + '.' + номер в группе (C1.4 = Госномер).
// Порядок колонок внутри группы задаёт номер, поэтому новые колонки лучше добавлять в конец группы.
window.VITAUTO_COLUMN_GROUPS = [
  {code:'A', title:'Служебные', columns:['cell_select','row_number','doc_signed_original']},
  {code:'B', title:'Заказ и отгрузка', columns:['shipment_date','shipment_number','order_date','order_internal_number',
    'order_client_number','customer','contract','service_type']},
  {code:'C', title:'Факт (заявка клиента)', columns:[]},
  {code:'C1', parent:'C', title:'Автомобиль / агрегат', columns:['brand_fact','model_fact','aggregate_fact','gosnomer_fact',
    'grz_fact','vin_fact','engine_fact']},
  {code:'C2', parent:'C', title:'Позиция (факт)', columns:['urgency_fact','vehicle_plate_fact','territory_fact','name_fact',
    'article_fact','qty_fact','unit_fact']},
  {code:'D', title:'Номенклатура', columns:['name','article','code_aa','unit','qty','qty_norm_hours_client']},
  {code:'E', title:'Склад и статус', columns:['stock_qty','reserve_qty','ordered_in_transit_qty','batch_fifo','line_status']},
  {code:'F', title:'Цены и оплата', columns:[]},
  {code:'F1', parent:'F', title:'Себестоимость и оплата', columns:['price','sum','payment_form','rrc','paid_status']},
  {code:'F2', parent:'F', title:'Продажа', columns:['coefficient','extra_field_1','extra_field_2']},
  {code:'G', title:'Поступление от поставщика', columns:['supplier','receipt_date','upd_date','upd_number','supplier_ship_territory']},
  {code:'H', title:'Комментарий', columns:['comment']}
];

// colId → {code:'C1.4', group:'C1', top:'C'}
window.VITAUTO_COLUMN_CODES = (function(groups){
  var out = {};
  groups.forEach(function(g){
    g.columns.forEach(function(id, i){
      out[id] = {code: g.code + '.' + (i + 1), group: g.code, top: g.parent || g.code};
    });
  });
  return out;
})(window.VITAUTO_COLUMN_GROUPS);

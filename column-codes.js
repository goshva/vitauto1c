// Коды колонок и группировка — общие для index.html и questionnaire.html.
// Код колонки = буква группы + одна цифра (Е4 = Госномер). Буквы — русские буквы автомобильных номеров
// (А В Е К М Н О Р С Т У Х): их нельзя спутать с латиницей на слух и при вводе. Свободны У и Х.
// Цифра — номер колонки в группе, с 1; в группе «Продажа» — с 0 (Р0 — норма-час, бывш. D.6 → F2.0).
// Поле code у группы — внутренний ключ (на него ссылается parent), на экран выводится letter.
// Порядок колонок внутри группы задаёт цифру, поэтому новые колонки лучше добавлять в конец группы
// (в группе не больше 9 колонок, с нуля — не больше 10).
//
// Соответствие прежним кодам: A→А, B→В, C1→Е, C2→К, D→М, E→Н, F1→О, F2→Р, G→С, H→Т.
window.VITAUTO_COLUMN_GROUPS = [
  {code:'A', letter:'А', title:'Служебные', columns:['cell_select','row_number','doc_signed_original']},
  {code:'B', letter:'В', title:'Заказ и отгрузка', columns:['shipment_date','shipment_number','order_date','order_internal_number',
    'order_client_number','customer','contract','service_type']},
  {code:'C', letter:'Е–К', title:'Факт (заявка клиента)', columns:[]},
  {code:'C1', letter:'Е', parent:'C', title:'Автомобиль / агрегат', columns:['brand_fact','model_fact','aggregate_fact','gosnomer_fact',
    'grz_fact','vin_fact','engine_fact']},
  {code:'C2', letter:'К', parent:'C', title:'Позиция (факт)', columns:['urgency_fact','vehicle_plate_fact','territory_fact','name_fact',
    'article_fact','qty_fact','unit_fact']},
  {code:'D', letter:'М', title:'Номенклатура', columns:['name','article','code_aa','unit','qty']},
  {code:'E', letter:'Н', title:'Склад и статус', columns:['stock_qty','reserve_qty','ordered_in_transit_qty','batch_fifo','line_status']},
  {code:'F', letter:'О–Р', title:'Цены и оплата', columns:[]},
  {code:'F1', letter:'О', parent:'F', title:'Себестоимость и оплата', columns:['price','sum','payment_form','rrc','paid_status']},
  {code:'F2', letter:'Р', parent:'F', start:0, title:'Продажа', columns:['qty_norm_hours_client','coefficient','extra_field_1','extra_field_2']},
  {code:'G', letter:'С', title:'Поступление от поставщика', columns:['supplier','receipt_date','upd_date','upd_number','supplier_ship_territory']},
  {code:'H', letter:'Т', title:'Комментарий', columns:['comment']}
];

// colId → {code:'Е4', group:'C1', top:'C'}
window.VITAUTO_COLUMN_CODES = (function(groups){
  var out = {};
  groups.forEach(function(g){
    var start = typeof g.start === 'number' ? g.start : 1;
    g.columns.forEach(function(id, i){
      out[id] = {code: g.letter + (start + i), group: g.code, top: g.parent || g.code};
    });
  });
  return out;
})(window.VITAUTO_COLUMN_GROUPS);

// Буква группы для вывода на экран по внутреннему ключу: 'C1' → 'Е'
window.VITAUTO_GROUP_LETTER = (function(groups){
  var letters = {};
  groups.forEach(function(g){ letters[g.code] = g.letter || g.code; });
  return function(code){ return letters[code] || code; };
})(window.VITAUTO_COLUMN_GROUPS);

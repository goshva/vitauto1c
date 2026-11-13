-- Представления прототипа (prototype-spec.md §4.3): 3 вместо 2 legacy.
--
-- Объявлены SQL-миграцией, а не в Drizzle-схеме: drizzle-kit 0.31.11 не умеет
-- генерировать `pgView().as(sql\`…\`)` (падает с «qb.getSelectedFields is not a
-- function»). Для производных объектов это законно — таблицами владеет схема,
-- представления считают поверх них.
--
-- Заменяют:
--   stock_balance ← stock.balance
--   line_totals   ← арифметика, которая в legacy дублировалась на клиенте
--   line_view     ← arm.line_api (16 LEFT JOIN поверх 82-столбцовой таблицы)

-- Остатки из движений. Заменяет 4 денормализованных столбца arm.line:
-- stock_qty (20), stock_total_qty (23), reserve_qty (58), in_transit_qty (59).
CREATE OR REPLACE VIEW stock_balance AS
SELECT
  sm.nomenclature_id                                        AS nomenclature_id,
  sm.warehouse_id                                           AS warehouse_id,
  sm.cell_id                                                AS cell_id,
  sm.batch_id                                               AS batch_id,
  coalesce(sum(CASE
    WHEN sm.kind IN ('receipt', 'return') THEN sm.quantity
    WHEN sm.kind = 'expense' THEN -sm.quantity
    ELSE 0 END), 0)                                         AS on_hand,
  coalesce(sum(CASE
    WHEN sm.kind = 'reserve' THEN sm.quantity
    WHEN sm.kind = 'unreserve' THEN -sm.quantity
    ELSE 0 END), 0)                                         AS reserved
FROM stock_move sm
GROUP BY sm.nomenclature_id, sm.warehouse_id, sm.cell_id, sm.batch_id;
--> statement-breakpoint

-- Итоги по строкам: панель «Отмечено: N · Кол-во … · Продажа … · Себест. …».
CREATE OR REPLACE VIEW line_totals AS
SELECT
  l.id                                                      AS line_id,
  coalesce(l.quantity, 0)                                   AS quantity,
  coalesce(l.quantity, 0) * coalesce(l.sale_price, 0)       AS sale_sum,
  coalesce(l.quantity, 0) * coalesce(l.cost_price, 0)       AS cost_sum,
  coalesce(m.marked, false)                                 AS marked
FROM line l
LEFT JOIN line_mark m ON m.id = l.id
WHERE NOT l.deleted;
--> statement-breakpoint

-- Контракт списка АРМ: 58 колонок (pwa/src/odata/matrix.json) + id строки.
--
-- 11 из 58 НЕ отдаются — все из группы D карты §4.2 (поля документов):
--   assembly_sent_date, payment_form, paid, invoice_number, invoice_date,
--   receipt_date, upd_date, upd_number, supplier_ship_territory,
--   supplier_order_date, delivery_term
-- Они появятся, когда документы начнут заполняться (этап 3).
CREATE OR REPLACE VIEW line_view AS
SELECT
  -- Идентификатор строки. В списке 58 колонок его нет (это не колонка данных),
  -- но без него строку нельзя ни отличить от другой, ни отредактировать (PATCH).
  l.id                                                      AS "id",

  -- Вид операции (sale/purchase): по нему фильтруется список. В 58 колонках
  -- контракта его нет — это техническое поле фильтра, а не колонка данных.
  l.operation                                               AS "operation",

  -- Заказ покупателя: по нему печатные формы отбирают строки.
  l.customer_order_id                                       AS "customer_order_id",

  -- отметка и порядок
  coalesce(m.marked, false)                                 AS "marked",
  row_number() OVER (ORDER BY l.order_date, l.id)           AS "order",

  -- документ
  l.signed_original                                         AS "signedOriginal",
  sh.date                                                   AS "shipmentDate",
  sh.number                                                 AS "shipmentNumber",
  l.order_date                                              AS "orderDate",
  l.internal_order_number                                   AS "internalOrderNumber",
  f.client_order_number                                     AS "clientOrderNumber",

  -- контрагенты
  cust.name                                                 AS "customer",
  ct.name                                                   AS "contract",
  sk.name                                                   AS "serviceType",
  sup.name                                                  AS "supplier",

  -- заявка клиента: то, «как написал клиент»
  f.fact_name                                               AS "factName",
  f.fact_article                                            AS "factArticle",
  f.fact_qty                                                AS "factQty",
  f.fact_unit                                               AS "factUnit",
  f.vehicle_plate                                           AS "vehiclePlate",
  l.urgency                                                 AS "urgency",
  l.territory                                               AS "territory",

  -- номенклатура
  n.name                                                    AS "nomenclature",
  n.article                                                 AS "nomenclatureArticle",
  n.code                                                    AS "nomenclatureCode",
  u.name                                                    AS "nomenclatureUnit",

  -- количество и остатки (остатки — из движений, не из строки)
  l.quantity                                                AS "quantity",
  coalesce(sb.on_hand, 0)                                   AS "stockQty",
  coalesce(sb.reserved, 0)                                  AS "reserveQty",
  coalesce((SELECT sum(l2.quantity) FROM line l2
             WHERE l2.nomenclature_id = l.nomenclature_id
               AND l2.status = 'in_transit'
               AND NOT l2.deleted), 0)                      AS "inTransitQty",
  b.name                                                    AS "batch",
  l.status                                                  AS "status",
  sc.code                                                   AS "stockCell",

  -- деньги
  l.cost_price                                              AS "costPrice",
  coalesce(l.quantity, 0) * coalesce(l.cost_price, 0)       AS "costSum",
  l.rrc                                                     AS "rrc",
  l.norm_hours                                              AS "normHours",
  CASE WHEN coalesce(l.cost_price, 0) = 0 THEN NULL
       ELSE round(l.sale_price / l.cost_price, 3) END       AS "coefficient",
  l.sale_price                                              AS "salePrice",
  coalesce(l.quantity, 0) * coalesce(l.sale_price, 0)       AS "saleSum",

  -- атрибуты авто: в legacy лежали столбцами 47–57 прямо в строке
  (SELECT ca.value_value FROM car_attribute ca
    WHERE ca.car_id = sh.car_id AND ca.attr_kind = 'brand')     AS "brand",
  (SELECT ca.value_value FROM car_attribute ca
    WHERE ca.car_id = sh.car_id AND ca.attr_kind = 'model')     AS "model",
  (SELECT ca.value_value FROM car_attribute ca
    WHERE ca.car_id = sh.car_id AND ca.attr_kind = 'aggregate') AS "aggregate",
  (SELECT ca.value_value FROM car_attribute ca
    WHERE ca.car_id = sh.car_id AND ca.attr_kind = 'plate')     AS "plate",
  (SELECT ca.value_value FROM car_attribute ca
    WHERE ca.car_id = sh.car_id AND ca.attr_kind = 'chassis')   AS "chassis",
  (SELECT ca.value_value FROM car_attribute ca
    WHERE ca.car_id = sh.car_id AND ca.attr_kind = 'vin')       AS "vin",
  (SELECT ca.value_value FROM car_attribute ca
    WHERE ca.car_id = sh.car_id AND ca.attr_kind = 'engine')    AS "engine",

  -- комментарии
  l.comment                                                 AS "comment",
  l.comment2                                                AS "comment2"
FROM line l
LEFT JOIN line_fact      f    ON f.id = l.id
LEFT JOIN line_mark      m    ON m.id = l.id
LEFT JOIN shipment      sh    ON sh.id = l.shipment_doc_id
LEFT JOIN nomenclature  n     ON n.id = l.nomenclature_id
LEFT JOIN unit          u     ON u.id = n.unit_id
LEFT JOIN counterparty  cust  ON cust.id = l.customer_id
LEFT JOIN counterparty  sup   ON sup.id = l.supplier_id
LEFT JOIN contract      ct    ON ct.id = l.contract_id
LEFT JOIN service_kind  sk    ON sk.id = l.service_type_id
LEFT JOIN batch         b     ON b.id = l.batch_id
LEFT JOIN storage_cell  sc    ON sc.id = l.cell_id
LEFT JOIN stock_balance sb    ON sb.nomenclature_id = l.nomenclature_id
                             AND sb.warehouse_id IS NOT DISTINCT FROM l.warehouse_id
                             AND sb.cell_id      IS NOT DISTINCT FROM l.cell_id
                             AND sb.batch_id     IS NOT DISTINCT FROM l.batch_id
WHERE NOT l.deleted;


ALTER TABLE "line" ADD COLUMN "coefficient" numeric(15, 3);
--> statement-breakpoint
-- Представление ПЕРЕСОЗДАЁТСЯ: CREATE OR REPLACE умеет только дописывать колонки
-- в конец и отказался менять это представление («cannot change name of view
-- column»). На нём ничего не завязано, поэтому пересоздание безопасно.
DROP VIEW IF EXISTS "line_view";
--> statement-breakpoint
-- У коэффициента теперь ДВА значения (ФТ v2 п. 1): хранимый множитель, который
-- задаёт менеджер, и признак «расчётный» — цену вписали руками, множитель
-- посчитан из неё. Без признака подсветить расчётный нечем.
CREATE VIEW "line_view" AS
SELECT l.id,
    l.operation,
    l.customer_order_id,
    COALESCE(m.marked, false) AS marked,
    row_number() OVER (ORDER BY l.order_date, l.id) AS "order",
    l.signed_original AS "signedOriginal",
    sh.date AS "shipmentDate",
    sh.number AS "shipmentNumber",
    l.order_date AS "orderDate",
    l.internal_order_number AS "internalOrderNumber",
    f.client_order_number AS "clientOrderNumber",
    cust.name AS customer,
    ct.name AS contract,
    sk.name AS "serviceType",
    sup.name AS supplier,
    f.fact_name AS "factName",
    f.fact_article AS "factArticle",
    f.fact_qty AS "factQty",
    f.fact_unit AS "factUnit",
    f.vehicle_plate AS "vehiclePlate",
    l.urgency,
    l.territory,
    n.name AS nomenclature,
    n.article AS "nomenclatureArticle",
    n.code AS "nomenclatureCode",
    u.name AS "nomenclatureUnit",
    l.quantity,
    COALESCE(sb.on_hand, (0)::numeric) AS "stockQty",
    COALESCE(sb.reserved, (0)::numeric) AS "reserveQty",
    COALESCE(( SELECT sum(l2.quantity) AS sum
           FROM line l2
          WHERE ((l2.nomenclature_id = l.nomenclature_id) AND (l2.status = 'in_transit'::text) AND (NOT l2.deleted))), (0)::numeric) AS "inTransitQty",
    b.name AS batch,
    l.status,
    sc.code AS "stockCell",
    l.cost_price AS "costPrice",
    (COALESCE(l.quantity, (0)::numeric) * COALESCE(l.cost_price, (0)::numeric)) AS "costSum",
    l.rrc,
    l.norm_hours AS "normHours",
        COALESCE(l.coefficient,
              CASE
            WHEN (COALESCE(l.cost_price, (0)::numeric) = (0)::numeric) THEN NULL::numeric
            ELSE round((l.sale_price / l.cost_price), 3)
        END) AS coefficient,
    l.sale_price AS "salePrice",
    (COALESCE(l.quantity, (0)::numeric) * COALESCE(l.sale_price, (0)::numeric)) AS "saleSum",
    ( SELECT ca.value_value
           FROM car_attribute ca
          WHERE ((ca.car_id = sh.car_id) AND (ca.attr_kind = 'brand'::text))) AS brand,
    ( SELECT ca.value_value
           FROM car_attribute ca
          WHERE ((ca.car_id = sh.car_id) AND (ca.attr_kind = 'model'::text))) AS model,
    ( SELECT ca.value_value
           FROM car_attribute ca
          WHERE ((ca.car_id = sh.car_id) AND (ca.attr_kind = 'aggregate'::text))) AS aggregate,
    ( SELECT ca.value_value
           FROM car_attribute ca
          WHERE ((ca.car_id = sh.car_id) AND (ca.attr_kind = 'plate'::text))) AS plate,
    ( SELECT ca.value_value
           FROM car_attribute ca
          WHERE ((ca.car_id = sh.car_id) AND (ca.attr_kind = 'chassis'::text))) AS chassis,
    ( SELECT ca.value_value
           FROM car_attribute ca
          WHERE ((ca.car_id = sh.car_id) AND (ca.attr_kind = 'vin'::text))) AS vin,
    ( SELECT ca.value_value
           FROM car_attribute ca
          WHERE ((ca.car_id = sh.car_id) AND (ca.attr_kind = 'engine'::text))) AS engine,
    l.comment,
    l.comment2,
    (l.coefficient IS NULL) AS "coefficientCalculated"
   FROM ((((((((((((line l
     LEFT JOIN line_fact f ON ((f.id = l.id)))
     LEFT JOIN line_mark m ON ((m.id = l.id)))
     LEFT JOIN shipment sh ON ((sh.id = l.shipment_doc_id)))
     LEFT JOIN nomenclature n ON ((n.id = l.nomenclature_id)))
     LEFT JOIN unit u ON ((u.id = n.unit_id)))
     LEFT JOIN counterparty cust ON ((cust.id = l.customer_id)))
     LEFT JOIN counterparty sup ON ((sup.id = l.supplier_id)))
     LEFT JOIN contract ct ON ((ct.id = l.contract_id)))
     LEFT JOIN service_kind sk ON ((sk.id = l.service_type_id)))
     LEFT JOIN batch b ON ((b.id = l.batch_id)))
     LEFT JOIN storage_cell sc ON ((sc.id = l.cell_id)))
     LEFT JOIN stock_balance sb ON (((sb.nomenclature_id = l.nomenclature_id) AND (NOT (sb.warehouse_id IS DISTINCT FROM l.warehouse_id)) AND (NOT (sb.cell_id IS DISTINCT FROM l.cell_id)) AND (NOT (sb.batch_id IS DISTINCT FROM l.batch_id)))))
  WHERE (NOT l.deleted);;

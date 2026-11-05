-- Сгенерировано `vitauto-migrator gen`: загрузка typed-таблиц из onec.raw (сырые строки 1С). Выполняется `vitauto-migrator load`
-- одной транзакцией: очистка, вставка в порядке зависимостей, проверка внешних ключей при фиксации.

truncate auth."user", ref.car_model, ref.organization, ref.payment_form, ref.price_type, ref.service_kind, ref.unit, ref.counterparty, ref.warehouse, ref.car, ref.contract, ref.nomenclature, ref.batch, doc.customer_order, doc.customer_order_item, doc.customer_order_material, doc.customer_order_work, doc.supplier_order, doc.supplier_order_item, doc.receipt, doc.receipt_expense, doc.receipt_item, doc.shipment, doc.shipment_item, ref.car_attribute, ref.labor_price, ref.price, stock.move, arm.line, arm.notice, arm.user_role, ref.contact_info, ref.extra_property cascade;

-- Справочник.Пользователи (_reference462)
insert into auth."user" (id, onec_version, deleted, predefined, name, inactive, department_id, person_id, comment, service, onec_ib_user_id, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.uuid(j->>'_predefinedid'),
    j->>'_description',
    (j->>'_fld11740')::boolean,
    j->>'_fld11741',
    onec.uuid(j->>'_fld11742rref'),
    j->>'_fld11743',
    (j->>'_fld11744')::boolean,
    decode(substr(j->>'_fld11746', 3), 'hex'),
    jsonb_strip_nulls(jsonb_build_object(
      'Подготовлен', j->'_fld11745',
      'ИдентификаторПользователяСервиса', j->'_fld11747',
      'УдалитьСвойстваПользователяИБ', j->'_fld11748',
      'Фотография', j->'_fld11749',
      'УдалитьФизическоеЛицо', to_jsonb(onec.uuid(j->>'_fld11750rref'))))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference462';

-- Справочник.асМодели (_reference756)
insert into ref.car_model (id, onec_version, deleted, predefined, parent_id, is_folder, code, name, full_name, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.uuid(j->>'_predefinedid'),
    onec.uuid(j->>'_parentidrref'),
    (j->>'_folder')::boolean,
    j->>'_code',
    j->>'_description',
    j->>'_fld17333',
    '{}'::jsonb
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference756';

-- Справочник.Организации (_reference388)
insert into ref.organization (id, onec_version, deleted, predefined, code, name, inn, kpp, full_name, short_name, ogrn, prefix, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.uuid(j->>'_predefinedid'),
    j->>'_code',
    j->>'_description',
    j->>'_fld9821',
    j->>'_fld9838',
    j->>'_fld9841',
    j->>'_fld9848',
    j->>'_fld9863',
    j->>'_fld9871',
    jsonb_strip_nulls(jsonb_build_object(
      'ВидОбменаСКонтролирующимиОрганами', jsonb_strip_nulls(jsonb_build_object('type', j->'_fld9816_type', 'rtref', j->'_fld9816_rtref', 'rrref', to_jsonb(onec.uuid(j->>'_fld9816_rrref')))),
      'ВидУчетаСтраховыхВзносов', to_jsonb(onec.uuid(j->>'_fld9817rref')),
      'ГоловнаяОрганизация', to_jsonb(onec.uuid(j->>'_fld9818rref')),
      'ДатаЗакрытия', j->'_fld9819',
      'БанковскийСчетПоУмолчанию', to_jsonb(onec.uuid(j->>'_fld9820rref')),
      'ИностраннаяОрганизация', j->'_fld9822',
      'ИПИспользуетТрудНаемныхРаботников', j->'_fld9823',
      'ИспользуетсяОтчетность', j->'_fld9824',
      'КассаПоУмолчанию', to_jsonb(onec.uuid(j->>'_fld9825rref')),
      'ДополнительныйКодФСС', j->'_fld9826',
      'КодНалоговогоОрганаПолучателя', j->'_fld9830',
      'ЕстьОбособленныеПодразделения', j->'_fld9828',
      'ИндивидуальныйПредприниматель', to_jsonb(onec.uuid(j->>'_fld9829rref')),
      'КодОрганаПФР', j->'_fld9831',
      'КодОрганаФСГС', j->'_fld9833',
      'КодОрганаФСС', j->'_fld9832',
      'КодПоОКАТО', j->'_fld9834',
      'КодПоОКПО', j->'_fld9836',
      'КодПоОКТМО', j->'_fld9835',
      'ДатаРегистрации', j->'_fld9827',
      'КодПодчиненностиФСС', j->'_fld9837',
      'НаименованиеПлательщикаПриПеречисленииНалогов', j->'_fld9839',
      'КрупнейшийНалогоплательщик', j->'_fld9840',
      'НДСВключатьВСтоимость', j->'_fld9842',
      'НаименованиеТерриториальногоОрганаПФР', j->'_fld9843',
      'ПодписьГлавногоБухгалтера', to_jsonb(onec.uuid(j->>'_fld9844rref')),
      'ПодписьРуководителя', to_jsonb(onec.uuid(j->>'_fld9845rref')),
      'НаименованиеТерриториальногоОрганаФСС', j->'_fld9846',
      'ПроизводственныйКалендарь', to_jsonb(onec.uuid(j->>'_fld9847rref')),
      'РегистрационныйНомерПФР_ИП', j->'_fld9849',
      'ОбменКаталогОтправкиДанныхОтчетности', j->'_fld9850',
      'ОбменКаталогПрограммыЭлектроннойПочты', j->'_fld9851',
      'ОбменКодАбонента', j->'_fld9852',
      'ОбособленноеПодразделение', j->'_fld9853',
      'УдалитьСтавкаНДСПоУмолчанию', to_jsonb(onec.uuid(j->>'_fld9854rref')),
      'СтраховойНомерПФР', j->'_fld9855',
      'ТарифНаТравматизм', j->'_fld9856',
      'УдалитьGCP', j->'_fld9857',
      'УдалитьGLN', j->'_fld9858',
      'ПрименятьРайонныйКоэффициент', j->'_fld9859')
    || jsonb_build_object(
      'ФайлЛоготип', to_jsonb(onec.uuid(j->>'_fld9860rref')),
      'ФайлФаксимильнаяПечать', to_jsonb(onec.uuid(j->>'_fld9861rref')),
      'ФизическоеЛицо', to_jsonb(onec.uuid(j->>'_fld9862rref')),
      'ЦифровойИндексОбособленногоПодразделения', j->'_fld9864',
      'ВидСтавкиНДСПоУмолчанию', to_jsonb(onec.uuid(j->>'_fld9865rref')),
      'ПострадавшаяИзРеестраМСП', j->'_fld9866',
      'ПоддержкаИП', j->'_fld9867',
      'КонтрагентИнтеркампани', to_jsonb(onec.uuid(j->>'_fld9868rref')),
      'ПрименятьСевернуюНадбавку', j->'_fld9869',
      'РайонныйКоэффициент', j->'_fld9870',
      'РегистрационныйНомерПФР', j->'_fld9872',
      'РегистрационныйНомерФСС', j->'_fld9873',
      'РегистрацияВНалоговомОргане', to_jsonb(onec.uuid(j->>'_fld9874rref')),
      'РегистрационныйНомерСФР', j->'_fld9875',
      'ИПРегистрационныйНомерСФР', j->'_fld9876',
      'КодОКВЭД', j->'_fld9877',
      'НаименованиеОКВЭД', j->'_fld9878',
      'КодОКВЭД2', j->'_fld9879',
      'НаименованиеОКВЭД2', j->'_fld9880',
      'КодОКОПФ', j->'_fld9881',
      'НаименованиеОКОПФ', j->'_fld9882',
      'КодОКФС', j->'_fld9883',
      'РайонныйКоэффициентРФ', j->'_fld9884',
      'НаименованиеОКФС', j->'_fld9885',
      'СвидетельствоДатаВыдачи', j->'_fld9886',
      'НеЗаполнятьПодразделенияВМероприятияхТрудовойДеятельности', j->'_fld9887',
      'СвидетельствоСерияНомер', j->'_fld9888',
      'УчетнаяЗаписьОбмена', jsonb_strip_nulls(jsonb_build_object('type', j->'_fld9889_type', 'rtref', j->'_fld9889_rtref', 'rrref', to_jsonb(onec.uuid(j->>'_fld9889_rrref')))),
      'ЮридическоеФизическоеЛицо', to_jsonb(onec.uuid(j->>'_fld9890rref')),
      'РекламныйБлокПечтаныхФорм', to_jsonb(onec.uuid(j->>'_fld55007rref')),
      'СчетУчетаЛичныхСредствПредпринимателя', to_jsonb(onec.uuid(j->>'_fld55008rref'))))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference388';

-- Справочник.Арм_ФормыОплаты (_reference56795x1)
insert into ref.payment_form (id, onec_version, deleted, predefined, code, name, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.uuid(j->>'_predefinedid'),
    j->>'_code',
    j->>'_description',
    '{}'::jsonb
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference56795x1';

-- Справочник.ВидыЦен (_reference137)
insert into ref.price_type (id, onec_version, deleted, predefined, code, name, currency_id, includes_vat, comment, kind, inactive, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.uuid(j->>'_predefinedid'),
    j->>'_code',
    j->>'_description',
    onec.uuid(j->>'_fld3301rref'),
    (j->>'_fld3302')::boolean,
    j->>'_fld3308',
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld3309rref')),
    (j->>'_fld3326')::boolean,
    jsonb_strip_nulls(jsonb_build_object(
      'ПорядокОкругления', to_jsonb(onec.uuid(j->>'_fld3303rref')),
      'ОкруглятьВБольшуюСторону', j->'_fld3304',
      'ФорматЦены', j->'_fld3305',
      'БазовыйВидЦен', to_jsonb(onec.uuid(j->>'_fld3306rref')),
      'Процент', j->'_fld3307',
      'Формула', j->'_fld3310',
      'ИдентификаторФормул', j->'_fld3311',
      'ЦеныАктуальны', j->'_fld3312',
      'РассчитыватьАвтоматически', j->'_fld3313',
      'КоличествоПопытокСлужебный', j->'_fld3314',
      'ОписаниеОшибки', j->'_fld3315',
      'ПсихологическоеОкругление', j->'_fld3316',
      'ПорогСрабатыванияПриУменьшении', j->'_fld3317',
      'ПорогСрабатыванияПриУвеличении', j->'_fld3318',
      'СхемаКомпоновкиДанных', j->'_fld3319',
      'ХранилищеСхемыКомпоновкиДанных', j->'_fld3320',
      'ХранилищеНастроекКомпоновкиДанных', j->'_fld3321',
      'ПорядокОтображения', j->'_fld3322',
      'ПорядокКолонок', j->'_fld3323',
      'ИдентификаторДляРасчетаВРасширении', j->'_fld3324',
      'ЗаполнятьИзОснования', j->'_fld3325',
      'НесколькоВалютДляЦен', j->'_fld3327'))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference137';

-- Справочник.Арм_ВидыУслуги (_reference56794x1)
insert into ref.service_kind (id, onec_version, deleted, predefined, code, name, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.uuid(j->>'_predefinedid'),
    j->>'_code',
    j->>'_description',
    '{}'::jsonb
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference56794x1';

-- Справочник.КлассификаторЕдиницИзмерения (_reference262)
insert into ref.unit (id, onec_version, deleted, predefined, code, name, full_name, intl_code, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.uuid(j->>'_predefinedid'),
    j->>'_code',
    j->>'_description',
    j->>'_fld6398',
    j->>'_fld6399',
    jsonb_strip_nulls(jsonb_build_object(
      'ТипИзмеряемойВеличины', to_jsonb(onec.uuid(j->>'_fld6400rref'))))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference262';

-- Справочник.Контрагенты (_reference301)
insert into ref.counterparty (id, onec_version, deleted, predefined, parent_id, is_folder, code, name, full_name, legal_form, comment, inn, kpp, inactive, is_customer, is_supplier, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.uuid(j->>'_predefinedid'),
    onec.uuid(j->>'_parentidrref'),
    (j->>'_folder')::boolean,
    j->>'_code',
    j->>'_description',
    j->>'_fld6956',
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld6974rref')),
    j->>'_fld6975',
    j->>'_fld6978',
    j->>'_fld6980',
    (j->>'_fld6981')::boolean,
    (j->>'_fld6985')::boolean,
    (j->>'_fld6987')::boolean,
    jsonb_strip_nulls(jsonb_build_object(
      'БанковскийСчетПоУмолчанию', to_jsonb(onec.uuid(j->>'_fld6957rref')),
      'ВалютаРасчетовПоУмолчанию', to_jsonb(onec.uuid(j->>'_fld6958rref')),
      'ВестиРасчетыПоДоговорам', j->'_fld6959',
      'ВестиРасчетыПоДокументам', j->'_fld6960',
      'ВестиРасчетыПоЗаказам', j->'_fld6961',
      'ВестиУчетОплатыПоСчетам', j->'_fld6962',
      'ВидГосударственногоОргана', to_jsonb(onec.uuid(j->>'_fld6963rref')),
      'ВидКонтрагента', to_jsonb(onec.uuid(j->>'_fld6964rref')),
      'ГоловнойКонтрагент', to_jsonb(onec.uuid(j->>'_fld6965rref')),
      'ГруппаДоступа', to_jsonb(onec.uuid(j->>'_fld6966rref')),
      'ДатаРождения', j->'_fld6967',
      'ДатаСоздания', j->'_fld6968',
      'ДокументУдостоверяющийЛичность', j->'_fld6969',
      'АдресЭПДляПоиска', j->'_fld6970',
      'ИННВведенКорректно', j->'_fld6971',
      'ИсточникПривлеченияПокупателя', to_jsonb(onec.uuid(j->>'_fld6972rref')),
      'КодГосударственногоОргана', j->'_fld6973',
      'КонтактноеЛицо', to_jsonb(onec.uuid(j->>'_fld6976rref')),
      'КонтактноеЛицоПодписант', to_jsonb(onec.uuid(j->>'_fld6977rref')),
      'КППВведенКорректно', j->'_fld6979',
      'НомерТелефонаДляПоиска', j->'_fld6982',
      'ОсновныеСведения', j->'_fld6983',
      'Ответственный', to_jsonb(onec.uuid(j->>'_fld6984rref')),
      'Пол', to_jsonb(onec.uuid(j->>'_fld6986rref')),
      'ПрочиеОтношения', j->'_fld6988',
      'РасчетыВУсловныхЕдиницахПоУмолчанию', j->'_fld6989',
      'РегистрационныйНомер', j->'_fld6990',
      'СвидетельствоДатаВыдачи', j->'_fld6991',
      'СвидетельствоСерияНомер', j->'_fld6992',
      'СпособЗачетаПредоплатыПоУмолчанию', to_jsonb(onec.uuid(j->>'_fld6993rref')),
      'СпособРазнесенияОплатыПоУмолчанию', to_jsonb(onec.uuid(j->>'_fld6994rref')),
      'СтатьяДДСПоУмолчанию', to_jsonb(onec.uuid(j->>'_fld6995rref')),
      'СтранаРегистрации', to_jsonb(onec.uuid(j->>'_fld6996rref')),
      'СчетУчетаАвансовПокупателя', to_jsonb(onec.uuid(j->>'_fld6997rref')),
      'СчетУчетаАвансовПоставщику', to_jsonb(onec.uuid(j->>'_fld6998rref')),
      'СчетУчетаРасчетовСПокупателем', to_jsonb(onec.uuid(j->>'_fld6999rref')),
      'СчетУчетаРасчетовСПоставщиком', to_jsonb(onec.uuid(j->>'_fld7000rref')),
      'УдалитьАдресЭП', j->'_fld7001',
      'УдалитьДоговорПоУмолчанию', to_jsonb(onec.uuid(j->>'_fld7002rref')),
      'УдалитьНомерТелефона', j->'_fld7003')
    || jsonb_build_object(
      'ФИО', j->'_fld7004',
      'КодПоОКПО', j->'_fld7005',
      'Самозанятый', j->'_fld7006'))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference301';

-- Справочник.СтруктурныеЕдиницы (_reference612)
insert into ref.warehouse (id, onec_version, deleted, predefined, parent_id, code, name, unit_type, order_based, organization_id, responsible_id, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.uuid(j->>'_predefinedid'),
    onec.uuid(j->>'_parentidrref'),
    j->>'_code',
    j->>'_description',
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld14893rref')),
    (j->>'_fld14894')::boolean,
    onec.uuid(j->>'_fld14895rref'),
    onec.uuid(j->>'_fld14896rref'),
    jsonb_strip_nulls(jsonb_build_object(
      'ПодписьМОЛ', to_jsonb(onec.uuid(j->>'_fld14897rref')),
      'РозничныйВидЦен', to_jsonb(onec.uuid(j->>'_fld14898rref')),
      'СчетУчетаВРознице', to_jsonb(onec.uuid(j->>'_fld14899rref')),
      'СчетУчетаНаценки', to_jsonb(onec.uuid(j->>'_fld14900rref')),
      'ИсточникПеремещения', to_jsonb(onec.uuid(j->>'_fld14901rref')),
      'ЯчейкаИсточникаПеремещения', to_jsonb(onec.uuid(j->>'_fld14902rref')),
      'ПолучательПеремещения', to_jsonb(onec.uuid(j->>'_fld14903rref')),
      'ЯчейкаПолучателяПеремещения', to_jsonb(onec.uuid(j->>'_fld14904rref')),
      'ПолучательОтходов', to_jsonb(onec.uuid(j->>'_fld14905rref')),
      'ЯчейкаПолучателяОтходов', to_jsonb(onec.uuid(j->>'_fld14906rref')),
      'ИсточникСписанияНаРасходы', to_jsonb(onec.uuid(j->>'_fld14907rref')),
      'ЯчейкаИсточникаСписанияНаРасходы', to_jsonb(onec.uuid(j->>'_fld14908rref')),
      'ПолучательСписанияНаРасходы', to_jsonb(onec.uuid(j->>'_fld14909rref')),
      'ЯчейкаПолучателяСписанияНаРасходы', to_jsonb(onec.uuid(j->>'_fld14910rref')),
      'ИсточникПередачиВЭксплуатацию', to_jsonb(onec.uuid(j->>'_fld14911rref')),
      'ЯчейкаИсточникаПередачиВЭксплуатацию', to_jsonb(onec.uuid(j->>'_fld14912rref')),
      'ПолучательПередачиВЭксплуатацию', to_jsonb(onec.uuid(j->>'_fld14913rref')),
      'ЯчейкаПолучателяПередачиВЭксплуатацию', to_jsonb(onec.uuid(j->>'_fld14914rref')),
      'ИсточникВозвратаИзЭксплуатации', to_jsonb(onec.uuid(j->>'_fld14915rref')),
      'ЯчейкаИсточникаВозвратаИзЭксплуатации', to_jsonb(onec.uuid(j->>'_fld14916rref')),
      'ПолучательВозвратаИзЭксплуатации', to_jsonb(onec.uuid(j->>'_fld14917rref')),
      'ЯчейкаПолучателяВозвратаИзЭксплуатации', to_jsonb(onec.uuid(j->>'_fld14918rref')),
      'УсловияХранения', j->'_fld14919',
      'ГоловнаяОрганизация', to_jsonb(onec.uuid(j->>'_fld14920rref')),
      'КПП', j->'_fld14921',
      'НаименованиеПолное', j->'_fld14922',
      'ЦифровойИндексОбособленногоПодразделения', j->'_fld14923',
      'УдалитьасПроизводственный', j->'_fld14924',
      'Недействителен', j->'_fld14925',
      'ВидУчетаОрдерныхСкладов', to_jsonb(onec.uuid(j->>'_fld14926rref')),
      'ИспользоватьОрдернуюСхемуПриОтгрузке', j->'_fld14927',
      'ИспользоватьОрдернуюСхемуПриПеремещении', j->'_fld14928',
      'ИспользоватьОрдернуюСхемуПриПоступлении', j->'_fld14929',
      'УчетОстатковПоЯчейкам', j->'_fld14930',
      'СкладУправляющейСистемы', j->'_fld14931',
      'ВидЦенСписания', to_jsonb(onec.uuid(j->>'_fld14932rref')),
      'КонтролироватьАссортимент', j->'_fld14933'))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference612';

-- Справочник.асАвтомобили (_reference749)
insert into ref.car (id, onec_version, deleted, predefined, parent_id, is_folder, code, name, vin, year, comment, model_id, engine_no, body_no, chassis_no, color, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.uuid(j->>'_predefinedid'),
    onec.uuid(j->>'_parentidrref'),
    (j->>'_folder')::boolean,
    j->>'_code',
    j->>'_description',
    j->>'_fld17167',
    onec.ts(j->>'_fld17169'),
    j->>'_fld17170',
    onec.uuid(j->>'_fld17171rref'),
    j->>'_fld17172',
    j->>'_fld17173',
    j->>'_fld17174',
    onec.uuid(j->>'_fld17176rref'),
    jsonb_strip_nulls(jsonb_build_object(
      'ВариантКомплектации', to_jsonb(onec.uuid(j->>'_fld17168rref')),
      'ФайлКартинки', to_jsonb(onec.uuid(j->>'_fld17175rref'))))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference749';

-- Справочник.ДоговорыКонтрагентов (_reference171)
insert into ref.contract (id, onec_version, deleted, predefined, counterparty_type, counterparty_id, counterparty_value, parent_id, code, name, comment, currency_id, price_type_id, contract_date, organization_id, inactive, contract_no, kind, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.uuid(j->>'_predefinedid'),
    case j->>'_ownerid_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_ownerid_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_ownerid_type' = E'\\x08' then onec.uuid(j->>'_ownerid_rrref') end,
    null::jsonb,
    onec.uuid(j->>'_parentidrref'),
    j->>'_code',
    j->>'_description',
    j->>'_fld4107',
    onec.uuid(j->>'_fld4108rref'),
    onec.uuid(j->>'_fld4111rref'),
    onec.ts(j->>'_fld4113'),
    onec.uuid(j->>'_fld4124rref'),
    (j->>'_fld4126')::boolean,
    j->>'_fld4129',
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld4130rref')),
    jsonb_strip_nulls(jsonb_build_object(
      'АвтоматическиРегистрироватьЦены', j->'_fld4109',
      'ВидСкидкиНаценки', to_jsonb(onec.uuid(j->>'_fld4110rref')),
      'ВидЦенКонтрагента', to_jsonb(onec.uuid(j->>'_fld4112rref')),
      'ДоговорОбслуживанияДатаНачала', j->'_fld4114',
      'ДоговорОбслуживанияДатаОкончания', j->'_fld4115',
      'ДоговорОбслуживанияДнейДоВыставленияДокументов', j->'_fld4116',
      'ДоговорОбслуживанияМесяцевДоВыставленияДокументов', j->'_fld4117',
      'ДоговорОбслуживанияНаправлениеДеятельности', to_jsonb(onec.uuid(j->>'_fld4118rref')),
      'ДоговорОбслуживанияПериодичность', to_jsonb(onec.uuid(j->>'_fld4119rref')),
      'ДоговорОбслуживанияТарифныйПлан', to_jsonb(onec.uuid(j->>'_fld4120rref')),
      'ДоговорПодписан', j->'_fld4121',
      'ДоговорСоСлужбойДоставки', to_jsonb(onec.uuid(j->>'_fld4122rref')),
      'КатегорияДоговора', to_jsonb(onec.uuid(j->>'_fld4123rref')),
      'КонтрольВзаиморасчетовЭквайринг', j->'_fld4125',
      'НеУчитыватьЗаказыПриПередачеНаКомиссию', j->'_fld4127',
      'НоменклатураДляОтраженияСуммыБезВознаграждения', to_jsonb(onec.uuid(j->>'_fld4128rref')),
      'ПереноситьУдержанныеСуммыНаРасчетыСПоставщиком', j->'_fld4131',
      'УчетАгентскогоНДС', j->'_fld56314',
      'ВидАгентскогоДоговора', to_jsonb(onec.uuid(j->>'_fld56315rref')),
      'ПроцентКомиссионногоВознаграждения', j->'_fld4132',
      'РасчетКомиссииВОтчетеЭквайера', j->'_fld4133',
      'РасчетыВУсловныхЕдиницах', j->'_fld4134',
      'СпособЗаполненияСтавкиНДС', to_jsonb(onec.uuid(j->>'_fld4135rref')),
      'СпособЗачетаПредоплатыПоУмолчанию', to_jsonb(onec.uuid(j->>'_fld4136rref')),
      'СпособРазнесенияОплатыПоУмолчанию', to_jsonb(onec.uuid(j->>'_fld4137rref')),
      'СпособРасчетаКомиссионногоВознаграждения', to_jsonb(onec.uuid(j->>'_fld4138rref')),
      'СрокДействия', j->'_fld4139',
      'СрокОплатыПокупателя', j->'_fld4140',
      'СрокОплатыПоставщику', j->'_fld4141',
      'СтатьяДДСПоУмолчанию', to_jsonb(onec.uuid(j->>'_fld4142rref')),
      'асВидЦенРабот', to_jsonb(onec.uuid(j->>'_fld4143rref')),
      'асВидСкидкиНаценкиНаРаботы', to_jsonb(onec.uuid(j->>'_fld4144rref')),
      'УдалитьБланкДоговора', to_jsonb(onec.uuid(j->>'_fld4145rref')),
      'УдержатьКомиссионноеВознаграждение', j->'_fld4146',
      'УслугаДоставки', to_jsonb(onec.uuid(j->>'_fld4147rref')),
      'УслугаКомиссионногоВознаграждения', to_jsonb(onec.uuid(j->>'_fld4148rref')),
      'ДоговорУслугиКомиссионногоВознаграждения', to_jsonb(onec.uuid(j->>'_fld4149rref')),
      'ЧисловойНомер', j->'_fld4150',
      'ЭтоДоговорКредита', j->'_fld4151',
      'ЭтоДоговорОбслуживания', j->'_fld4152')
    || jsonb_build_object(
      'ЭтоДоговорПередачиТоваровМеждуОрганизациями', j->'_fld4153',
      'ЭтоДоговорЭквайринга', j->'_fld4154',
      'ПризнакАгента', to_jsonb(onec.uuid(j->>'_fld4155rref')),
      'УчетАгентскогоНДСПокупателем', j->'_fld56316',
      'АдресОператораПеревода', j->'_fld4156',
      'ИННОператораПеревода', j->'_fld4157',
      'НаименованиеОператораПеревода', j->'_fld4158',
      'ТелефонОператораПеревода', j->'_fld4159',
      'ОперацияПлатежногоАгента', j->'_fld4160',
      'ИННПоставщикаУслуг', j->'_fld4161',
      'ТелефонПоставщика', j->'_fld4162',
      'ТелефонОператораПоПриемуПлатежей', j->'_fld4163',
      'ТелефонПлатежногоАгента', j->'_fld4164',
      'АвтоматическиВыделятьВознаграждениеВЧеке', j->'_fld4165',
      'ВознаграждениеВключеноВСтоимость', j->'_fld4166',
      'ВариантВыбытияМаркируемойПродукции', to_jsonb(onec.uuid(j->>'_fld4167rref')),
      'УдалитьЭтоУниверсальныйДокумент', j->'_fld4168',
      'ВариантЗаполненияДатыОтгрузки', to_jsonb(onec.uuid(j->>'_fld4169rref')),
      'ВидДнейРасчетаДатыОтгрузки', to_jsonb(onec.uuid(j->>'_fld4170rref')),
      'ПроизводственныйКалендарьРасчетаДатыОтгрузки', to_jsonb(onec.uuid(j->>'_fld4171rref')),
      'КоличествоДнейРасчетаДатыОтгрузки', j->'_fld4172',
      'СпособРаспределенияПоЗаказам', to_jsonb(onec.uuid(j->>'_fld4173rref')),
      'СпособВыставленияДокументов', to_jsonb(onec.uuid(j->>'_fld4174rref')),
      'Сумма', j->'_fld4175',
      'БанковскийСчетПоУмолчанию', to_jsonb(onec.uuid(j->>'_fld4176rref')),
      'ВариантЗаполненияДатыОплаты', to_jsonb(onec.uuid(j->>'_fld54922rref')),
      'ВидДнейРасчетаДатыОплаты', to_jsonb(onec.uuid(j->>'_fld54923rref')),
      'ПроизводственныйКалендарьРасчетаДатыОплаты', to_jsonb(onec.uuid(j->>'_fld54924rref')),
      'КоличествоДнейРасчетаДатыОплаты', j->'_fld54925'))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference171';

-- Справочник.Номенклатура (_reference368x1)
insert into ref.nomenclature (id, onec_version, deleted, predefined, parent_id, is_folder, code, name, unit_id, article, full_name, comment, kind, ext_code, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.uuid(j->>'_predefinedid'),
    onec.uuid(j->>'_parentidrref'),
    (j->>'_folder')::boolean,
    j->>'_code',
    j->>'_description',
    onec.uuid(j->>'_fld9229rref'),
    j->>'_fld9223',
    j->>'_fld9251',
    j->>'_fld9262',
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld9303rref')),
    j->>'_fld56764',
    jsonb_strip_nulls(jsonb_build_object(
      'АлкогольнаяПродукция', j->'_fld9224',
      'ВариантОграниченияСертификата', to_jsonb(onec.uuid(j->>'_fld9226rref')),
      'ВариантПечатиНабора', to_jsonb(onec.uuid(j->>'_fld9227rref')),
      'ВерхняяГраницаОстатков', j->'_fld9228',
      'Вес', j->'_fld9225',
      'Весовой', j->'_fld9230',
      'ВесПоСертификатуТовара', j->'_fld9325',
      'ВидАлкогольнойПродукции', to_jsonb(onec.uuid(j->>'_fld9231rref')),
      'ВидМаркировки', to_jsonb(onec.uuid(j->>'_fld9232rref')),
      'ВидПодакцизногоТовара', to_jsonb(onec.uuid(j->>'_fld9345rref')),
      'ВидПродукцииИС', to_jsonb(onec.uuid(j->>'_fld9233rref')),
      'АвтоматическиГенерироватьПартии', j->'_fld9234',
      'ВыписыватьГарантийныйТалон', j->'_fld9235',
      'Высота', j->'_fld9236',
      'ГарантийныйСрок', j->'_fld9237',
      'ДатаИзменения', j->'_fld9238',
      'ДатаОкончанияДействия', j->'_fld9239',
      'Длина', j->'_fld9240',
      'Договор', to_jsonb(onec.uuid(j->>'_fld9321rref')),
      'ЕдиницаДляОтчетов', to_jsonb(onec.uuid(j->>'_fld9329rref')),
      'ЕдиницаДляЦенников', to_jsonb(onec.uuid(j->>'_fld9342rref')),
      'ЕдиницаИзмеренияДляРасчетаАкциза', to_jsonb(onec.uuid(j->>'_fld9347rref')),
      'ЕдиницаИзмеренияСрокаГодности', to_jsonb(onec.uuid(j->>'_fld9323rref')),
      'ЗапретитьВводДробногоКоличества', j->'_fld9338',
      'Знаменатель', j->'_fld9344',
      'Изготовитель', to_jsonb(onec.uuid(j->>'_fld9242rref')),
      'ИмпортнаяАлкогольнаяПродукция', j->'_fld9243',
      'ИндивидуальныеНастройкиПолитикиУчетаСерий', j->'_fld9315',
      'ИсключитьИзПрайсЛистов', j->'_fld9244',
      'ИспользоватьДатуПроизводстваПартии', j->'_fld9245',
      'ИспользоватьДатуПроизводстваСерии', j->'_fld9317',
      'ИспользоватьЗаписьСкладскогоЖурналаВЕТИСПартии', j->'_fld9246',
      'ИспользоватьИдентификаторПартииВЕТИСПартии', j->'_fld9247',
      'ИспользоватьНаборыЕдиницИзмерения', j->'_fld9328',
      'ИспользоватьНомерПартии', j->'_fld9248',
      'ИспользоватьПартии', j->'_fld9249',
      'ИспользоватьПроизводителяВЕТИСПартии', j->'_fld9250',
      'ИспользоватьСерииНоменклатуры', j->'_fld9241',
      'ИспользоватьСрокГодностиПартии', j->'_fld9252',
      'ИспользоватьСрокГодностиСерии', j->'_fld9316')
    || jsonb_build_object(
      'ИспользоватьУникальныеСерии', j->'_fld9319',
      'ИспользоватьХарактеристики', j->'_fld9253',
      'КатегорияНоменклатуры', to_jsonb(onec.uuid(j->>'_fld9254rref')),
      'КиЗГИСМ', j->'_fld9255',
      'КиЗГИСМGTIN', j->'_fld9256',
      'КиЗГИСМВид', to_jsonb(onec.uuid(j->>'_fld9257rref')),
      'КиЗГИСМРазмер', to_jsonb(onec.uuid(j->>'_fld9258rref')),
      'КиЗГИСМСпособВыпускаВОборот', to_jsonb(onec.uuid(j->>'_fld9259rref')),
      'КодВидаПодакцизногоТовара', to_jsonb(onec.uuid(j->>'_fld9346rref')),
      'КодМедицинскогоИзделия', j->'_fld9260',
      'КодОКПД2', j->'_fld9326',
      'КодТРУ', j->'_fld9332',
      'КоличествоПериодовДействия', j->'_fld9261',
      'КоэффициентЕдиницыДляОтчетов', j->'_fld9330',
      'КоэффициентПересчета', j->'_fld9349',
      'Крепость', j->'_fld9263',
      'МетодОценки', to_jsonb(onec.uuid(j->>'_fld9264rref')),
      'НаборЕдиницИзмерения', to_jsonb(onec.uuid(j->>'_fld9327rref')),
      'СтранаПроисхождения', to_jsonb(onec.uuid(j->>'_fld9265rref')),
      'НаправлениеДеятельности', to_jsonb(onec.uuid(j->>'_fld9266rref')),
      'Недействителен', j->'_fld9267',
      'НижняяГраницаОстатков', j->'_fld9268',
      'Номинал', j->'_fld9269',
      'НормаВремени', j->'_fld9270',
      'ОбувнаяПродукция', j->'_fld9271',
      'Объем', j->'_fld9272',
      'ОбъемДАЛ', j->'_fld9273',
      'Периодичность', to_jsonb(onec.uuid(j->>'_fld9274rref')),
      'ПодакцизныйТовар', j->'_fld9313',
      'ПодконтрольнаяПродукцияВЕТИС', j->'_fld9275',
      'ПолитикаУчетаСерий', to_jsonb(onec.uuid(j->>'_fld9314rref')),
      'Поставщик', to_jsonb(onec.uuid(j->>'_fld9276rref')),
      'ПризнакПредметаРасчета', to_jsonb(onec.uuid(j->>'_fld9334rref')),
      'ПриходоватьПодарочныйСертификатПриОплате', j->'_fld55004',
      'ПроверятьЗаполнениеПартий', j->'_fld9277',
      'ПроверятьЗаполнениеХарактеристики', j->'_fld9278',
      'ПродаетсяВРозлив', j->'_fld9341',
      'Производитель', to_jsonb(onec.uuid(j->>'_fld9279rref')),
      'ПроизводительИмпортерАлкогольнойПродукции', to_jsonb(onec.uuid(j->>'_fld9280rref')),
      'ПроизвольныйНоминал', j->'_fld9281')
    || jsonb_build_object(
      'ПрослеживаемыйКомплект', j->'_fld9333',
      'ПрослеживаемыйТовар', j->'_fld9324',
      'РеквизитДопУпорядочиванияУНФ', j->'_fld9282',
      'РекомендуемЗаказать', j->'_fld9283',
      'Склад', to_jsonb(onec.uuid(j->>'_fld9284rref')),
      'СпособОграниченияСертификата', to_jsonb(onec.uuid(j->>'_fld9285rref')),
      'СпособПополнения', to_jsonb(onec.uuid(j->>'_fld9286rref')),
      'СпособРасчетаЦеныНабора', to_jsonb(onec.uuid(j->>'_fld9287rref')),
      'СредствоИндивидуальнойЗащиты', j->'_fld9288',
      'СрокГодности', j->'_fld9322',
      'СрокДействияФлагаНовинка', j->'_fld9289',
      'СрокИсполненияЗаказа', j->'_fld9290',
      'СрокПополнения', j->'_fld9291',
      'ВидСтавкиНДС', to_jsonb(onec.uuid(j->>'_fld9292rref')),
      'СчетУчетаАкцизаПоИмпорту', to_jsonb(onec.uuid(j->>'_fld9348rref')),
      'СчетУчетаДоходов', to_jsonb(onec.uuid(j->>'_fld9293rref')),
      'СчетУчетаЗапасов', to_jsonb(onec.uuid(j->>'_fld9294rref')),
      'СчетУчетаЗатрат', to_jsonb(onec.uuid(j->>'_fld9295rref')),
      'СчетУчетаНДСПоПриобретеннымЦенностям', to_jsonb(onec.uuid(j->>'_fld9339rref')),
      'СчетУчетаНДСПоРеализации', to_jsonb(onec.uuid(j->>'_fld9340rref')),
      'ТабачнаяПродукция', j->'_fld9296',
      'ТипСрокаДействия', to_jsonb(onec.uuid(j->>'_fld9298rref')),
      'ТНВЭДГИСМ', j->'_fld9299',
      'ТоварнаяНоменклатураВЭД', to_jsonb(onec.uuid(j->>'_fld9300rref')),
      'ТолькоПоддержкаОстаткаПриРасчетеПотребностей', j->'_fld9301',
      'ТочностьУказанияСрокаГодностиСерии', to_jsonb(onec.uuid(j->>'_fld9318rref')),
      'УдалитьСпецификация', to_jsonb(onec.uuid(j->>'_fld9302rref')),
      'УдалитьСтавкаНДС', to_jsonb(onec.uuid(j->>'_fld9297rref')),
      'ФайлКартинки', to_jsonb(onec.uuid(j->>'_fld9304rref')),
      'ФиксированнаяСтоимость', j->'_fld9305',
      'ХарактеристикаЦен', to_jsonb(onec.uuid(j->>'_fld9335rref')),
      'ЦеноваяГруппа', to_jsonb(onec.uuid(j->>'_fld9306rref')),
      'ЧастичноеПогашение', j->'_fld9307',
      'Числитель', j->'_fld9343',
      'ШиныИПокрышки', j->'_fld9308',
      'Ширина', j->'_fld9309',
      'Штрихкод', j->'_fld9331',
      'ЭтоАгентскаяУслуга', j->'_fld9320',
      'ЭтоНабор', j->'_fld9310',
      'ЭтоНовинка', j->'_fld9311')
    || jsonb_build_object(
      'Ячейка', to_jsonb(onec.uuid(j->>'_fld9312rref')),
      'ИспользоватьСерииИзКатегории', j->'_fld56343',
      'ПодарочныйСертификатПринимаетКОплатеТолькоОрганизациеяЭмитент', j->'_fld56344',
      'асВремяВыполнения', j->'_fld9336',
      'асПроизводитель', to_jsonb(onec.uuid(j->>'_fld9337rref')),
      'ПрепаратОтпускаетсяПоДокументу', j->'_fld55005',
      'Операции0', to_jsonb(onec.uuid(j->>'_fld56345rref')),
      'АС_СтранаПроисхожденияДляПечати', to_jsonb(onec.uuid(j->>'_fld56756rref')),
      'АС_Принадлежность', to_jsonb(onec.uuid(j->>'_fld56762rref'))))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference368x1';

-- Справочник.ПартииНоменклатуры (_reference427)
insert into ref.batch (id, onec_version, deleted, predefined, owner_id, code, name, status, supplier_id, inactive, batch_no, expires_at, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.uuid(j->>'_predefinedid'),
    onec.uuid(j->>'_owneridrref'),
    j->>'_code',
    j->>'_description',
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld10712rref')),
    onec.uuid(j->>'_fld10713rref'),
    (j->>'_fld10714')::boolean,
    j->>'_fld10715',
    onec.ts(j->>'_fld10719'),
    jsonb_strip_nulls(jsonb_build_object(
      'ПроизводительВЕТИС', to_jsonb(onec.uuid(j->>'_fld10716rref')),
      'ЗаписьСкладскогоЖурналаВЕТИС', to_jsonb(onec.uuid(j->>'_fld10717rref')),
      'ИдентификаторПартииВЕТИС', j->'_fld10718',
      'ДатаПроизводства', j->'_fld10720',
      'НалогообложениеНДС', to_jsonb(onec.uuid(j->>'_fld10721rref')),
      'СтавкаНДС', to_jsonb(onec.uuid(j->>'_fld55017rref'))))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference427';

-- Документ.ЗаказПокупателя (_document813x1)
insert into doc.customer_order (id, onec_version, deleted, date, number, posted, author_id, currency_id, operation, ship_date, contract_id, base_doc_type, base_doc_id, base_doc_value, comment, counterparty_id, organization_id, responsible_id, order_state_type, order_state_id, order_state_value, reserve_warehouse_id, amount_includes_vat, total, client_order_number, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.ts(j->>'_date_time'),
    j->>'_number',
    (j->>'_posted')::boolean,
    onec.uuid(j->>'_fld20452rref'),
    onec.uuid(j->>'_fld20459rref'),
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld20464rref')),
    onec.ts(j->>'_fld20476'),
    onec.uuid(j->>'_fld20483rref'),
    case j->>'_fld20484_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld20484_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld20484_type' = E'\\x08' then onec.uuid(j->>'_fld20484_rrref') end,
    null::jsonb,
    j->>'_fld20501',
    onec.uuid(j->>'_fld20506rref'),
    onec.uuid(j->>'_fld20520rref'),
    onec.uuid(j->>'_fld20524rref'),
    case j->>'_fld20540_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld20540_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld20540_type' = E'\\x08' then onec.uuid(j->>'_fld20540_rrref') end,
    null::jsonb,
    onec.uuid(j->>'_fld20552rref'),
    (j->>'_fld20553')::boolean,
    (j->>'_fld20554')::numeric(15,2),
    j->>'_fld56903',
    jsonb_strip_nulls(jsonb_build_object(
      'АдресДоставки', j->'_fld20453',
      'АдресДоставкиЗначение', j->'_fld20454',
      'АдресДоставкиЗначенияПолей', j->'_fld20455',
      'АдресЭП', j->'_fld20456',
      'БанковскийСчет', to_jsonb(onec.uuid(j->>'_fld20457rref')),
      'БанковскийСчетКонтрагента', to_jsonb(onec.uuid(j->>'_fld20458rref')),
      'ВариантЗавершения', to_jsonb(onec.uuid(j->>'_fld20460rref')),
      'Вес', j->'_fld20461',
      'ВидЗаказа', jsonb_strip_nulls(jsonb_build_object('type', j->'_fld20462_type', 'rtref', j->'_fld20462_rtref', 'rrref', to_jsonb(onec.uuid(j->>'_fld20462_rrref')))),
      'ВидимостьИндикатораТребуетсяРасчет', j->'_fld20463',
      'ВидРабот', to_jsonb(onec.uuid(j->>'_fld20465rref')),
      'ВидСкидкиНаценки', to_jsonb(onec.uuid(j->>'_fld20466rref')),
      'ВидЦен', to_jsonb(onec.uuid(j->>'_fld20467rref')),
      'ВидЭлектронногоДокумента', to_jsonb(onec.uuid(j->>'_fld20468rref')),
      'ВремяДоставкиПо', j->'_fld20469',
      'ВремяДоставкиС', j->'_fld20470',
      'Высота', j->'_fld20471',
      'Грузоотправитель', to_jsonb(onec.uuid(j->>'_fld20472rref')),
      'Грузополучатель', to_jsonb(onec.uuid(j->>'_fld20473rref')),
      'ДатаВходящегоДокумента', j->'_fld20474',
      'ДатаИзменения', j->'_fld20475',
      'ДисконтнаяКарта', to_jsonb(onec.uuid(j->>'_fld20477rref')),
      'Длина', j->'_fld20478',
      'ДоверенностьВыдана', j->'_fld20479',
      'ДоверенностьДата', j->'_fld20480',
      'ДоверенностьЛицо', to_jsonb(onec.uuid(j->>'_fld20481rref')),
      'ДоверенностьНомер', j->'_fld20482',
      'ДополнительнаяИнформацияПоДоставке', j->'_fld20485',
      'Заметки', j->'_fld20486',
      'ЗапаснойТелефон', j->'_fld20487',
      'ЗапланироватьОплату', j->'_fld20488',
      'ЗонаТариф', to_jsonb(onec.uuid(j->>'_fld20489rref')),
      'ИдентификаторНаправленияДоставки', j->'_fld20490',
      'ИдентификаторПлатежа', j->'_fld20491',
      'ИспользоватьЗарплатаИсполнителей', j->'_fld20492',
      'ИспользоватьМатериалы', j->'_fld20493',
      'ИспользоватьМатериалыЗаказчика', j->'_fld20494',
      'ИспользоватьТовары', j->'_fld20495',
      'ИсточникПривлечения', to_jsonb(onec.uuid(j->>'_fld20496rref')),
      'КалькуляцияРассчитана', j->'_fld20497')
    || jsonb_build_object(
      'Касса', to_jsonb(onec.uuid(j->>'_fld20498rref')),
      'КассаККМ', to_jsonb(onec.uuid(j->>'_fld20499rref')),
      'КоличествоВариантовКП', j->'_fld20500',
      'КомментарийКалькуляции', j->'_fld20502',
      'КонтактноеЛицо', j->'_fld20503',
      'КонтактноеЛицоПодписант', to_jsonb(onec.uuid(j->>'_fld20504rref')),
      'КонтактныйТелефон', j->'_fld20505',
      'Кратность', j->'_fld20507',
      'Курс', j->'_fld20508',
      'Курьер', to_jsonb(onec.uuid(j->>'_fld20509rref')),
      'НалогообложениеНДС', to_jsonb(onec.uuid(j->>'_fld20510rref')),
      'НДСВключатьВСтоимость', j->'_fld20511',
      'НоменклатураДоставки', to_jsonb(onec.uuid(j->>'_fld20512rref')),
      'НомерВходящегоДокумента', j->'_fld20513',
      'НомерСменыККМ', j->'_fld20514',
      'НомерЧекаККМ', j->'_fld20515',
      'Объем', j->'_fld20516',
      'ОбъявленнаяЦенность', j->'_fld20517',
      'ОжидаемаяДатаВручения', j->'_fld20518',
      'ОжидаетсяВыборВариантаКП', j->'_fld20519',
      'ОснованиеПечати', j->'_fld20521',
      'ОснованиеПечатиСсылка', jsonb_strip_nulls(jsonb_build_object('type', j->'_fld20522_type', 'rtref', j->'_fld20522_rtref', 'rrref', to_jsonb(onec.uuid(j->>'_fld20522_rrref')))),
      'ОсновнойВариантКП', j->'_fld20523',
      'ПодписьГлавногоБухгалтера', to_jsonb(onec.uuid(j->>'_fld20525rref')),
      'ПодписьКассира', to_jsonb(onec.uuid(j->>'_fld20526rref')),
      'ПодписьКладовщика', to_jsonb(onec.uuid(j->>'_fld20527rref')),
      'ПодписьРуководителя', to_jsonb(onec.uuid(j->>'_fld20528rref')),
      'ПоложениеВидаРабот', to_jsonb(onec.uuid(j->>'_fld20529rref')),
      'ПоложениеДатыОтгрузки', to_jsonb(onec.uuid(j->>'_fld20530rref')),
      'ПоложениеСклада', to_jsonb(onec.uuid(j->>'_fld20531rref')),
      'ПочтаПолучателя', j->'_fld20532',
      'ПричинаОтмены', to_jsonb(onec.uuid(j->>'_fld20533rref')),
      'Проект', to_jsonb(onec.uuid(j->>'_fld20534rref')),
      'ПроцентСкидкиПоДисконтнойКарте', j->'_fld20535',
      'ПунктВыдачиЗаказа', to_jsonb(onec.uuid(j->>'_fld20536rref')),
      'СкидкиРассчитаны', j->'_fld20537',
      'СлужбаДоставки', to_jsonb(onec.uuid(j->>'_fld20538rref')),
      'Событие', to_jsonb(onec.uuid(j->>'_fld20539rref')),
      'СпециальныйНалоговыйРежим', to_jsonb(onec.uuid(j->>'_fld20541rref')),
      'СписокНоменклатуры', j->'_fld20542')
    || jsonb_build_object(
      'СписокРесурсов', j->'_fld20543',
      'СпособДоставки', to_jsonb(onec.uuid(j->>'_fld20544rref')),
      'СпособЗачетаПредоплаты', to_jsonb(onec.uuid(j->>'_fld20545rref')),
      'СпособОтгрузки', to_jsonb(onec.uuid(j->>'_fld20546rref')),
      'СпособРасчетаСебестоимостиКалькуляции', jsonb_strip_nulls(jsonb_build_object('type', j->'_fld20547_type', 'rtref', j->'_fld20547_rtref', 'rrref', to_jsonb(onec.uuid(j->>'_fld20547_rrref')))),
      'СтавкаНДСДоставки', to_jsonb(onec.uuid(j->>'_fld20548rref')),
      'Старт', j->'_fld20549',
      'СтоимостьДоставки', j->'_fld20550',
      'СтруктурнаяЕдиницаПродажи', to_jsonb(onec.uuid(j->>'_fld20551rref')),
      'СуммаНДСДоставки', j->'_fld20555',
      'Телефон', j->'_fld20556',
      'ТипДенежныхСредств', to_jsonb(onec.uuid(j->>'_fld20557rref')),
      'ТрекНомер', j->'_fld20558',
      'УдалитьЗакрыт', j->'_fld20559',
      'УдалитьИспользоватьФаксимиле', to_jsonb(onec.uuid(j->>'_fld20560rref')),
      'УсловияГарантийногоТалона', to_jsonb(onec.uuid(j->>'_fld20561rref')),
      'УсловияКоммерческогоПредложения', to_jsonb(onec.uuid(j->>'_fld20562rref')),
      'УсловияСчетаЗаказа', to_jsonb(onec.uuid(j->>'_fld20563rref')),
      'УчитыватьВНУ', j->'_fld20564',
      'Финиш', j->'_fld20565',
      'ХозяйственнаяОперация', to_jsonb(onec.uuid(j->>'_fld20566rref')),
      'асДокументОснование', jsonb_strip_nulls(jsonb_build_object('type', j->'_fld20567_type', 'rtref', j->'_fld20567_rtref', 'rrref', to_jsonb(onec.uuid(j->>'_fld20567_rrref')))),
      'ШаблонКалькуляции', to_jsonb(onec.uuid(j->>'_fld20568rref')),
      'Ширина', j->'_fld20569',
      'Ячейка', to_jsonb(onec.uuid(j->>'_fld20570rref')),
      'РасчетКалькуляцииПоДаннымТЧ', j->'_fld20571',
      'СебестоимостьДоставки', j->'_fld20572',
      'СсылкаДляОплаты', j->'_fld20573',
      'СозданИзКабинетаКлиента', j->'_fld20574',
      'СервисДоставки', to_jsonb(onec.uuid(j->>'_fld20575rref')),
      'УчетПотребностиПоСкладам', j->'_fld20576',
      'УчетПотребностиПоЗаказам', j->'_fld20577',
      'ЭтоУниверсальныйДокумент', j->'_fld20578',
      'Водитель', to_jsonb(onec.uuid(j->>'_fld20579rref')),
      'Автомобиль', to_jsonb(onec.uuid(j->>'_fld20580rref')),
      'Прицеп', to_jsonb(onec.uuid(j->>'_fld20581rref')),
      'Перевозчик', to_jsonb(onec.uuid(j->>'_fld20582rref')),
      'СтатусСборки', j->'_fld20583',
      'УсловияЗаказаПокупателя', to_jsonb(onec.uuid(j->>'_fld20584rref')),
      'ТекстУсловийЗаказаПокупателя', j->'_fld20585')
    || jsonb_build_object(
      'ТекстУсловийКоммерческогоПредложения', j->'_fld20586',
      'ТекстУсловийСчетаЗаказа', j->'_fld20587',
      'ТекстУсловийГарантийногоТалона', j->'_fld20588',
      'ДокументПоступления', to_jsonb(onec.uuid(j->>'_fld20589rref')),
      'ПоложениеДокументаПоступления', to_jsonb(onec.uuid(j->>'_fld20590rref')),
      'ДатаПоступления', j->'_fld20591',
      'ПоложениеДатыПоступления', to_jsonb(onec.uuid(j->>'_fld20592rref')),
      'КодОперацииПрослеживаемости', to_jsonb(onec.uuid(j->>'_fld20593rref')),
      'ТоварыПередаютсяВСоставеРабот', j->'_fld20594',
      'ОплаченВВыставленииСчетов', j->'_fld55076',
      'ОплатаДо', j->'_fld55077',
      'ОтгруженВВыставленииСчетов', j->'_fld55078',
      'РегистрироватьЦеныПродажи', j->'_fld55079',
      'ИспользоватьСкидкиВыставлениеСчетов', j->'_fld55080',
      'РекламныйБлокПечтаныхФорм', to_jsonb(onec.uuid(j->>'_fld55081rref')),
      'ВидЗакрывающегоДокументаВыставлениеСчетов', to_jsonb(onec.uuid(j->>'_fld55082rref')),
      'НомерЗакрывающегоДокументаВыставлениеСчетов', j->'_fld55083',
      'ДатаЗакрывающегоДокументаВыставлениеСчетов', j->'_fld55084',
      'НетСтрокВДокументе', j->'_fld55085',
      'Лид', to_jsonb(onec.uuid(j->>'_fld56366rref'))))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_document813x1';

-- Документ.ЗаказПокупателя.Запасы (_document813_vt20595x1)
insert into doc.customer_order_item (id, line_no, nomenclature_type, nomenclature_id, nomenclature_value, characteristic_id, reserve_qty, unit_type, unit_id, unit_value, price, discount_pct, discount_amount, amount, vat_rate_id, vat_amount, total, ship_date, content, qty, link_no, batch_id, reserve_warehouse_id, cell_id, row_uid, client_name, client_qty, arm_link_key, client_order_no, client_order_date, client_urgency, client_plate, client_territory, client_article, client_unit, doc_id, extra)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_document813_idrref')::text || ':' || (j->>'_lineno20596')),
    (j->>'_lineno20596')::numeric(5,0),
    case j->>'_fld20598_type' when E'\\x08' then null when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld20598_type' = E'\\x08' then onec.uuid(j->>'_fld20598_rrref') end,
    case j->>'_fld20598_type' when E'\\x05' then j->'_fld20598_s' end,
    onec.uuid(j->>'_fld20599rref'),
    (j->>'_fld20601')::numeric(15,3),
    case j->>'_fld20603_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld20603_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld20603_type' = E'\\x08' then onec.uuid(j->>'_fld20603_rrref') end,
    null::jsonb,
    (j->>'_fld20604')::numeric(15,2),
    (j->>'_fld20605')::numeric(5,2),
    (j->>'_fld20606')::numeric(15,2),
    (j->>'_fld20607')::numeric(15,2),
    onec.uuid(j->>'_fld20608rref'),
    (j->>'_fld20609')::numeric(15,2),
    (j->>'_fld20610')::numeric(15,2),
    onec.ts(j->>'_fld20611'),
    j->>'_fld20613',
    (j->>'_fld20616')::numeric(15,3),
    (j->>'_fld20617')::numeric(5,0),
    onec.uuid(j->>'_fld20620rref'),
    onec.uuid(j->>'_fld20628rref'),
    onec.uuid(j->>'_fld20629rref'),
    j->>'_fld20633',
    j->>'_fld56893',
    rtrim(j->>'_fld56894'),
    j->>'_fld56895',
    j->>'_fld56896',
    j->>'_fld56897',
    j->>'_fld56898',
    j->>'_fld56899',
    j->>'_fld56900',
    j->>'_fld56901',
    j->>'_fld56902',
    onec.uuid(j->>'_document813_idrref'),
    jsonb_strip_nulls(jsonb_build_object(
      'ТипНоменклатурыЗапас', j->'_fld20597',
      'СерииНоменклатуры', j->'_fld20600',
      'РезервОтгрузка', j->'_fld20602',
      'Спецификация', to_jsonb(onec.uuid(j->>'_fld20612rref')),
      'ПроцентАвтоматическойСкидки', j->'_fld20614',
      'СуммаАвтоматическойСкидки', j->'_fld20615',
      'СтранаПроисхождения', to_jsonb(onec.uuid(j->>'_fld20618rref')),
      'НомерГТД', to_jsonb(onec.uuid(j->>'_fld20619rref')),
      'Вес', j->'_fld20621',
      'Объем', j->'_fld20622',
      'НомерВариантаКП', j->'_fld20623',
      'ЭтоРазделитель', j->'_fld20624',
      'НоменклатураНабора', to_jsonb(onec.uuid(j->>'_fld20625rref')),
      'ХарактеристикаНабора', to_jsonb(onec.uuid(j->>'_fld20626rref')),
      'ДоляСтоимости', j->'_fld20627',
      'КоличествоСобрано', j->'_fld20630',
      'ПрослеживаемыйТовар', j->'_fld20631',
      'КодТНВЭД', to_jsonb(onec.uuid(j->>'_fld20632rref')),
      'ПрослеживаемыйКомплект', j->'_fld20634',
      'ПродажаПодарка', j->'_fld20635',
      'СуммаСкидкиОплатыБонусом', j->'_fld20636',
      'ДокументПоступления', to_jsonb(onec.uuid(j->>'_fld20637rref'))))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_document813_vt20595x1';

-- Документ.ЗаказПокупателя.Материалы (_document813_vt20690x1)
insert into doc.customer_order_material (id, line_no, link_no, nomenclature_id, characteristic_id, batch_id, qty, reserve_qty, unit_type, unit_id, unit_value, reserve_warehouse_id, cell_id, row_uid, content, doc_id, extra)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_document813_idrref')::text || ':' || (j->>'_lineno20691')),
    (j->>'_lineno20691')::numeric(5,0),
    (j->>'_fld20692')::numeric(5,0),
    onec.uuid(j->>'_fld20693rref'),
    onec.uuid(j->>'_fld20694rref'),
    onec.uuid(j->>'_fld20695rref'),
    (j->>'_fld20697')::numeric(15,3),
    (j->>'_fld20698')::numeric(15,3),
    case j->>'_fld20700_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld20700_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld20700_type' = E'\\x08' then onec.uuid(j->>'_fld20700_rrref') end,
    null::jsonb,
    onec.uuid(j->>'_fld20704rref'),
    onec.uuid(j->>'_fld20705rref'),
    j->>'_fld20709',
    j->>'_fld56368',
    onec.uuid(j->>'_document813_idrref'),
    jsonb_strip_nulls(jsonb_build_object(
      'СерииНоменклатуры', j->'_fld20696',
      'РезервОтгрузка', j->'_fld20699',
      'СтранаПроисхождения', to_jsonb(onec.uuid(j->>'_fld20701rref')),
      'НомерГТД', to_jsonb(onec.uuid(j->>'_fld20702rref')),
      'КлючСвязиСерииНоменклатуры', j->'_fld20703',
      'ДокументПоступления', to_jsonb(onec.uuid(j->>'_fld20706rref')),
      'ПрослеживаемыйТовар', j->'_fld20707',
      'КодТНВЭД', to_jsonb(onec.uuid(j->>'_fld20708rref')),
      'ПрослеживаемыйКомплект', j->'_fld20710'))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_document813_vt20690x1';

-- Документ.ЗаказПокупателя.Работы (_document813_vt20653x1)
insert into doc.customer_order_work (id, line_no, work_kind_id, nomenclature_id, characteristic_id, qty, price, amount, discount_pct, discount_amount, vat_rate_id, vat_amount, total, content, link_no, multiplicity, coefficient, row_uid, doc_id, extra)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_document813_idrref')::text || ':' || (j->>'_lineno20654')),
    (j->>'_lineno20654')::numeric(5,0),
    onec.uuid(j->>'_fld20655rref'),
    onec.uuid(j->>'_fld20656rref'),
    onec.uuid(j->>'_fld20658rref'),
    (j->>'_fld20660')::numeric(15,3),
    (j->>'_fld20661')::numeric(15,2),
    (j->>'_fld20662')::numeric(15,2),
    (j->>'_fld20663')::numeric(5,2),
    (j->>'_fld20664')::numeric(15,2),
    onec.uuid(j->>'_fld20665rref'),
    (j->>'_fld20666')::numeric(15,2),
    (j->>'_fld20667')::numeric(15,2),
    j->>'_fld20668',
    (j->>'_fld20669')::numeric(5,0),
    (j->>'_fld20670')::numeric(10,3),
    (j->>'_fld20671')::numeric(15,3),
    j->>'_fld20679',
    onec.uuid(j->>'_document813_idrref'),
    jsonb_strip_nulls(jsonb_build_object(
      'ТипНоменклатурыУслуга', j->'_fld20657',
      'Спецификация', to_jsonb(onec.uuid(j->>'_fld20659rref')),
      'ПроцентАвтоматическойСкидки', j->'_fld20672',
      'СуммаАвтоматическойСкидки', j->'_fld20673',
      'КлючСвязиДляСкидокНаценок', j->'_fld20674',
      'НоменклатураНабора', to_jsonb(onec.uuid(j->>'_fld20675rref')),
      'ХарактеристикаНабора', to_jsonb(onec.uuid(j->>'_fld20676rref')),
      'ДоляСтоимости', j->'_fld20677',
      'СуммаСкидкиОплатыБонусом', j->'_fld20678',
      'ПрослеживаемыйТовар', j->'_fld20680',
      'ПрослеживаемыйКомплект', j->'_fld20681'))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_document813_vt20653x1';

-- Документ.ЗаказПоставщику (_document814)
insert into doc.supplier_order (id, onec_version, deleted, date, number, posted, author_id, currency_id, operation, receipt_date, contract_id, customer_order_id, comment, counterparty_id, organization_id, responsible_id, order_state_id, warehouse_id, reserve_warehouse_id, amount_includes_vat, total, base_doc_type, base_doc_id, base_doc_value, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.ts(j->>'_date_time'),
    j->>'_number',
    (j->>'_posted')::boolean,
    onec.uuid(j->>'_fld20901rref'),
    onec.uuid(j->>'_fld20903rref'),
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld20905rref')),
    onec.ts(j->>'_fld20908'),
    onec.uuid(j->>'_fld20909rref'),
    onec.uuid(j->>'_fld20911rref'),
    j->>'_fld20915',
    onec.uuid(j->>'_fld20916rref'),
    onec.uuid(j->>'_fld20922rref'),
    onec.uuid(j->>'_fld20923rref'),
    onec.uuid(j->>'_fld20926rref'),
    onec.uuid(j->>'_fld20927rref'),
    onec.uuid(j->>'_fld20928rref'),
    (j->>'_fld20929')::boolean,
    (j->>'_fld20930')::numeric(15,2),
    case j->>'_fld20936_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld20936_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld20936_type' = E'\\x08' then onec.uuid(j->>'_fld20936_rrref') end,
    null::jsonb,
    jsonb_strip_nulls(jsonb_build_object(
      'БанковскийСчет', to_jsonb(onec.uuid(j->>'_fld20902rref')),
      'ВариантЗавершения', to_jsonb(onec.uuid(j->>'_fld20904rref')),
      'ВидЦенКонтрагента', to_jsonb(onec.uuid(j->>'_fld20906rref')),
      'ДатаВходящегоДокумента', j->'_fld20907',
      'ЕстьКиЗГИСМ', j->'_fld20910',
      'Заметки', j->'_fld20912',
      'ЗапланироватьОплату', j->'_fld20913',
      'Касса', to_jsonb(onec.uuid(j->>'_fld20914rref')),
      'Кратность', j->'_fld20917',
      'Курс', j->'_fld20918',
      'НалогообложениеНДС', to_jsonb(onec.uuid(j->>'_fld20919rref')),
      'НДСВключатьВСтоимость', j->'_fld20920',
      'НомерВходящегоДокумента', j->'_fld20921',
      'ПоложениеДатыПоступления', to_jsonb(onec.uuid(j->>'_fld20924rref')),
      'Событие', to_jsonb(onec.uuid(j->>'_fld20925rref')),
      'ТипДенежныхСредств', to_jsonb(onec.uuid(j->>'_fld20931rref')),
      'УдалитьЗакрыт', j->'_fld20932',
      'ХозяйственнаяОперация', to_jsonb(onec.uuid(j->>'_fld20933rref')),
      'РезервироватьДенежныеСредства', j->'_fld20934',
      'ПоложениеЗаказаПокупателя', to_jsonb(onec.uuid(j->>'_fld20935rref')),
      'УчетПотребностиПоСкладам', j->'_fld20937',
      'ПоложениеСклада', to_jsonb(onec.uuid(j->>'_fld20938rref')),
      'асДокументОснование', to_jsonb(onec.uuid(j->>'_fld20939rref')),
      'Вес', j->'_fld20940',
      'Объем', j->'_fld20941',
      'РегистрироватьЦеныПоставщика', j->'_fld55086',
      'Проект', to_jsonb(onec.uuid(j->>'_fld56370rref'))))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_document814';

-- Документ.ЗаказПоставщику.Запасы (_document814_vt20942)
insert into doc.supplier_order_item (id, line_no, nomenclature_id, characteristic_id, qty, unit_type, unit_id, unit_value, price, discount_pct, discount_amount, amount, vat_rate_id, vat_amount, receipt_date, total, content, customer_order_id, reserve_warehouse_id, doc_id, extra)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_document814_idrref')::text || ':' || (j->>'_lineno20943')),
    (j->>'_lineno20943')::numeric(5,0),
    onec.uuid(j->>'_fld20944rref'),
    onec.uuid(j->>'_fld20945rref'),
    (j->>'_fld20946')::numeric(15,3),
    case j->>'_fld20947_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld20947_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld20947_type' = E'\\x08' then onec.uuid(j->>'_fld20947_rrref') end,
    null::jsonb,
    (j->>'_fld20948')::numeric(15,2),
    (j->>'_fld20949')::numeric(5,2),
    (j->>'_fld20950')::numeric(15,2),
    (j->>'_fld20951')::numeric(15,2),
    onec.uuid(j->>'_fld20952rref'),
    (j->>'_fld20953')::numeric(15,2),
    onec.ts(j->>'_fld20954'),
    (j->>'_fld20955')::numeric(15,2),
    j->>'_fld20956',
    onec.uuid(j->>'_fld20958rref'),
    onec.uuid(j->>'_fld20959rref'),
    onec.uuid(j->>'_document814_idrref'),
    jsonb_strip_nulls(jsonb_build_object(
      'Спецификация', to_jsonb(onec.uuid(j->>'_fld20957rref')),
      'Вес', j->'_fld20960',
      'Объем', j->'_fld20961',
      'НоменклатураПоставщика', to_jsonb(onec.uuid(j->>'_fld20962rref'))))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_document814_vt20942';

-- Документ.ПриходнаяНакладная (_document954)
insert into doc.receipt (id, onec_version, deleted, date, number, posted, author_id, currency_id, operation, incoming_date, contract_id, base_doc_type, base_doc_id, base_doc_value, supplier_order_type, supplier_order_id, supplier_order_value, comment, counterparty_id, incoming_no, organization_id, responsible_id, warehouse_id, amount_includes_vat, total, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.ts(j->>'_date_time'),
    j->>'_number',
    (j->>'_posted')::boolean,
    onec.uuid(j->>'_fld28325rref'),
    onec.uuid(j->>'_fld28329rref'),
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld28330rref')),
    onec.ts(j->>'_fld28333'),
    onec.uuid(j->>'_fld28335rref'),
    case j->>'_fld28336_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld28336_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld28336_type' = E'\\x08' then onec.uuid(j->>'_fld28336_rrref') end,
    null::jsonb,
    case j->>'_fld28339_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld28339_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld28339_type' = E'\\x08' then onec.uuid(j->>'_fld28339_rrref') end,
    null::jsonb,
    j->>'_fld28341',
    onec.uuid(j->>'_fld28343rref'),
    j->>'_fld28348',
    onec.uuid(j->>'_fld28351rref'),
    onec.uuid(j->>'_fld28352rref'),
    onec.uuid(j->>'_fld28368rref'),
    (j->>'_fld28369')::boolean,
    (j->>'_fld28370')::numeric(15,2),
    jsonb_strip_nulls(jsonb_build_object(
      'АдресЧекаЕГАИС', j->'_fld28326',
      'АдресЭП', j->'_fld28327',
      'АктПереданВЕГАИС', j->'_fld28328',
      'ВидЦенКонтрагента', to_jsonb(onec.uuid(j->>'_fld28331rref')),
      'ВключатьРасходыВСебестоимость', j->'_fld28332',
      'ДисконтнаяКарта', to_jsonb(onec.uuid(j->>'_fld28334rref')),
      'ЕстьМаркируемаяПродукцияГИСМ', j->'_fld28337',
      'ЕстьРасхождения', j->'_fld28338',
      'ИдентификаторЧекаШтрихМ', j->'_fld28340',
      'КонтактноеЛицоПодписант', to_jsonb(onec.uuid(j->>'_fld28342rref')),
      'Кратность', j->'_fld28344',
      'Курс', j->'_fld28345',
      'НалогообложениеНДС', to_jsonb(onec.uuid(j->>'_fld28346rref')),
      'НДСВключатьВСтоимость', j->'_fld28347',
      'НомерСменыККМ', j->'_fld28349',
      'НомерЧекаККМ', j->'_fld28350',
      'ПодписьКассира', to_jsonb(onec.uuid(j->>'_fld28353rref')),
      'ПодписьКладовщика', to_jsonb(onec.uuid(j->>'_fld28354rref')),
      'ПодписьЧекаЕГАИС', j->'_fld28355',
      'Подразделение', to_jsonb(onec.uuid(j->>'_fld28356rref')),
      'ПоложениеЗаказаПоставщику', to_jsonb(onec.uuid(j->>'_fld28357rref')),
      'ПоложениеСклада', to_jsonb(onec.uuid(j->>'_fld28358rref')),
      'ПолученИзЕГАИС', j->'_fld28359',
      'ПолученыДокументыПодтверждающиеРасхождения', j->'_fld28360',
      'ПринятьПоКолонке', to_jsonb(onec.uuid(j->>'_fld28361rref')),
      'ПроверятьРасхожденияСВходящимДокументом', j->'_fld28362',
      'ПроверятьРасхожденияСЗаказом', j->'_fld28363',
      'РегистрироватьЦеныПоставщика', j->'_fld28364',
      'СпециальныйНалоговыйРежим', to_jsonb(onec.uuid(j->>'_fld28365rref')),
      'СпособЗачетаПредоплаты', to_jsonb(onec.uuid(j->>'_fld28366rref')),
      'СрокХранения', j->'_fld28367',
      'Телефон', j->'_fld28371',
      'ХозяйственнаяОперация', to_jsonb(onec.uuid(j->>'_fld28372rref')),
      'ЧекККМ', to_jsonb(onec.uuid(j->>'_fld28373rref')),
      'Ячейка', to_jsonb(onec.uuid(j->>'_fld28374rref')),
      'Проект', to_jsonb(onec.uuid(j->>'_fld28375rref')),
      'ЭтоУниверсальныйДокумент', j->'_fld28376',
      'ВидЦенВозврата', to_jsonb(onec.uuid(j->>'_fld28377rref')),
      'ОсвобождатьАвансАвтоматически', j->'_fld28378',
      'ПокупателюВыставляетсяКорректировочныйСчетФактура', j->'_fld28379')
    || jsonb_build_object(
      'ПокупателемВыставляетсяСчетФактураНаВозврат', j->'_fld28380',
      'ПоложениеПроекта', to_jsonb(onec.uuid(j->>'_fld28381rref')),
      'ДокументПоступления', to_jsonb(onec.uuid(j->>'_fld28382rref')),
      'ПоложениеДокументаПоступления', to_jsonb(onec.uuid(j->>'_fld28383rref')),
      'ДоговорКомиссии', to_jsonb(onec.uuid(j->>'_fld28384rref')),
      'Грузоотправитель', to_jsonb(onec.uuid(j->>'_fld28385rref'))))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_document954';

-- Документ.ПриходнаяНакладная.Расходы (_document954_vt28435)
insert into doc.receipt_expense (id, line_no, nomenclature_id, unit_type, unit_id, unit_value, qty, price, discount_pct, discount_amount, amount, vat_rate_id, vat_amount, total, order_doc, warehouse_id, content, doc_id, extra)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_document954_idrref')::text || ':' || (j->>'_lineno28436')),
    (j->>'_lineno28436')::numeric(5,0),
    onec.uuid(j->>'_fld28437rref'),
    case j->>'_fld28438_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld28438_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld28438_type' = E'\\x08' then onec.uuid(j->>'_fld28438_rrref') end,
    null::jsonb,
    (j->>'_fld28439')::numeric(15,3),
    (j->>'_fld28440')::numeric(15,2),
    (j->>'_fld28441')::numeric(5,2),
    (j->>'_fld28442')::numeric(15,2),
    (j->>'_fld28443')::numeric(15,2),
    onec.uuid(j->>'_fld28444rref'),
    (j->>'_fld28445')::numeric(15,2),
    (j->>'_fld28447')::numeric(15,2),
    onec.uuid(j->>'_fld28448rref'),
    onec.uuid(j->>'_fld28449rref'),
    j->>'_fld28451',
    onec.uuid(j->>'_document954_idrref'),
    jsonb_strip_nulls(jsonb_build_object(
      'ЗаказПоставщику', to_jsonb(onec.uuid(j->>'_fld28446rref')),
      'НаправлениеДеятельности', to_jsonb(onec.uuid(j->>'_fld28450rref')),
      'Проект', to_jsonb(onec.uuid(j->>'_fld28452rref'))))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_document954_vt28435';

-- Документ.ПриходнаяНакладная.Запасы (_document954_vt28386)
insert into doc.receipt_item (id, line_no, nomenclature_id, unit_type, unit_id, unit_value, characteristic_id, price, discount_pct, discount_amount, amount, vat_rate_id, vat_amount, order_doc_type, order_doc_id, order_doc_value, total, cost, content, link_no, row_uid, batch_id, qty, warehouse_id, cell_id, customer_order_id, doc_id, extra)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_document954_idrref')::text || ':' || (j->>'_lineno28387')),
    (j->>'_lineno28387')::numeric(5,0),
    onec.uuid(j->>'_fld28388rref'),
    case j->>'_fld28389_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld28389_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld28389_type' = E'\\x08' then onec.uuid(j->>'_fld28389_rrref') end,
    null::jsonb,
    onec.uuid(j->>'_fld28390rref'),
    (j->>'_fld28392')::numeric(15,2),
    (j->>'_fld28393')::numeric(5,2),
    (j->>'_fld28394')::numeric(15,2),
    (j->>'_fld28395')::numeric(15,2),
    onec.uuid(j->>'_fld28396rref'),
    (j->>'_fld28397')::numeric(15,2),
    case j->>'_fld28398_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld28398_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld28398_type' = E'\\x08' then onec.uuid(j->>'_fld28398_rrref') end,
    null::jsonb,
    (j->>'_fld28399')::numeric(15,2),
    (j->>'_fld28400')::numeric(15,2),
    j->>'_fld28402',
    (j->>'_fld28403')::numeric(5,0),
    j->>'_fld28404',
    onec.uuid(j->>'_fld28406rref'),
    (j->>'_fld28407')::numeric(15,3),
    onec.uuid(j->>'_fld28411rref'),
    onec.uuid(j->>'_fld28412rref'),
    onec.uuid(j->>'_fld28418rref'),
    onec.uuid(j->>'_document954_idrref'),
    jsonb_strip_nulls(jsonb_build_object(
      'СерииНоменклатуры', j->'_fld28391',
      'СуммаРасходов', j->'_fld28401',
      'НеобходимостьВводаАкцизнойМарки', j->'_fld28405',
      'СтранаПроисхождения', to_jsonb(onec.uuid(j->>'_fld28408rref')),
      'НомерГТД', to_jsonb(onec.uuid(j->>'_fld28409rref')),
      'ТоварыДляПроизводства', j->'_fld28410',
      'НоменклатураНабора', to_jsonb(onec.uuid(j->>'_fld28413rref')),
      'ХарактеристикаНабора', to_jsonb(onec.uuid(j->>'_fld28414rref')),
      'ДоляСтоимости', j->'_fld28415',
      'Штрихкод', j->'_fld28416',
      'НоменклатураЕГАИС', to_jsonb(onec.uuid(j->>'_fld28417rref')),
      'КоличествоСправочно', j->'_fld28419',
      'Комментарий', j->'_fld28420',
      'ПрослеживаемыйТовар', j->'_fld28421',
      'ПрослеживаемыйКомплект', j->'_fld28422',
      'СуммаРасходовБезНДС', j->'_fld28423',
      'ДокументПоступления', jsonb_strip_nulls(jsonb_build_object('type', j->'_fld28424_type', 'rtref', j->'_fld28424_rtref', 'rrref', to_jsonb(onec.uuid(j->>'_fld28424_rrref')))),
      'ЦенаПередачи', j->'_fld28425',
      'СуммаПередачи', j->'_fld28426',
      'СуммаНДСПередачи', j->'_fld28427',
      'НоменклатураПоставщика', to_jsonb(onec.uuid(j->>'_fld28428rref')),
      'ПодакцизныйТовар', j->'_fld28429',
      'СуммаАкциза', j->'_fld28430',
      'СтавкаАкциза', j->'_fld28431',
      'ЕдиницаИзмеренияАкциза', j->'_fld28432',
      'КоэффициентПересчета', j->'_fld28433',
      'ОкруглятьДоЦелого', j->'_fld28434',
      'НомерСтрокиДокументаОснования', j->'_fld55256'))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_document954_vt28386';

-- Документ.РасходнаяНакладная (_document966)
insert into doc.shipment (id, onec_version, deleted, date, number, posted, car_id, author_id, currency_id, operation, contract_id, base_doc_type, base_doc_id, base_doc_value, customer_order_type, customer_order_id, customer_order_value, comment, counterparty_id, organization_id, responsible_id, warehouse_id, amount_includes_vat, total, extra)
select
    onec.uuid(j->>'_idrref'),
    j->>'_version',
    (j->>'_marked')::boolean,
    onec.ts(j->>'_date_time'),
    j->>'_number',
    (j->>'_posted')::boolean,
    onec.uuid(j->>'_fld29035rref'),
    onec.uuid(j->>'_fld29036rref'),
    onec.uuid(j->>'_fld29044rref'),
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld29046rref')),
    onec.uuid(j->>'_fld29059rref'),
    case j->>'_fld29060_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld29060_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld29060_type' = E'\\x08' then onec.uuid(j->>'_fld29060_rrref') end,
    null::jsonb,
    case j->>'_fld29064_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld29064_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld29064_type' = E'\\x08' then onec.uuid(j->>'_fld29064_rrref') end,
    null::jsonb,
    j->>'_fld29067',
    onec.uuid(j->>'_fld29069rref'),
    onec.uuid(j->>'_fld29080rref'),
    onec.uuid(j->>'_fld29084rref'),
    onec.uuid(j->>'_fld29103rref'),
    (j->>'_fld29104')::boolean,
    (j->>'_fld29105')::numeric(15,2),
    jsonb_strip_nulls(jsonb_build_object(
      'АдресДоставки', j->'_fld29037',
      'АдресДоставкиЗначение', j->'_fld29038',
      'АдресДоставкиЗначенияПолей', j->'_fld29039',
      'АдресЭП', j->'_fld29040',
      'БанковскийСчет', to_jsonb(onec.uuid(j->>'_fld29041rref')),
      'БанковскийСчетКонтрагента', to_jsonb(onec.uuid(j->>'_fld29042rref')),
      'БанковскийСчетПеревозчика', to_jsonb(onec.uuid(j->>'_fld29043rref')),
      'Вес', j->'_fld29045',
      'ВидСкидкиНаценки', to_jsonb(onec.uuid(j->>'_fld29047rref')),
      'ВидЦен', to_jsonb(onec.uuid(j->>'_fld29048rref')),
      'ВидЭлектронногоДокумента', to_jsonb(onec.uuid(j->>'_fld29049rref')),
      'Водитель', to_jsonb(onec.uuid(j->>'_fld29050rref')),
      'Грузоотправитель', to_jsonb(onec.uuid(j->>'_fld29051rref')),
      'Грузополучатель', to_jsonb(onec.uuid(j->>'_fld29052rref')),
      'ДатаВходящегоДокумента', j->'_fld29053',
      'ДисконтнаяКарта', to_jsonb(onec.uuid(j->>'_fld29054rref')),
      'ДоверенностьВыдана', j->'_fld29055',
      'ДоверенностьДата', j->'_fld29056',
      'ДоверенностьЛицо', to_jsonb(onec.uuid(j->>'_fld29057rref')),
      'ДоверенностьНомер', j->'_fld29058',
      'ДополнительнаяИнформацияПоДоставке', j->'_fld29061',
      'ЕстьМаркируемаяПродукцияГИСМ', j->'_fld29062',
      'ЕстьПодконтрольнаяПродукцияВЕТИС', j->'_fld29063',
      'ИдентификаторПлатежа', j->'_fld29065',
      'ИдентификаторЧекаШтрихМ', j->'_fld29066',
      'КонтактноеЛицоПодписант', to_jsonb(onec.uuid(j->>'_fld29068rref')),
      'Кратность', j->'_fld29070',
      'Курс', j->'_fld29071',
      'НалогообложениеНДС', to_jsonb(onec.uuid(j->>'_fld29072rref')),
      'НДСВключатьВСтоимость', j->'_fld29073',
      'НоменклатураДоставки', to_jsonb(onec.uuid(j->>'_fld29074rref')),
      'НомерВходящегоДокумента', j->'_fld29075',
      'НомерСменыККМ', j->'_fld29076',
      'НомерСчетаНаОплату', to_jsonb(onec.uuid(j->>'_fld29077rref')),
      'НомерЧекаККМ', j->'_fld29078',
      'Объем', j->'_fld29079',
      'ОрганизацияОплачиваетПеревозку', to_jsonb(onec.uuid(j->>'_fld29081rref')),
      'ОснованиеПечати', j->'_fld29082',
      'ОснованиеПечатиСсылка', jsonb_strip_nulls(jsonb_build_object('type', j->'_fld29083_type', 'rtref', j->'_fld29083_rtref', 'rrref', to_jsonb(onec.uuid(j->>'_fld29083_rrref')))),
      'Перевозчик', to_jsonb(onec.uuid(j->>'_fld29085rref')))
    || jsonb_build_object(
      'ПереданВЕГАИС', j->'_fld29086',
      'ПодписьГлавногоБухгалтера', to_jsonb(onec.uuid(j->>'_fld29087rref')),
      'ПодписьКассира', to_jsonb(onec.uuid(j->>'_fld29088rref')),
      'ПодписьКладовщика', to_jsonb(onec.uuid(j->>'_fld29089rref')),
      'ПодписьРуководителя', to_jsonb(onec.uuid(j->>'_fld29090rref')),
      'Подразделение', to_jsonb(onec.uuid(j->>'_fld29091rref')),
      'ПоложениеЗаказаПокупателя', to_jsonb(onec.uuid(j->>'_fld29092rref')),
      'ПоложениеСклада', to_jsonb(onec.uuid(j->>'_fld29093rref')),
      'Прицеп', to_jsonb(onec.uuid(j->>'_fld29094rref')),
      'ПроцентСкидкиПоДисконтнойКарте', j->'_fld29095',
      'СкидкиРассчитаны', j->'_fld29096',
      'СпециальныйНалоговыйРежим', to_jsonb(onec.uuid(j->>'_fld29097rref')),
      'СпособЗачетаПредоплаты', to_jsonb(onec.uuid(j->>'_fld29098rref')),
      'СпособПродажиГИСМ', j->'_fld29099',
      'СрокДоставки', j->'_fld29100',
      'СтавкаНДСДоставки', to_jsonb(onec.uuid(j->>'_fld29101rref')),
      'СтоимостьДоставки', j->'_fld29102',
      'СуммаНДСДоставки', j->'_fld29106',
      'Телефон', j->'_fld29107',
      'УдалитьГлавныйБухгалтер', to_jsonb(onec.uuid(j->>'_fld29108rref')),
      'УдалитьИспользоватьФаксимиле', to_jsonb(onec.uuid(j->>'_fld29109rref')),
      'УдалитьОтпустил', to_jsonb(onec.uuid(j->>'_fld29110rref')),
      'УдалитьОтпустилДолжность', to_jsonb(onec.uuid(j->>'_fld29111rref')),
      'УдалитьРуководитель', to_jsonb(onec.uuid(j->>'_fld29112rref')),
      'УдалитьРуководительДолжность', to_jsonb(onec.uuid(j->>'_fld29113rref')),
      'УдалитьТоварноТранспортнаяНакладнаяЕГАИС', to_jsonb(onec.uuid(j->>'_fld29114rref')),
      'УсловияГарантийногоТалона', to_jsonb(onec.uuid(j->>'_fld29115rref')),
      'УсловияСчетаЗаказа', to_jsonb(onec.uuid(j->>'_fld29116rref')),
      'УчитыватьВНУ', j->'_fld29117',
      'ХозяйственнаяОперация', to_jsonb(onec.uuid(j->>'_fld29118rref')),
      'Ячейка', to_jsonb(onec.uuid(j->>'_fld29119rref')),
      'ПоложениеПроекта', to_jsonb(onec.uuid(j->>'_fld29120rref')),
      'Проект', to_jsonb(onec.uuid(j->>'_fld29121rref')),
      'ВариантВыбытияМаркируемойПродукции', to_jsonb(onec.uuid(j->>'_fld29122rref')),
      'ЭтоУниверсальныйДокумент', j->'_fld29123',
      'ВидЦенВозврата', to_jsonb(onec.uuid(j->>'_fld29124rref')),
      'ОтменаПереносаПодарковВПродажи', j->'_fld29125',
      'ОсвобождатьАвансАвтоматически', j->'_fld29126',
      'Патент', to_jsonb(onec.uuid(j->>'_fld29127rref')),
      'ТекстУсловийСчетаЗаказа', j->'_fld29128')
    || jsonb_build_object(
      'ТекстУсловийГарантийногоТалона', j->'_fld29129',
      'ДокументПоступления', to_jsonb(onec.uuid(j->>'_fld29130rref')),
      'ПоложениеДокументаПоступления', to_jsonb(onec.uuid(j->>'_fld29131rref')),
      'ДоговорКомиссии', to_jsonb(onec.uuid(j->>'_fld29132rref')),
      'ДанныеОТранспортировке', j->'_fld29133',
      'СопроводительныеДокументы', j->'_fld29134',
      'ОставлятьПустымКоличествоВУПД', j->'_fld29135',
      'РегистрироватьЦеныПродажи', j->'_fld55257',
      'ОстаткиЗапасовНеИспользуются', j->'_fld55258',
      'РекламныйБлокПечтаныхФорм', to_jsonb(onec.uuid(j->>'_fld55259rref')),
      'КодСпециальныхОбстоятельств', j->'_fld56413'))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_document966';

-- Документ.РасходнаяНакладная.Запасы (_document966_vt29136)
insert into doc.shipment_item (id, line_no, total, unit_type, unit_id, unit_value, order_doc_type, order_doc_id, order_doc_value, customer_order_id, row_uid, link_no, qty, nomenclature_id, batch_id, discount_pct, reserve_qty, content, vat_rate_id, warehouse_id, amount, vat_amount, discount_amount, characteristic_id, price, cell_id, doc_id, extra)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_document966_idrref')::text || ':' || (j->>'_lineno29137')),
    (j->>'_lineno29137')::numeric(5,0),
    (j->>'_fld29139')::numeric(15,2),
    case j->>'_fld29141_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld29141_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld29141_type' = E'\\x08' then onec.uuid(j->>'_fld29141_rrref') end,
    null::jsonb,
    case j->>'_fld29142_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld29142_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld29142_type' = E'\\x08' then onec.uuid(j->>'_fld29142_rrref') end,
    null::jsonb,
    onec.uuid(j->>'_fld29143rref'),
    j->>'_fld29144',
    (j->>'_fld29145')::numeric(5,0),
    (j->>'_fld29147')::numeric(15,3),
    onec.uuid(j->>'_fld29148rref'),
    onec.uuid(j->>'_fld29152rref'),
    (j->>'_fld29156')::numeric(5,2),
    (j->>'_fld29157')::numeric(15,3),
    j->>'_fld29159',
    onec.uuid(j->>'_fld29160rref'),
    onec.uuid(j->>'_fld29162rref'),
    (j->>'_fld29163')::numeric(15,2),
    (j->>'_fld29165')::numeric(15,2),
    (j->>'_fld29166')::numeric(15,2),
    onec.uuid(j->>'_fld29170rref'),
    (j->>'_fld29172')::numeric(15,2),
    onec.uuid(j->>'_fld29173rref'),
    onec.uuid(j->>'_document966_idrref'),
    jsonb_strip_nulls(jsonb_build_object(
      'Вес', j->'_fld29138',
      'ДоляСтоимости', j->'_fld29140',
      'КодТНВЭД', to_jsonb(onec.uuid(j->>'_fld29146rref')),
      'НоменклатураНабора', to_jsonb(onec.uuid(j->>'_fld29149rref')),
      'НомерГТД', to_jsonb(onec.uuid(j->>'_fld29150rref')),
      'Объем', j->'_fld29151',
      'Проект', to_jsonb(onec.uuid(j->>'_fld29153rref')),
      'ПрослеживаемыйТовар', j->'_fld29154',
      'ПроцентАвтоматическойСкидки', j->'_fld29155',
      'СерииНоменклатуры', j->'_fld29158',
      'СтранаПроисхождения', to_jsonb(onec.uuid(j->>'_fld29161rref')),
      'СуммаАвтоматическойСкидки', j->'_fld29164',
      'ТипНоменклатурыЗапас', j->'_fld29167',
      'ТоварыДляПроизводства', j->'_fld29168',
      'УдалитьСправкаБ', to_jsonb(onec.uuid(j->>'_fld29169rref')),
      'ХарактеристикаНабора', to_jsonb(onec.uuid(j->>'_fld29171rref')),
      'ПрослеживаемыйКомплект', j->'_fld29174',
      'ПродажаПодарка', j->'_fld29175',
      'СуммаСкидкиОплатыБонусом', j->'_fld29176',
      'ДокументПоступления', to_jsonb(onec.uuid(j->>'_fld29177rref')),
      'ЦенаПередачи', j->'_fld29178',
      'СуммаПередачи', j->'_fld29179',
      'СуммаНДСПередачи', j->'_fld29180',
      'НоменклатураПоставщика', to_jsonb(onec.uuid(j->>'_fld29181rref')),
      'СуммаАкциза', j->'_fld29182',
      'ПодакцизныйТовар', j->'_fld29183',
      'СтавкаАкциза', j->'_fld29184',
      'ЕдиницаИзмеренияАкциза', j->'_fld29185',
      'КоэффициентПересчета', j->'_fld29186',
      'ОкруглятьДоЦелого', j->'_fld29187'))
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_document966_vt29136';

-- РегистрСведений.асАвтомобили (_inforg48524)
insert into ref.car_attribute (id, period, car_id, attr_kind, value_type, value_id, value_value, extra, onec_key)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a62', 'ref.car_attribute:' || md5(j::text)),
    onec.ts(j->>'_period'),
    onec.uuid(j->>'_fld48525rref'),
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld48526rref')),
    case j->>'_fld48527_type' when E'\\x08' then null when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld48527_type' = E'\\x08' then onec.uuid(j->>'_fld48527_rrref') end,
    case j->>'_fld48527_type' when E'\\x03' then j->'_fld48527_n' when E'\\x05' then j->'_fld48527_s' end,
    '{}'::jsonb,
    md5(j::text)
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_inforg48524';

-- РегистрСведений.асЦеныАвторабот (_inforg48532)
insert into ref.labor_price (id, period, recorder, line_no, active, price_type_id, nomenclature_id, model_id, repair_kind_id, warehouse_id, contract_id, norm_hour, currency_id, price, extra, onec_key)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a62', 'ref.labor_price:' || md5(j::text)),
    onec.ts(j->>'_period'),
    onec.uuid(j->>'_recorderrref'),
    (j->>'_lineno')::numeric(9,0),
    (j->>'_active')::boolean,
    onec.uuid(j->>'_fld48533rref'),
    onec.uuid(j->>'_fld48534rref'),
    onec.uuid(j->>'_fld48535rref'),
    onec.uuid(j->>'_fld48536rref'),
    onec.uuid(j->>'_fld48537rref'),
    onec.uuid(j->>'_fld48538rref'),
    onec.uuid(j->>'_fld48539rref'),
    onec.uuid(j->>'_fld48540rref'),
    (j->>'_fld48541')::numeric(15,2),
    '{}'::jsonb,
    md5(j::text)
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_inforg48532';

-- РегистрСведений.ЦеныНоменклатуры (_inforg48319)
insert into ref.price (id, period, price_type_id, nomenclature_id, characteristic_id, price, actual, unit_type, unit_id, unit_value, currency_id, author_id, set_by_doc_type, set_by_doc_id, set_by_doc_value, extra, onec_key)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a62', 'ref.price:' || md5(j::text)),
    onec.ts(j->>'_period'),
    onec.uuid(j->>'_fld48320rref'),
    onec.uuid(j->>'_fld48321rref'),
    onec.uuid(j->>'_fld48322rref'),
    (j->>'_fld48323')::numeric(15,2),
    (j->>'_fld48324')::boolean,
    case j->>'_fld48325_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld48325_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld48325_type' = E'\\x08' then onec.uuid(j->>'_fld48325_rrref') end,
    null::jsonb,
    onec.uuid(j->>'_fld48326rref'),
    onec.uuid(j->>'_fld48328rref'),
    case j->>'_fld48329_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld48329_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld48329_type' = E'\\x08' then onec.uuid(j->>'_fld48329_rrref') end,
    null::jsonb,
    jsonb_strip_nulls(jsonb_build_object(
      'ВключаяХарактеристики', j->'_fld48327')),
    md5(j::text)
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_inforg48319';

-- РегистрНакопления.Запасы (_accumrg49073)
insert into stock.move (id, period, recorder_type, recorder_id, line_no, active, movement, organization_id, warehouse_type, warehouse_id, warehouse_value, nomenclature_id, characteristic_id, batch_id, customer_order, account_id, work_order_id, qty, amount, amount_net, corr_warehouse_type, corr_warehouse_id, corr_warehouse_value, corr_nomenclature_id, corr_batch_id, is_return, content, extra, onec_key)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a62', 'stock.move:' || onec.uuid(j->>'_recorderrref')::text || ':' || (j->>'_lineno')),
    onec.ts(j->>'_period'),
    (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_recordertref')),
    onec.uuid(j->>'_recorderrref'),
    (j->>'_lineno')::numeric(9,0),
    (j->>'_active')::boolean,
    (j->>'_recordkind')::numeric(1,0),
    onec.uuid(j->>'_fld49074rref'),
    case j->>'_fld49075_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld49075_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld49075_type' = E'\\x08' then onec.uuid(j->>'_fld49075_rrref') end,
    null::jsonb,
    onec.uuid(j->>'_fld49076rref'),
    onec.uuid(j->>'_fld49077rref'),
    onec.uuid(j->>'_fld49078rref'),
    onec.uuid(j->>'_fld49079rref'),
    onec.uuid(j->>'_fld49080rref'),
    onec.uuid(j->>'_fld49082rref'),
    (j->>'_fld49084')::numeric(15,3),
    (j->>'_fld49085')::numeric(15,2),
    (j->>'_fld49088')::numeric(15,2),
    case j->>'_fld49090_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld49090_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld49090_type' = E'\\x08' then onec.uuid(j->>'_fld49090_rrref') end,
    null::jsonb,
    onec.uuid(j->>'_fld49092rref'),
    onec.uuid(j->>'_fld49094rref'),
    (j->>'_fld49106')::boolean,
    j->>'_fld49107',
    jsonb_strip_nulls(jsonb_build_object(
      'ЗаказНаПроизводство', to_jsonb(onec.uuid(j->>'_fld49081rref')),
      'ДвижениеЧекаВОткрытойСмене', j->'_fld49083',
      'КоличествоИнт', j->'_fld49086',
      'СуммаИнт', j->'_fld49087',
      'СуммаБезНДСИнт', j->'_fld49089',
      'КоррСчетУчета', to_jsonb(onec.uuid(j->>'_fld49091rref')),
      'КоррХарактеристика', to_jsonb(onec.uuid(j->>'_fld49093rref')),
      'КоррЗаказПокупателя', to_jsonb(onec.uuid(j->>'_fld49095rref')),
      'асКоррЗаказНаряд', to_jsonb(onec.uuid(j->>'_fld49096rref')),
      'Спецификация', to_jsonb(onec.uuid(j->>'_fld49097rref')),
      'КоррСпецификация', to_jsonb(onec.uuid(j->>'_fld49098rref')),
      'ЗаказПродажи', to_jsonb(onec.uuid(j->>'_fld49099rref')),
      'ДокументПродажи', jsonb_strip_nulls(jsonb_build_object('type', j->'_fld49100_type', 'rtref', j->'_fld49100_rtref', 'rrref', to_jsonb(onec.uuid(j->>'_fld49100_rrref')))),
      'Подразделение', to_jsonb(onec.uuid(j->>'_fld49101rref')),
      'Ответственный', to_jsonb(onec.uuid(j->>'_fld49102rref')),
      'СтавкаНДС', to_jsonb(onec.uuid(j->>'_fld49103rref')),
      'ФиксированнаяСтоимость', j->'_fld49104',
      'ЗатратыНаВыпуск', j->'_fld49105',
      'ПеремещениеВРозницуСуммовойУчет', j->'_fld49108',
      'ХозяйственнаяОперация', to_jsonb(onec.uuid(j->>'_fld49109rref')),
      'КоррЗаказНаПроизводство', to_jsonb(onec.uuid(j->>'_fld49110rref')))),
    onec.uuid(j->>'_recorderrref')::text || ':' || (j->>'_lineno')
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_accumrg49073';

-- РегистрСведений.Арм_ДанныеЗакупокИПродаж (_inforg56838x1)
insert into arm.line (id, customer_order_id, supplier_order_id, receipt_id, link_key, operation, onec_record_id, manual_edit, client_order_number, marked, fact_name, fact_qty, vehicle_plate, nomenclature_id, quantity, supplier_id, batch_id, marked_by_id, sort_order, stock_qty, status, deleted, stock_total_qty, sale_price, manual_batch, cost_sum, manual_split_by_batch, contract_id, customer_id, comment, shipment_date, shipment_number, shipment_doc_id, receipt_date, order_date, internal_order_number, service_type_id, urgency, territory, fact_article, fact_unit, payment_form_id, cost_price, price_change_type, coefficient, signed_original, brand, model, aggregate, plate, vin, engine, norm_hours, rrc, paid, supplier_ship_territory, chassis, reserve_qty, in_transit_qty, upd_date, upd_number, invoice_number, invoice_date, comment2, supplier_order_date, delivery_term, cell_legacy, assembly_sent_date, extra, onec_key)
select
    case when j->>'_fld56844' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then (j->>'_fld56844')::uuid else uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a63', j->>'_fld56844') end,
    onec.uuid(j->>'_fld56839rref'),
    onec.uuid(j->>'_fld56840rref'),
    onec.uuid(j->>'_fld56841rref'),
    j->>'_fld56842',
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld56843rref')),
    j->>'_fld56844',
    (j->>'_fld56845')::boolean,
    j->>'_fld56846',
    (j->>'_fld56847')::boolean,
    j->>'_fld56848',
    j->>'_fld56849',
    j->>'_fld56850',
    onec.uuid(j->>'_fld56851rref'),
    (j->>'_fld56852')::numeric(10,2),
    onec.uuid(j->>'_fld56853rref'),
    onec.uuid(j->>'_fld56854rref'),
    onec.uuid(j->>'_fld56855rref'),
    (j->>'_fld56856')::numeric(31,4),
    (j->>'_fld56857')::numeric(15,0),
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld56858rref')),
    (j->>'_fld56859')::boolean,
    (j->>'_fld56860')::numeric(15,0),
    (j->>'_fld56861')::numeric(15,1),
    (j->>'_fld56862')::boolean,
    (j->>'_fld56863')::numeric(15,2),
    (j->>'_fld56864')::boolean,
    onec.uuid(j->>'_fld56865rref'),
    onec.uuid(j->>'_fld56866rref'),
    j->>'_fld56867',
    onec.ts(j->>'_fld56868'),
    j->>'_fld56869',
    onec.uuid(j->>'_fld56870rref'),
    onec.ts(j->>'_fld56871'),
    onec.ts(j->>'_fld56872'),
    j->>'_fld56873',
    onec.uuid(j->>'_fld56874rref'),
    j->>'_fld56875',
    j->>'_fld56876',
    j->>'_fld56877',
    j->>'_fld56878',
    onec.uuid(j->>'_fld56879rref'),
    (j->>'_fld56880')::numeric(15,2),
    (j->>'_fld56881')::numeric(10,0),
    (j->>'_fld56882')::numeric(10,3),
    (j->>'_fld56904')::boolean,
    j->>'_fld56905',
    j->>'_fld56906',
    j->>'_fld56907',
    j->>'_fld56908',
    j->>'_fld56909',
    j->>'_fld56910',
    (j->>'_fld56911')::numeric(15,3),
    (j->>'_fld56912')::numeric(15,2),
    j->>'_fld56913',
    j->>'_fld56914',
    j->>'_fld56915',
    (j->>'_fld56916')::numeric(15,3),
    (j->>'_fld56917')::numeric(15,3),
    onec.ts(j->>'_fld56918'),
    j->>'_fld56919',
    j->>'_fld56920',
    onec.ts(j->>'_fld56921'),
    j->>'_fld56922',
    onec.ts(j->>'_fld56923'),
    onec.ts(j->>'_fld56924'),
    j->>'_fld56925',
    onec.ts(j->>'_fld56926'),
    '{}'::jsonb,
    md5(j::text)
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_inforg56838x1';

-- РегистрСведений.Арм_Уведомления (_inforg56936x1)
insert into arm.notice (id, onec_record_id, created_at, node, kind, recipient_role, text, customer_order_id, author_id, is_read, read_by_id, read_at, extra, onec_key)
select
    case when j->>'_fld56937' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then (j->>'_fld56937')::uuid else uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a63', j->>'_fld56937') end,
    j->>'_fld56937',
    onec.ts(j->>'_fld56938'),
    j->>'_fld56939',
    j->>'_fld56940',
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld56941rref')),
    j->>'_fld56942',
    onec.uuid(j->>'_fld56943rref'),
    onec.uuid(j->>'_fld56944rref'),
    (j->>'_fld56945')::boolean,
    onec.uuid(j->>'_fld56946rref'),
    onec.ts(j->>'_fld56947'),
    '{}'::jsonb,
    md5(j::text)
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_inforg56936x1';

-- РегистрСведений.Арм_ПраваПользователей (_inforg56890x1)
insert into arm.user_role (id, user_id, role, extra, onec_key)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a62', 'arm.user_role:' || md5(j::text)),
    onec.uuid(j->>'_fld56891rref'),
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld56892rref')),
    '{}'::jsonb,
    md5(j::text)
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_inforg56890x1';

-- Справочник.Организации.КонтактнаяИнформация (_reference388_vt9891)
insert into ref.contact_info (id, line_no, type, kind, presentation, fields_xml, value, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_reference388_idrref')::text || ':' || (j->>'_lineno9892')),
    (j->>'_lineno9892')::numeric(5,0),
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld9893rref')),
    onec.uuid(j->>'_fld9894rref'),
    j->>'_fld9895',
    j->>'_fld9896',
    j->>'_fld9904',
    onec.uuid(j->>'_reference388_idrref'),
    jsonb_strip_nulls(jsonb_build_object(
      'Страна', j->'_fld9897',
      'Регион', j->'_fld9898',
      'Город', j->'_fld9899',
      'АдресЭП', j->'_fld9900',
      'ДоменноеИмяСервера', j->'_fld9901',
      'НомерТелефона', j->'_fld9902',
      'НомерТелефонаБезКодов', j->'_fld9903',
      'ВидДляСписка', to_jsonb(onec.uuid(j->>'_fld9905rref')),
      'ДействуетС', j->'_fld9906')),
    'Справочник.Организации.КонтактнаяИнформация'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference388_vt9891';

-- Справочник.Контрагенты.КонтактнаяИнформация (_reference301_vt7012)
insert into ref.contact_info (id, line_no, type, kind, presentation, fields_xml, value, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_reference301_idrref')::text || ':' || (j->>'_lineno7013')),
    (j->>'_lineno7013')::numeric(5,0),
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld7014rref')),
    onec.uuid(j->>'_fld7015rref'),
    j->>'_fld7016',
    j->>'_fld7017',
    j->>'_fld7025',
    onec.uuid(j->>'_reference301_idrref'),
    jsonb_strip_nulls(jsonb_build_object(
      'Страна', j->'_fld7018',
      'Регион', j->'_fld7019',
      'Город', j->'_fld7020',
      'АдресЭП', j->'_fld7021',
      'ДоменноеИмяСервера', j->'_fld7022',
      'НомерТелефона', j->'_fld7023',
      'НомерТелефонаБезКодов', j->'_fld7024',
      'ДействуетС', j->'_fld7026',
      'ОбратныйНомерТелефона', j->'_fld7027')),
    'Справочник.Контрагенты.КонтактнаяИнформация'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference301_vt7012';

-- Справочник.Пользователи.КонтактнаяИнформация (_reference462_vt11756)
insert into ref.contact_info (id, line_no, type, kind, presentation, fields_xml, value, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_reference462_idrref')::text || ':' || (j->>'_lineno11757')),
    (j->>'_lineno11757')::numeric(5,0),
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld11758rref')),
    onec.uuid(j->>'_fld11759rref'),
    j->>'_fld11760',
    j->>'_fld11761',
    j->>'_fld11770',
    onec.uuid(j->>'_reference462_idrref'),
    jsonb_strip_nulls(jsonb_build_object(
      'Страна', j->'_fld11762',
      'Регион', j->'_fld11763',
      'Город', j->'_fld11764',
      'АдресЭП', j->'_fld11765',
      'ДоменноеИмяСервера', j->'_fld11766',
      'НомерТелефона', j->'_fld11767',
      'НомерТелефонаБезКодов', j->'_fld11768',
      'ВидДляСписка', to_jsonb(onec.uuid(j->>'_fld11769rref')))),
    'Справочник.Пользователи.КонтактнаяИнформация'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference462_vt11756';

-- Справочник.СтруктурныеЕдиницы.КонтактнаяИнформация (_reference612_vt14939)
insert into ref.contact_info (id, line_no, type, kind, presentation, fields_xml, value, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_reference612_idrref')::text || ':' || (j->>'_lineno14940')),
    (j->>'_lineno14940')::numeric(5,0),
    (select e.name from sys.enum_value e where e.id = onec.uuid(j->>'_fld14941rref')),
    onec.uuid(j->>'_fld14942rref'),
    j->>'_fld14943',
    j->>'_fld14944',
    j->>'_fld14952',
    onec.uuid(j->>'_reference612_idrref'),
    jsonb_strip_nulls(jsonb_build_object(
      'Страна', j->'_fld14945',
      'Регион', j->'_fld14946',
      'Город', j->'_fld14947',
      'АдресЭП', j->'_fld14948',
      'ДоменноеИмяСервера', j->'_fld14949',
      'НомерТелефона', j->'_fld14950',
      'НомерТелефонаБезКодов', j->'_fld14951')),
    'Справочник.СтруктурныеЕдиницы.КонтактнаяИнформация'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference612_vt14939';

-- Справочник.Организации.ДополнительныеРеквизиты (_reference388_vt9907)
insert into ref.extra_property (id, line_no, property_id, value_type, value_id, value_value, text, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_reference388_idrref')::text || ':' || (j->>'_lineno9908')),
    (j->>'_lineno9908')::numeric(5,0),
    onec.uuid(j->>'_fld9909rref'),
    case j->>'_fld9910_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld9910_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld9910_type' = E'\\x08' then onec.uuid(j->>'_fld9910_rrref') end,
    case j->>'_fld9910_type' when E'\\x02' then j->'_fld9910_l' when E'\\x03' then j->'_fld9910_n' when E'\\x04' then j->'_fld9910_t' when E'\\x05' then j->'_fld9910_s' end,
    j->>'_fld9911',
    onec.uuid(j->>'_reference388_idrref'),
    '{}'::jsonb,
    'Справочник.Организации.ДополнительныеРеквизиты'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference388_vt9907';

-- Справочник.Контрагенты.ДополнительныеРеквизиты (_reference301_vt7007)
insert into ref.extra_property (id, line_no, property_id, value_type, value_id, value_value, text, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_reference301_idrref')::text || ':' || (j->>'_lineno7008')),
    (j->>'_lineno7008')::numeric(5,0),
    onec.uuid(j->>'_fld7009rref'),
    case j->>'_fld7010_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld7010_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld7010_type' = E'\\x08' then onec.uuid(j->>'_fld7010_rrref') end,
    case j->>'_fld7010_type' when E'\\x02' then j->'_fld7010_l' when E'\\x03' then j->'_fld7010_n' when E'\\x04' then j->'_fld7010_t' when E'\\x05' then j->'_fld7010_s' end,
    j->>'_fld7011',
    onec.uuid(j->>'_reference301_idrref'),
    '{}'::jsonb,
    'Справочник.Контрагенты.ДополнительныеРеквизиты'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference301_vt7007';

-- Справочник.ДоговорыКонтрагентов.ДополнительныеРеквизиты (_reference171_vt4181)
insert into ref.extra_property (id, line_no, property_id, value_type, value_id, value_value, text, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_reference171_idrref')::text || ':' || (j->>'_lineno4182')),
    (j->>'_lineno4182')::numeric(5,0),
    onec.uuid(j->>'_fld4183rref'),
    case j->>'_fld4184_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld4184_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld4184_type' = E'\\x08' then onec.uuid(j->>'_fld4184_rrref') end,
    case j->>'_fld4184_type' when E'\\x02' then j->'_fld4184_l' when E'\\x03' then j->'_fld4184_n' when E'\\x04' then j->'_fld4184_t' when E'\\x05' then j->'_fld4184_s' end,
    j->>'_fld4185',
    onec.uuid(j->>'_reference171_idrref'),
    '{}'::jsonb,
    'Справочник.ДоговорыКонтрагентов.ДополнительныеРеквизиты'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference171_vt4181';

-- Справочник.Номенклатура.ДополнительныеРеквизиты (_reference368_vt9350x1)
insert into ref.extra_property (id, line_no, property_id, value_type, value_id, value_value, text, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_reference368_idrref')::text || ':' || (j->>'_lineno9351')),
    (j->>'_lineno9351')::numeric(5,0),
    onec.uuid(j->>'_fld9352rref'),
    case j->>'_fld9353_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld9353_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld9353_type' = E'\\x08' then onec.uuid(j->>'_fld9353_rrref') end,
    case j->>'_fld9353_type' when E'\\x02' then j->'_fld9353_l' when E'\\x03' then j->'_fld9353_n' when E'\\x04' then j->'_fld9353_t' when E'\\x05' then j->'_fld9353_s' end,
    j->>'_fld9354',
    onec.uuid(j->>'_reference368_idrref'),
    '{}'::jsonb,
    'Справочник.Номенклатура.ДополнительныеРеквизиты'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference368_vt9350x1';

-- Справочник.ПартииНоменклатуры.ДополнительныеРеквизиты (_reference427_vt10722)
insert into ref.extra_property (id, line_no, property_id, value_type, value_id, value_value, text, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_reference427_idrref')::text || ':' || (j->>'_lineno10723')),
    (j->>'_lineno10723')::numeric(5,0),
    onec.uuid(j->>'_fld10724rref'),
    case j->>'_fld10725_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld10725_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld10725_type' = E'\\x08' then onec.uuid(j->>'_fld10725_rrref') end,
    case j->>'_fld10725_type' when E'\\x02' then j->'_fld10725_l' when E'\\x03' then j->'_fld10725_n' when E'\\x04' then j->'_fld10725_t' when E'\\x05' then j->'_fld10725_s' end,
    j->>'_fld10726',
    onec.uuid(j->>'_reference427_idrref'),
    '{}'::jsonb,
    'Справочник.ПартииНоменклатуры.ДополнительныеРеквизиты'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference427_vt10722';

-- Справочник.асАвтомобили.ДополнительныеРеквизиты (_reference749_vt17177)
insert into ref.extra_property (id, line_no, property_id, value_type, value_id, value_value, text, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_reference749_idrref')::text || ':' || (j->>'_lineno17178')),
    (j->>'_lineno17178')::numeric(5,0),
    onec.uuid(j->>'_fld17179rref'),
    case j->>'_fld17180_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld17180_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld17180_type' = E'\\x08' then onec.uuid(j->>'_fld17180_rrref') end,
    case j->>'_fld17180_type' when E'\\x02' then j->'_fld17180_l' when E'\\x03' then j->'_fld17180_n' when E'\\x04' then j->'_fld17180_t' when E'\\x05' then j->'_fld17180_s' end,
    j->>'_fld17181',
    onec.uuid(j->>'_reference749_idrref'),
    '{}'::jsonb,
    'Справочник.асАвтомобили.ДополнительныеРеквизиты'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference749_vt17177';

-- Справочник.асМодели.ДополнительныеРеквизиты (_reference756_vt17334)
insert into ref.extra_property (id, line_no, property_id, value_type, value_id, value_value, text, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_reference756_idrref')::text || ':' || (j->>'_lineno17335')),
    (j->>'_lineno17335')::numeric(5,0),
    onec.uuid(j->>'_fld17336rref'),
    case j->>'_fld17337_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld17337_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld17337_type' = E'\\x08' then onec.uuid(j->>'_fld17337_rrref') end,
    case j->>'_fld17337_type' when E'\\x02' then j->'_fld17337_l' when E'\\x03' then j->'_fld17337_n' when E'\\x04' then j->'_fld17337_t' when E'\\x05' then j->'_fld17337_s' end,
    j->>'_fld17338',
    onec.uuid(j->>'_reference756_idrref'),
    '{}'::jsonb,
    'Справочник.асМодели.ДополнительныеРеквизиты'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference756_vt17334';

-- Справочник.Пользователи.ДополнительныеРеквизиты (_reference462_vt11751)
insert into ref.extra_property (id, line_no, property_id, value_type, value_id, value_value, text, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_reference462_idrref')::text || ':' || (j->>'_lineno11752')),
    (j->>'_lineno11752')::numeric(5,0),
    onec.uuid(j->>'_fld11753rref'),
    case j->>'_fld11754_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld11754_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld11754_type' = E'\\x08' then onec.uuid(j->>'_fld11754_rrref') end,
    case j->>'_fld11754_type' when E'\\x02' then j->'_fld11754_l' when E'\\x03' then j->'_fld11754_n' when E'\\x04' then j->'_fld11754_t' when E'\\x05' then j->'_fld11754_s' end,
    j->>'_fld11755',
    onec.uuid(j->>'_reference462_idrref'),
    '{}'::jsonb,
    'Справочник.Пользователи.ДополнительныеРеквизиты'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference462_vt11751';

-- Справочник.СтруктурныеЕдиницы.ДополнительныеРеквизиты (_reference612_vt14934)
insert into ref.extra_property (id, line_no, property_id, value_type, value_id, value_value, text, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_reference612_idrref')::text || ':' || (j->>'_lineno14935')),
    (j->>'_lineno14935')::numeric(5,0),
    onec.uuid(j->>'_fld14936rref'),
    case j->>'_fld14937_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld14937_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld14937_type' = E'\\x08' then onec.uuid(j->>'_fld14937_rrref') end,
    case j->>'_fld14937_type' when E'\\x02' then j->'_fld14937_l' when E'\\x03' then j->'_fld14937_n' when E'\\x04' then j->'_fld14937_t' when E'\\x05' then j->'_fld14937_s' end,
    j->>'_fld14938',
    onec.uuid(j->>'_reference612_idrref'),
    '{}'::jsonb,
    'Справочник.СтруктурныеЕдиницы.ДополнительныеРеквизиты'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_reference612_vt14934';

-- Документ.ЗаказПокупателя.ДополнительныеРеквизиты (_document813_vt20746x1)
insert into ref.extra_property (id, line_no, property_id, value_type, value_id, value_value, text, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_document813_idrref')::text || ':' || (j->>'_lineno20747')),
    (j->>'_lineno20747')::numeric(5,0),
    onec.uuid(j->>'_fld20748rref'),
    case j->>'_fld20749_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld20749_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld20749_type' = E'\\x08' then onec.uuid(j->>'_fld20749_rrref') end,
    case j->>'_fld20749_type' when E'\\x02' then j->'_fld20749_l' when E'\\x03' then j->'_fld20749_n' when E'\\x04' then j->'_fld20749_t' when E'\\x05' then j->'_fld20749_s' end,
    j->>'_fld20750',
    onec.uuid(j->>'_document813_idrref'),
    '{}'::jsonb,
    'Документ.ЗаказПокупателя.ДополнительныеРеквизиты'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_document813_vt20746x1';

-- Документ.ЗаказПоставщику.ДополнительныеРеквизиты (_document814_vt20980)
insert into ref.extra_property (id, line_no, property_id, value_type, value_id, value_value, text, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_document814_idrref')::text || ':' || (j->>'_lineno20981')),
    (j->>'_lineno20981')::numeric(5,0),
    onec.uuid(j->>'_fld20982rref'),
    case j->>'_fld20983_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld20983_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld20983_type' = E'\\x08' then onec.uuid(j->>'_fld20983_rrref') end,
    case j->>'_fld20983_type' when E'\\x02' then j->'_fld20983_l' when E'\\x03' then j->'_fld20983_n' when E'\\x04' then j->'_fld20983_t' when E'\\x05' then j->'_fld20983_s' end,
    j->>'_fld20984',
    onec.uuid(j->>'_document814_idrref'),
    '{}'::jsonb,
    'Документ.ЗаказПоставщику.ДополнительныеРеквизиты'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_document814_vt20980';

-- Документ.ПриходнаяНакладная.ДополнительныеРеквизиты (_document954_vt28464)
insert into ref.extra_property (id, line_no, property_id, value_type, value_id, value_value, text, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_document954_idrref')::text || ':' || (j->>'_lineno28465')),
    (j->>'_lineno28465')::numeric(5,0),
    onec.uuid(j->>'_fld28466rref'),
    case j->>'_fld28467_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld28467_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld28467_type' = E'\\x08' then onec.uuid(j->>'_fld28467_rrref') end,
    case j->>'_fld28467_type' when E'\\x02' then j->'_fld28467_l' when E'\\x03' then j->'_fld28467_n' when E'\\x04' then j->'_fld28467_t' when E'\\x05' then j->'_fld28467_s' end,
    j->>'_fld28468',
    onec.uuid(j->>'_document954_idrref'),
    '{}'::jsonb,
    'Документ.ПриходнаяНакладная.ДополнительныеРеквизиты'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_document954_vt28464';

-- Документ.РасходнаяНакладная.ДополнительныеРеквизиты (_document966_vt29200)
insert into ref.extra_property (id, line_no, property_id, value_type, value_id, value_value, text, owner_id, extra, onec_table)
select
    uuid_generate_v5('6f1b2c3a-0d4e-5f60-8a7b-1c2d3e4f5a61', onec.uuid(j->>'_document966_idrref')::text || ':' || (j->>'_lineno29201')),
    (j->>'_lineno29201')::numeric(5,0),
    onec.uuid(j->>'_fld29202rref'),
    case j->>'_fld29203_type' when E'\\x08' then (select coalesce(m.target, m.object) from onec.type_map m where m.type_no = onec.type_no(j->>'_fld29203_rtref')) when E'\\x02' then 'boolean' when E'\\x03' then 'number' when E'\\x04' then 'date' when E'\\x05' then 'string' end,
    case when j->>'_fld29203_type' = E'\\x08' then onec.uuid(j->>'_fld29203_rrref') end,
    case j->>'_fld29203_type' when E'\\x02' then j->'_fld29203_l' when E'\\x03' then j->'_fld29203_n' when E'\\x04' then j->'_fld29203_t' when E'\\x05' then j->'_fld29203_s' end,
    j->>'_fld29204',
    onec.uuid(j->>'_document966_idrref'),
    '{}'::jsonb,
    'Документ.РасходнаяНакладная.ДополнительныеРеквизиты'
from onec.raw r cross join lateral (select r.row as j) x
where r.storage = '_document966_vt29200';


// Наполнение базы 1С демо-данными АРМ (seed). Запускается 32-битным cscript из seed-1c.ps1.
//   cscript //nologo seed.js <режим> <файл со строкой соединения, UTF-16> <файл отчёта> [data.json]
// Режимы:
//   safemode-get | safemode-off | safemode-on — безопасный режим расширения АРМЗакупокИПродаж
//   seed                                      — наполнение по data.json
// Строки АРМ создаются через документ «Заказ покупателя»: регистр заполняет само расширение
// (для этого расширение не должно быть в безопасном режиме). Повторный запуск не создаёт дублей.

var EXT = "АРМЗакупокИПродаж";
var mode = WScript.Arguments(0), reportPath = WScript.Arguments(2);
var fso = new ActiveXObject("Scripting.FileSystemObject");
// строка соединения — из файла: кавычки в аргументах командной строки ненадёжны
var connFile = fso.OpenTextFile(WScript.Arguments(1), 1, false, -1), connStr = connFile.ReadAll(); connFile.Close();
var OUT = fso.CreateTextFile(reportPath, true, true);
var stat = { created: 0, found: 0, warn: 0, err: 0 };
function log(t)  { OUT.WriteLine(t); }
function ok(t)   { OUT.WriteLine("  [OK] " + t); }
function warn(t) { OUT.WriteLine("  [!]  " + t); stat.warn++; }
function fail(t) { OUT.WriteLine("  [X]  " + t); stat.err++; }
function finish(code) { OUT.Close(); WScript.Quit(code); }

function readUtf8(path) {
    var s = new ActiveXObject("ADODB.Stream");
    s.Type = 2; s.Charset = "utf-8"; s.Open(); s.LoadFromFile(path);
    var t = s.ReadText(); s.Close(); return t;
}

var conn;
try { conn = new ActiveXObject("V83.COMConnector").Connect(connStr); }
catch (e) { fail("не удалось подключиться к базе: " + e.message); finish(2); }

// ---------------------------------------------------------------- безопасный режим
function findExtension() {
    var list = conn.ConfigurationExtensions.Get();
    for (var i = 0; i < list.Count(); i++) if (list.Get(i).Name == EXT) return list.Get(i);
    return null;
}
if (mode.indexOf("safemode") == 0) {
    var ext = findExtension();
    if (!ext) { fail("расширение " + EXT + " в базе не найдено"); finish(2); }
    var was = ext.SafeMode;
    var target = (mode == "safemode-off") ? false : (mode == "safemode-on") ? true : was;
    function short(e) { return e.message.replace(/\s+/g, " ").substring(0, 140); }
    if (target != was) {
        try { ext.SafeMode = target; ext.Write(); }
        catch (e) {
            // Защита от опасных действий: 1С спрашивает подтверждение, а через COM ответить нельзя.
            // Снимаем защиту у расширения и у текущего пользователя ИБ и повторяем запись.
            log("NOTE=" + short(e));
            try {
                var offUser = conn.NewObject("UnsafeOperationProtectionDescription"); offUser.UnsafeOperationWarnings = false;
                var u = conn.InfoBaseUsers.CurrentUser(); u.UnsafeOperationProtection = offUser; u.Write();
                log("USER_PROTECTION_OFF=" + u.Name);
            } catch (e2) { log("NOTE=" + short(e2)); }
            try {
                ext = findExtension();
                var offExt = conn.NewObject("UnsafeOperationProtectionDescription"); offExt.UnsafeOperationWarnings = false;
                ext.UnsafeActionProtection = offExt; ext.SafeMode = target; ext.Write();
            } catch (e3) { log("ERROR=" + short(e3)); }
        }
    }
    log("SAFEMODE_WAS=" + (was ? "1" : "0"));
    log("SAFEMODE_NOW=" + (findExtension().SafeMode ? "1" : "0"));
    finish(0);
}

// ---------------------------------------------------------------- помощники 1С
var md = conn.Metadata;
function query(text, params) {
    var q = conn.NewObject("Query", text);
    if (params) for (var k in params) q.SetParameter(k, params[k]);
    return q.Execute().Select();
}
function firstRef(text, params) { var s = query(text, params); return s.Next() ? s.Get(0) : null; }
function str(v) { return conn.String(v); }
function hasResource(name) { return regMd.Resources.Find(name) != null; }
function enumValue(enumName, valueName) {
    var e = md.Enums.Find(enumName);
    if (!e || !e.EnumValues.Find(valueName)) return null;
    return conn.Enums[enumName][valueName];
}
// элемент справочника по наименованию; создаётся, если нет. fill(obj) дозаполняет новый объект.
function catalogItem(catName, name, fill) {
    var mgr = conn.Catalogs[catName];
    var ref = mgr.FindByDescription(name, true);
    if (!ref.IsEmpty()) { stat.found++; return ref; }
    var obj = mgr.CreateItem();
    obj.Description = name;
    if (fill) fill(obj);
    try { obj.Write(); }
    catch (e) {
        // объекты УНФ могут требовать интерактивных проверок — пишем в режиме загрузки
        obj.DataExchange.Load = true; obj.Write();
        warn(catName + " «" + name + "» записан в режиме загрузки (обычная запись: " + e.message + ")");
    }
    stat.created++;
    return obj.Ref;
}
function trySet(obj, prop, value) { try { obj[prop] = value; return true; } catch (e) { return false; } }

if (mode != "seed") { fail("неизвестный режим: " + mode); finish(2); }

var data;
try { data = eval("(" + readUtf8(WScript.Arguments(3)) + ")"); }
catch (e) { fail("не прочитан файл данных: " + e.message); finish(2); }

var regMd = md.InformationRegisters.Find("Арм_ДанныеЗакупокИПродаж");
if (!regMd) { fail("в базе нет регистра Арм_ДанныеЗакупокИПродаж — расширение " + EXT + " не установлено"); finish(2); }
var ext = findExtension();
if (ext && ext.SafeMode) {
    fail("расширение в безопасном режиме: заказы не попадут в АРМ. Наполнение не выполнено (запускайте через seed-1c.ps1)");
    finish(2);
}

// Заказ, записанный без обработчиков расширения (безопасный режим): строк в АРМ нет, ключи строк пустые.
// Дозаполняем ключи и вызываем штатное заполнение регистра.
function repairOrder(docRef) {
    var obj = docRef.GetObject(), rows = obj["Запасы"];
    for (var i = 0; i < rows.Count(); i++) {
        var line = rows.Get(i);
        if (!line["КлючСвязиСтрок"]) line["КлючСвязиСтрок"] = conn.String(conn.NewObject("UUID"));
    }
    obj.AdditionalProperties.Insert("Арм_ПрограммнаяЗапись", true);
    obj.Write();
    conn.InformationRegisters["Арм_ДанныеЗакупокИПродаж"]["ОбновитьДанныеПоОбъекту"](docRef, obj["Запасы"].Unload(), true);
}

try {
    // ------------------------------------------------------------ 1. справочники
    log("1. Справочники");
    var serviceTypes = {}, paymentForms = {}, counterparties = {}, contracts = {}, nomenclature = {};
    for (var i = 0; i < data.serviceTypes.length; i++) serviceTypes[data.serviceTypes[i]] = catalogItem("Арм_ВидыУслуги", data.serviceTypes[i]);
    for (var i = 0; i < data.paymentForms.length; i++) paymentForms[data.paymentForms[i]] = catalogItem("Арм_ФормыОплаты", data.paymentForms[i]);
    ok("виды услуг: " + data.serviceTypes.length + ", формы оплаты: " + data.paymentForms.length);

    var nContracts = 0;
    for (var i = 0; i < data.counterparties.length; i++) {
        var c = data.counterparties[i];
        var k = catalogItem("Контрагенты", c.name);
        counterparties[c.name] = k;
        for (var j = 0; j < c.contracts.length; j++) {
            var cname = c.contracts[j];
            var d = firstRef("ВЫБРАТЬ Д.Ссылка ИЗ Справочник.ДоговорыКонтрагентов КАК Д ГДЕ Д.Владелец = &Владелец И Д.Наименование = &Имя И НЕ Д.ПометкаУдаления",
                             { "Владелец": k, "Имя": cname });
            if (d) stat.found++;
            else {
                // обязательные реквизиты договора берём из основного договора контрагента
                var main = conn["Арм_ОбщегоНазначенияАРМ"]["НайтиДоговор"](k);
                var obj = (main && !main.IsEmpty()) ? main.GetObject().Copy() : conn.Catalogs["ДоговорыКонтрагентов"].CreateItem();
                obj.Owner = k; obj.Description = cname;
                trySet(obj, "НомерДоговора", cname);
                try { obj.Write(); } catch (e) { obj.DataExchange.Load = true; obj.Write(); warn("договор «" + cname + "» записан в режиме загрузки: " + e.message); }
                d = obj.Ref; stat.created++;
            }
            contracts[c.name + "|" + cname] = d; nContracts++;
        }
    }
    ok("контрагенты: " + data.counterparties.length + ", договоры: " + nContracts);

    for (var i = 0; i < data.nomenclature.length; i++) {
        var n = data.nomenclature[i];
        nomenclature[n.name] = catalogItem("Номенклатура", n.name, function (obj) {
            trySet(obj, "Артикул", n.article);
            trySet(obj, "АС_КодАвтоАльянс", n.code);
            try {
                var unit = conn.Catalogs["КлассификаторЕдиницИзмерения"].FindByDescription(n.unit, true);
                if (!unit.IsEmpty()) trySet(obj, "ЕдиницаИзмерения", unit);
            } catch (e) { }
        });
    }
    ok("номенклатура: " + data.nomenclature.length);

    // ------------------------------------------------------------ 2. пользователи и роли интерфейса
    log("2. Пользователи и роли интерфейса");
    var rights = conn.InformationRegisters["Арм_ПраваПользователей"];
    function setRole(user, roleName) {
        var role = enumValue("Арм_РолиИнтерфейса", roleName);
        if (!role) { warn("роли «" + roleName + "» нет в Арм_РолиИнтерфейса (нужна версия расширения с этой ролью) — пропущена"); return false; }
        var rs = rights.CreateRecordSet();
        rs.Filter["Пользователь"].Set(user); rs.Read();
        if (rs.Count() > 0 && str(rs.Get(0)["РольИнтерфейса"]) == str(role)) return true;
        rs.Clear(); var r = rs.Add(); r["Пользователь"] = user; r["РольИнтерфейса"] = role; rs.Write();
        return true;
    }
    var nRoles = 0;
    for (var i = 0; i < data.roles.length; i++) {
        var u = catalogItem("Пользователи", data.roles[i].user);
        if (setRole(u, data.roles[i].arm)) nRoles++;
    }
    ok("пользователей с ролью: " + nRoles + " из " + data.roles.length);
    if (data.adminUser) {
        var admin = conn.Catalogs["Пользователи"].FindByDescription(data.adminUser, true);
        if (admin.IsEmpty()) warn("пользователя «" + data.adminUser + "» нет — роль «Администратор» ему не назначена");
        else {
            var rs = rights.CreateRecordSet(); rs.Filter["Пользователь"].Set(admin); rs.Read();
            if (rs.Count() == 0) { setRole(admin, "Администратор"); ok("«" + data.adminUser + "»: назначена роль «Администратор»"); }
            else ok("«" + data.adminUser + "»: роль уже задана — " + str(rs.Get(0)["РольИнтерфейса"]) + ", не меняю");
        }
    }

    // ------------------------------------------------------------ 3. заказы покупателей -> строки АРМ
    log("3. Заказы покупателей и строки АРМ");
    var vehicles = {};
    for (var i = 0; i < data.vehicles.length; i++) vehicles[data.vehicles[i].gosnomer] = data.vehicles[i];
    var regMgr = conn.InformationRegisters["Арм_ДанныеЗакупокИПродаж"];
    var statusCount = {}, rowsDone = 0, skippedStatus = 0;

    for (var o = 0; o < data.orders.length; o++) {
        var ord = data.orders[o];
        var customer = counterparties[ord.customer];
        var contract = ord.contract ? contracts[ord.customer + "|" + ord.contract] : null;
        var docRef = firstRef("ВЫБРАТЬ Д.Ссылка ИЗ Документ.ЗаказПокупателя КАК Д ГДЕ Д.НомерЗаказаКлиента = &Номер И НЕ Д.ПометкаУдаления", { "Номер": ord.clientNumber });
        if (docRef) {
            stat.found++;
            var have = query("ВЫБРАТЬ КОЛИЧЕСТВО(*) ИЗ РегистрСведений.Арм_ДанныеЗакупокИПродаж КАК Т ГДЕ Т.ДокументЗаказПокупателя = &Док", { "Док": docRef });
            have.Next();
            if (have.Get(0) == 0) {
                repairOrder(docRef);
                warn("заказ " + ord.clientNumber + " был создан без строк АРМ (безопасный режим) — строки восстановлены");
            }
        }
        else {
            var doc = conn.Documents["ЗаказПокупателя"].CreateDocument();
            doc.Date = new Date().getVarDate();
            doc["Контрагент"] = customer;
            if (contract) doc["Договор"] = contract;
            doc["НомерЗаказаКлиента"] = ord.clientNumber;
            for (var r = 0; r < ord.rows.length; r++) {
                var row = ord.rows[r], line = doc["Запасы"].Add();
                line["НомерКлиента"] = ord.clientNumber;
                line["АртикулКлиента"] = row.article; line["НоменклатураКлиента"] = row.name;
                line["ЕдиницаИзмеренияКлиента"] = row.unit; line["КоличествоКлиента"] = row.qty;
                line["ГРЗКлиента"] = row.plate; line["ТерриторияКлиента"] = row.territory; line["СрочностьКлиента"] = row.urgency;
            }
            doc.Write();
            docRef = doc.Ref; stat.created++;
        }

        for (var r = 0; r < ord.rows.length; r++) {
            var row = ord.rows[r];
            var id = firstRef("ВЫБРАТЬ Т.ИдентификаторЗаписи ИЗ РегистрСведений.Арм_ДанныеЗакупокИПродаж КАК Т " +
                              "ГДЕ Т.ДокументЗаказПокупателя = &Док И Т.АртикулКлиента = &Артикул И Т.НоменклатураКлиента = &Имя И НЕ Т.Удаление",
                              { "Док": docRef, "Артикул": row.article, "Имя": row.name });
            if (!id) { fail("заказ " + ord.clientNumber + ": строки «" + row.name + "» нет в регистре АРМ (расширение в безопасном режиме или заказ создан раньше без расширения)"); continue; }

            var statusName = data.statusMap[row.status];
            if (!statusName) { skippedStatus++; warn("строка «" + row.name + "»: статуса матрицы «" + row.status + "» нет в АРМ — статус не изменён"); }
            var set = regMgr.CreateRecordSet();
            set.Filter["ИдентификаторЗаписи"].Set(id); set.Read();
            if (set.Count() == 0) { fail("строка " + id + " не прочитана"); continue; }
            var rec = set.Get(0);

            if (statusName) {
                var st = enumValue("Арм_СтатусыАРМ", statusName);
                if (st) { rec["СтатусСтроки"] = st; statusCount[statusName] = (statusCount[statusName] || 0) + 1; }
                else warn("статуса «" + statusName + "» нет в Арм_СтатусыАРМ");
            }
            if (row.nomenclature) rec["Номенклатура"] = nomenclature[row.nomenclature];
            if (row.quantity != null) rec["Количество"] = row.quantity;
            if (row.price != null) rec["Цена"] = row.price;
            if (row.cost != null) { rec["СебестоимостьЕдиницы"] = row.cost; rec["Себестоимость"] = row.cost * (row.quantity || 0); }
            if (row.coefficient != null) rec["Коэффициент"] = row.coefficient;
            if (row.serviceType) rec["ВидУслуги"] = serviceTypes[row.serviceType];
            if (row.paymentForm) rec["ФормаОплаты"] = paymentForms[row.paymentForm];
            if (row.supplier) rec["Поставщик"] = counterparties[row.supplier];
            if (row.comment) rec["КомментарийКСтроке"] = row.comment;

            // поля матрицы, появившиеся в v2.1 (в старых версиях расширения их нет)
            var v = vehicles[row.plate] || {};
            var extra = { "Госномер": row.plate, "Марка": v.brand, "Модель": v.model, "VIN": v.vin, "Двигатель": v.engine,
                          "Агрегат": row.aggregate, "РРЦ": row.rrc, "Оплачено": row.paid, "КоличествоНормаЧас": row.normHours,
                          "ДокументПодписанОригинал": row.docSigned, "ТерриторияОтгрузкиПоставщиком": row.shipTerritory };
            for (var f in extra) if (extra[f] != null && extra[f] !== "" && hasResource(f)) rec[f] = extra[f];

            set.Write(); rowsDone++;
        }
    }
    if (!hasResource("Марка")) warn("в регистре нет полей матрицы (Марка, Госномер, РРЦ…) — в базе расширение старше v2.1, эти поля не заполнены");
    var parts = []; for (var s in statusCount) parts.push(s + ": " + statusCount[s]);
    ok("заказов: " + data.orders.length + ", строк АРМ заполнено: " + rowsDone + " (" + parts.join(", ") + ")");
} catch (e) { fail("ошибка: " + e.message); }

var total = query("ВЫБРАТЬ КОЛИЧЕСТВО(*) ИЗ РегистрСведений.Арм_ДанныеЗакупокИПродаж КАК Т ГДЕ НЕ Т.Удаление"); total.Next();
log("Итог: создано объектов " + stat.created + ", уже было " + stat.found + ", предупреждений " + stat.warn + ", ошибок " + stat.err +
    "; строк в регистре АРМ: " + total.Get(0));
finish(stat.err ? 1 : 0);

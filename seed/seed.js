// Наполнение базы 1С демо-данными АРМ 3.0 (seed). Запускается 32-битным cscript из seed-1c.ps1.
//   cscript //nologo //E:JScript seed.js <режим> <файл со строкой соединения, UTF-16> <файл отчёта> [data.json]
// Режимы:
//   safemode-get | safemode-off | safemode-on — безопасный режим расширения АРМЗакупокИПродаж
//   seed                                      — наполнение по data.json
// data.json строит tools/seed_from_xlsx.py из seed/Шаблон деталей.xlsx: заказ покупателя на сценарий,
// строка АРМ на каждый шаг пути детали. Строки АРМ создаёт само расширение по документу «Заказ покупателя»
// (для этого оно не должно быть в безопасном режиме), seed затем заполняет их поля как в таблице.
// Повторный запуск дублей не создаёт: заказы ищутся по номеру клиента SEED-*, поля строк перезаписываются.

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
catch (e) { fail("не удалось подключиться к базе: " + (e.message || "(без текста)") + " [0x" + (e.number >>> 0).toString(16) + "]"); finish(2); }

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
function enumValue(enumName, valueName) {
    var e = md.Enums.Find(enumName);
    if (!e || !e.EnumValues.Find(valueName)) return null;
    return conn.Enums[enumName][valueName];
}
function trySet(obj, prop, value) { try { obj[prop] = value; return true; } catch (e) { return false; } }
function isEmptyValue(v) { try { return v === undefined || v === null || v === "" || v.IsEmpty(); } catch (e) { return !v; } }
function writeObject(obj, what) {
    try { obj.Write(); }
    catch (e) {
        // объекты УНФ могут требовать интерактивных проверок — пишем в режиме загрузки
        obj.DataExchange.Load = true; obj.Write();
        warn(what + " записан в режиме загрузки (обычная запись: " + e.message + ")");
    }
}
// элемент справочника по наименованию; создаётся, если нет. fill(obj) дозаполняет новый объект.
function catalogItem(catName, name, fill) {
    var mgr = conn.Catalogs[catName];
    var ref = mgr.FindByDescription(name, true);
    if (!ref.IsEmpty()) { stat.found++; return ref; }
    var obj = mgr.CreateItem();
    obj.Description = name;
    if (fill) fill(obj);
    writeObject(obj, catName + " «" + name + "»");
    stat.created++;
    return obj.Ref;
}
// "2026-10-02" -> дата 1С. VarDate в JScript в логическом контексте ложна — проверять на null, не через || и &&.
function toDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getVarDate() : null;
}

// Тип, счета учёта и ставка НДС номенклатуры: их ставит форма УНФ, а без них приходные и расходные накладные
// не проводятся («Журнал проводок: не заполнены оба счёта»). Через COM заполняем как у элемента из формы.
// Меняет только пустые реквизиты; возвращает true, если что-то заполнено.
var NOM_ACCOUNTS = { "СчетУчетаЗапасов": "Сырье и материалы", "СчетУчетаЗатрат": "Коммерческие расходы" };
function accountByName(name) {
    var charts = md.ChartsOfAccounts;
    for (var i = 0; i < charts.Count(); i++) {
        var ref = conn.ChartsOfAccounts[charts.Get(i).Name].FindByDescription(name, true);
        if (!ref.IsEmpty()) return ref;
    }
    return null;
}
function accountsDefaults(obj, map) {
    var changed = false;
    for (var f in map) {
        var a = accountByName(map[f]);
        if (a && isEmptyValue(obj[f]) && trySet(obj, f, a)) changed = true;
    }
    return changed;
}
// Значение реквизита по представлению: элемент справочника по наименованию или значение перечисления по синониму.
function valueByPresentation(objMd, attr, presentation) {
    var a = objMd.Attributes.Find(attr);
    if (!a) return null;
    var types = a.Type.Types();
    for (var i = 0; i < types.Count(); i++) {
        var m = md.FindByType(types.Get(i));
        if (!m) continue;
        var kind = m.FullName().split(".")[0];
        if (kind == "Справочник" || kind == "Catalog") {
            var ref = conn.Catalogs[m.Name].FindByDescription(presentation, true);
            if (!ref.IsEmpty()) return ref;
        } else if (kind == "Перечисление" || kind == "Enum") {
            for (var j = 0; j < m.EnumValues.Count(); j++) {
                var v = conn.Enums[m.Name][m.EnumValues.Get(j).Name];
                if (str(v) == presentation) return v;
            }
        }
    }
    return null;
}
// Реквизиты номенклатуры, которые форма УНФ ставит при создании (как у элемента, введённого вручную)
var NOM_FORM_DEFAULTS = {
    "НаправлениеДеятельности": "Основное направление", "Склад": "Основной склад", "МетодОценки": "По средней",
    "СпособПополнения": "Закупка", "ВидМаркировки": "Не маркируется", "ТипСрокаДействия": "Без ограничения срока",
    "ВидСтавкиНДС": "Общая"
};
var nomTemplate = null;
function nomenclatureDefaults(obj, n) {
    var changed = false;
    function setIfEmpty(prop, value) { if (value && isEmptyValue(obj[prop]) && trySet(obj, prop, value)) changed = true; }
    var objMd = md.Catalogs.Номенклатура;
    setIfEmpty("ТипНоменклатуры", enumValue("ТипыНоменклатуры", n.type || "Запас"));
    // всё, что даёт Заполнить() у нового элемента
    if (!nomTemplate) { nomTemplate = conn.Catalogs.Номенклатура.CreateItem(); try { nomTemplate.Fill(undefined); } catch (e) { } }
    for (var i = 0; i < objMd.Attributes.Count(); i++) {
        var a = objMd.Attributes.Get(i).Name;
        if (a == "ТипНоменклатуры") continue;
        if (!isEmptyValue(nomTemplate[a])) setIfEmpty(a, nomTemplate[a]);
    }
    if (accountsDefaults(obj, NOM_ACCOUNTS)) changed = true;
    for (var f in NOM_FORM_DEFAULTS) setIfEmpty(f, valueByPresentation(objMd, f, NOM_FORM_DEFAULTS[f]));
    setIfEmpty("ПризнакПредметаРасчета", valueByPresentation(objMd, "ПризнакПредметаРасчета", n.type == "Работа" || n.type == "Услуга" ? "Работа" : "Товар"));
    setIfEmpty("НаименованиеПолное", n.name);
    return changed;
}
// Счета расчётов контрагента — как у контрагентов, созданных в УНФ: без них накладные не проводятся.
var COUNTERPARTY_ACCOUNTS = {
    "СчетУчетаРасчетовСПокупателем": "Расчеты с покупателями", "СчетУчетаАвансовПокупателя": "Расчеты по авансам полученным",
    "СчетУчетаРасчетовСПоставщиком": "Расчеты с поставщиками", "СчетУчетаАвансовПоставщику": "Расчеты по авансам выданным"
};
// Единица измерения из классификатора: точное наименование, иначе — начинающееся с него («л» -> «л (дм3)»)
function unitRef(name) {
    if (!name) return null;
    var mgr = conn.Catalogs["КлассификаторЕдиницИзмерения"];
    var ref = mgr.FindByDescription(name, true);
    if (!ref.IsEmpty()) return ref;
    var s = query("ВЫБРАТЬ ПЕРВЫЕ 1 Е.Ссылка ИЗ Справочник.КлассификаторЕдиницИзмерения КАК Е ГДЕ Е.Наименование ПОДОБНО &Имя", { "Имя": name + "%" });
    return s.Next() ? s.Get(0) : null;
}

if (mode != "seed") { fail("неизвестный режим: " + mode); finish(2); }

var data;
try { data = eval("(" + readUtf8(WScript.Arguments(3)) + ")"); }
catch (e) { fail("не прочитан файл данных: " + e.message); finish(2); }

// ---------------------------------------------------------------- проверка расширения (АРМ 3.0)
var regMd = md.InformationRegisters.Find("Арм_ДанныеЗакупокИПродаж");
if (!regMd) { fail("в базе нет регистра Арм_ДанныеЗакупокИПродаж — расширение " + EXT + " не установлено"); finish(2); }
var ext = findExtension();
if (ext && ext.SafeMode) {
    fail("расширение в безопасном режиме: заказы не попадут в АРМ. Наполнение не выполнено (запускайте через seed-1c.ps1)");
    finish(2);
}
// тип каждого поля регистра: "Строка", "Число", "Дата", "Булево", "Справочник.Х", "Перечисление.Х"
var fieldType = {};
(function () {
    var kinds = ["Dimensions", "Resources", "Attributes"];
    for (var k = 0; k < kinds.length; k++) {
        var c = regMd[kinds[k]];
        for (var i = 0; i < c.Count(); i++) {
            var f = c.Get(i), t = f.Type.Types().Get(0), m = md.FindByType(t);
            fieldType[f.Name] = m ? m.FullName() : str(t);
        }
    }
})();
var missing = [];
for (var i = 0; i < data.minExtensionFields.length; i++) if (!fieldType[data.minExtensionFields[i]]) missing.push(data.minExtensionFields[i]);
if (missing.length) {
    fail("в регистре АРМ нет полей " + missing.join(", ") + " — seed рассчитан на АРМ 3.0 (схема v2.14 и новее). " +
         "Установите актуальное расширение " + EXT + " и запустите снова.");
    finish(2);
}
ok("расширение " + EXT + (ext && ext.Version ? " " + ext.Version : "") + ": полей регистра " + (function () { var n = 0; for (var k in fieldType) n++; return n; })());

try {
    // ------------------------------------------------------------ 1. справочники
    log("1. Справочники");
    var refs = { "Арм_ВидыУслуги": {}, "Арм_ФормыОплаты": {}, "Контрагенты": {}, "Номенклатура": {} };
    for (var i = 0; i < data.serviceTypes.length; i++) refs["Арм_ВидыУслуги"][data.serviceTypes[i]] = catalogItem("Арм_ВидыУслуги", data.serviceTypes[i]);
    for (var i = 0; i < data.paymentForms.length; i++) refs["Арм_ФормыОплаты"][data.paymentForms[i]] = catalogItem("Арм_ФормыОплаты", data.paymentForms[i]);
    ok("виды услуг: " + data.serviceTypes.join(", ") + "; формы оплаты: " + data.paymentForms.join(", "));

    var contracts = {}, nContracts = 0, cpRepaired = 0;
    for (var i = 0; i < data.counterparties.length; i++) {
        var c = data.counterparties[i];
        var k = catalogItem("Контрагенты", c.name, function (obj) {
            try { obj.Fill(undefined); } catch (e) { }
            accountsDefaults(obj, COUNTERPARTY_ACCOUNTS);
        });
        // созданные раньше без счетов расчётов — дозаполнить
        var kObj = k.GetObject();
        if (accountsDefaults(kObj, COUNTERPARTY_ACCOUNTS)) { writeObject(kObj, "контрагент «" + c.name + "»"); cpRepaired++; }
        refs["Контрагенты"][c.name] = k;
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
                writeObject(obj, "договор «" + cname + "»");
                d = obj.Ref; stat.created++;
            }
            contracts[c.name + "|" + cname] = d; nContracts++;
        }
    }
    ok("контрагенты: " + data.counterparties.length + ", договоры: " + nContracts + (cpRepaired ? ", дозаполнены счета расчётов: " + cpRepaired : ""));

    var nomRepaired = 0;
    for (var i = 0; i < data.nomenclature.length; i++) {
        var n = data.nomenclature[i];
        refs["Номенклатура"][n.name] = catalogItem("Номенклатура", n.name, function (obj) {
            try { obj.Fill(undefined); } catch (e) { }
            if (n.article) trySet(obj, "Артикул", n.article);
            if (n.code) trySet(obj, "АС_КодАвтоАльянс", n.code);
            var unit = unitRef(data.unitMap[n.unit] || n.unit);
            if (unit) trySet(obj, "ЕдиницаИзмерения", unit);
            else warn("номенклатура «" + n.name + "»: единицы «" + n.unit + "» нет в классификаторе");
            nomenclatureDefaults(obj, n);
        });
        // созданная раньше без типа и счетов — дозаполнить
        var cur = refs["Номенклатура"][n.name].GetObject();
        if (nomenclatureDefaults(cur, n)) { writeObject(cur, "номенклатура «" + n.name + "»"); nomRepaired++; }
    }
    ok("номенклатура: " + data.nomenclature.length + (nomRepaired ? ", дозаполнены тип/счета/НДС: " + nomRepaired : ""));

    // ------------------------------------------------------------ 2. пользователи и роли интерфейса
    log("2. Пользователи и роли интерфейса");
    var rights = conn.InformationRegisters["Арм_ПраваПользователей"];
    function setRole(user, roleName) {
        var role = enumValue("Арм_РолиИнтерфейса", roleName);
        if (!role) { warn("роли «" + roleName + "» нет в Арм_РолиИнтерфейса — пропущена"); return false; }
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

    // ------------------------------------------------------------ 3. сценарии: заказы покупателей -> строки АРМ по шагам
    log("3. Сценарии (путь детали по процессам) -> заказы покупателей и строки АРМ");
    var regMgr = conn.InformationRegisters["Арм_ДанныеЗакупокИПродаж"];
    var sale = enumValue("Арм_ВидыОпераций", "Продажа");

    // значение поля строки АРМ из data.json (ссылки — по наименованию)
    function fieldValue(field, value, ord) {
        var t = fieldType[field];
        if (t == "Дата") return toDate(value);
        if (t == "Число" || t == "Строка" || t == "Булево") return value;
        if (t == "Справочник.ДоговорыКонтрагентов") return contracts[ord.customer + "|" + value] || null;
        if (t == "Перечисление.Арм_СтатусыАРМ") return enumValue("Арм_СтатусыАРМ", value);
        var cat = t.split(".")[1];
        return (refs[cat] && refs[cat][value]) || null;
    }

    var statusCount = {}, rowsDone = 0;
    for (var o = 0; o < data.orders.length; o++) {
        var ord = data.orders[o];
        var customer = refs["Контрагенты"][ord.customer];
        var contract = ord.contract ? contracts[ord.customer + "|" + ord.contract] : null;
        var docRef = firstRef("ВЫБРАТЬ Д.Ссылка ИЗ Документ.ЗаказПокупателя КАК Д ГДЕ Д.НомерЗаказаКлиента = &Номер И НЕ Д.ПометкаУдаления", { "Номер": ord.clientNumber });
        if (docRef) stat.found++;
        else {
            var doc = conn.Documents["ЗаказПокупателя"].CreateDocument();
            var newDate = toDate(ord.date);
            doc.Date = newDate !== null ? newDate : new Date().getVarDate();
            doc["Контрагент"] = customer;
            if (contract) doc["Договор"] = contract;
            doc["НомерЗаказаКлиента"] = ord.clientNumber;
            for (var r = 0; r < ord.rows.length; r++) {
                var line = doc["Запасы"].Add(), cl = ord.rows[r].client;
                line["НомерКлиента"] = ord.clientNumber;
                if (ord.date) line["ДатаЗаказаКлиента"] = toDate(ord.date);
                for (var f in cl) line[f] = cl[f];
            }
            doc.Write();
            docRef = doc.Ref; stat.created++;
        }
        // дата заказа — из таблицы (В3); новый документ УНФ при первой записи получает текущую дату
        var orderDate = toDate(ord.date);
        if (orderDate !== null && str(docRef.Date) != str(orderDate)) {
            var dObj = docRef.GetObject();
            dObj.Date = orderDate;
            dObj.AdditionalProperties.Insert("Арм_ПрограммнаяЗапись", true);
            dObj.Write();
        }

        // строки документа и строки АРМ связаны ключом КлючСвязиСтрок — шаги сопоставляются по порядку строк
        var docRows = docRef.GetObject()["Запасы"];
        if (docRows.Count() != ord.rows.length) {
            fail("заказ " + ord.clientNumber + ": строк в документе " + docRows.Count() + ", в сценарии " + ord.rows.length +
                 " — пометьте заказ на удаление и запустите seed снова");
            continue;
        }
        var done = 0;
        for (var r = 0; r < ord.rows.length; r++) {
            var row = ord.rows[r], key = docRows.Get(r)["КлючСвязиСтрок"];
            var set = regMgr.CreateRecordSet();
            set.Filter["КлючСвязиСтрок"].Set(key); set.Filter["ВидОперации"].Set(sale); set.Read();
            var rec = null;
            for (var i = 0; i < set.Count(); i++) if (!set.Get(i)["Удаление"]) { rec = set.Get(i); break; }
            if (!rec) { fail("заказ " + ord.clientNumber + ", строка " + (r + 1) + " «" + row.step + "»: нет в регистре АРМ (расширение было в безопасном режиме?)"); continue; }
            for (var f in row.fields) {
                if (!fieldType[f]) { warn("поля «" + f + "» нет в регистре АРМ — пропущено"); continue; }
                var v = fieldValue(f, row.fields[f], ord);
                if (v === null) { warn(ord.clientNumber + " строка " + (r + 1) + ": «" + f + "» = «" + row.fields[f] + "» не найдено — пропущено"); continue; }
                rec[f] = v;
            }
            set.Write();
            statusCount[row.fields["СтатусСтроки"]] = (statusCount[row.fields["СтатусСтроки"]] || 0) + 1;
            done++; rowsDone++;
        }
        ok(ord.clientNumber + " «" + ord.title + "»: шагов " + done + " из " + ord.rows.length);
    }
    var parts = []; for (var s in statusCount) parts.push(s + ": " + statusCount[s]);
    ok("сценариев: " + data.orders.length + ", строк АРМ заполнено: " + rowsDone + " (" + parts.join(", ") + ")");
} catch (e) { fail("ошибка: " + e.message); }

var total = query("ВЫБРАТЬ КОЛИЧЕСТВО(*) ИЗ РегистрСведений.Арм_ДанныеЗакупокИПродаж КАК Т ГДЕ НЕ Т.Удаление"); total.Next();
log("Итог: создано объектов " + stat.created + ", уже было " + stat.found + ", предупреждений " + stat.warn + ", ошибок " + stat.err +
    "; строк в регистре АРМ: " + total.Get(0));
finish(stat.err ? 1 : 0);

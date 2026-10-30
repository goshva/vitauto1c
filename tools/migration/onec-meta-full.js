// Метаданные для переноса прямым чтением таблиц 1С (план, раздел 8; мигратор `legacy` и `load`). Только чтение.
// Пишет JSON lines:
//   {"table":..., "storage":..., "purpose":..., "meta":..., "fields":[[storage, name], ...]} — таблицы данных всех объектов;
//   {"enum":"Перечисление.X", "storage":"_EnumN", "values":["Имя1", ...]}               — порядок значений = _EnumOrder;
//   {"types":"Справочник.X", "attrs":{"Реквизит":["Справочник.Y", ...], "ТЧ.Реквизит":[...]}} — типы реквизитов typed-объектов.
//   C:\Windows\SysWOW64\cscript.exe //nologo //E:JScript onec-meta-full.js <out.jsonl> [база=vitauto_dev] [пользователь=Автосервис]
var fso = new ActiveXObject("Scripting.FileSystemObject");
var out = fso.CreateTextFile(WScript.Arguments(0), true, true);
var base = WScript.Arguments.length > 1 ? WScript.Arguments(1) : "vitauto_dev";
var user = WScript.Arguments.length > 2 ? WScript.Arguments(2) : "Автосервис";
var step = "connect";

var COLLECTIONS = ["Константы", "Справочники", "Документы", "Перечисления", "ПланыВидовХарактеристик", "ПланыСчетов", "ПланыВидовРасчета",
  "РегистрыСведений", "РегистрыНакопления", "РегистрыБухгалтерии", "РегистрыРасчета", "БизнесПроцессы", "Задачи", "ПланыОбмена"];
var DATA = { "Основная": 1, "ТабличнаяЧасть": 1, "Константа": 1, "ТочкиМаршрута": 1 };
// объекты, переносимые в типизированные таблицы (storage-map.mjs TABLES): нужны типы реквизитов для внешних ключей
var TYPED = ["Справочник.Организации", "Справочник.КлассификаторЕдиницИзмерения", "Справочник.ВидыЦен", "Справочник.Арм_ВидыУслуги",
  "Справочник.Арм_ФормыОплаты", "Справочник.асМодели", "Справочник.Пользователи", "Справочник.Контрагенты", "Справочник.СтруктурныеЕдиницы",
  "Справочник.Номенклатура", "Справочник.ДоговорыКонтрагентов", "Справочник.асАвтомобили", "Справочник.ПартииНоменклатуры",
  "Документ.ЗаказПокупателя", "Документ.ЗаказПоставщику", "Документ.ПриходнаяНакладная", "Документ.РасходнаяНакладная",
  "РегистрСведений.ЦеныНоменклатуры", "РегистрСведений.асАвтомобили", "РегистрСведений.асЦеныАвторабот",
  "РегистрСведений.Арм_ДанныеЗакупокИПродаж", "РегистрСведений.Арм_ПраваПользователей", "РегистрСведений.Арм_Уведомления", "РегистрНакопления.Запасы"];

function q(s) { var b = String.fromCharCode(92), d = String.fromCharCode(34); return d + String(s).split(b).join(b + b).split(d).join(b + d) + d; }
function typeNames(c, t) {
  var a = [], tt = t.Типы();
  for (var i = 0; i < tt.Количество(); i++) {
    var m = c.Метаданные.НайтиПоТипу(tt.Получить(i));
    a.push(q(m == null ? c.String(tt.Получить(i)) : m.ПолноеИмя()));
  }
  return "[" + a.join(",") + "]";
}
function attrs(c, coll, prefix, list) {
  var n = coll.Количество();
  for (var i = 0; i < n; i++) { var a = coll.Получить(i); list.push(q(prefix + a.Имя) + ":" + typeNames(c, a.Тип)); }
}

try {
  var c = new ActiveXObject("V83.COMConnector").Connect('Srvr="localhost";Ref="' + base + '";Usr="' + user + '";Pwd=""');
  var all = c.NewObject("Массив");
  for (var i = 0; i < COLLECTIONS.length; i++) {
    step = "collection " + COLLECTIONS[i];
    var coll = c.Метаданные[COLLECTIONS[i]], n = coll.Количество();
    for (var j = 0; j < n; j++) {
      var m = coll.Получить(j);
      all.Добавить(m);
      if (COLLECTIONS[i] == "Перечисления") {
        var v = [], vals = m.ЗначенияПеречисления;
        for (var k = 0; k < vals.Количество(); k++) v.push(q(vals.Получить(k).Имя));
        out.WriteLine('{"enum":' + q(m.ПолноеИмя()) + ',"values":[' + v.join(",") + ']}');
      }
    }
  }
  step = "structure";
  var t = c.ПолучитьСтруктуруХраненияБазыДанных(all, true);
  for (var i = 0; i < t.Количество(); i++) {
    var r = t.Получить(i);
    if (!DATA[r.Назначение] && r.ИмяТаблицыХранения.indexOf("_Enum") != 0) continue;
    var f = [];
    for (var j = 0; j < r.Поля.Количество(); j++) { var p = r.Поля.Получить(j); f.push('[' + q(p.ИмяПоляХранения) + ',' + q(p.ИмяПоля) + ']'); }
    out.WriteLine('{"meta":' + q(r.Метаданные) + ',"table":' + q(r.ИмяТаблицы) + ',"storage":' + q(r.ИмяТаблицыХранения) + ',"purpose":' + q(r.Назначение) + ',"fields":[' + f.join(',') + ']}');
  }
  for (var i = 0; i < TYPED.length; i++) {
    step = "types " + TYPED[i];
    var m = c.Метаданные.НайтиПоПолномуИмени(TYPED[i]), list = [];
    if (m == null) continue;
    var kind = TYPED[i].split(".")[0];
    if (kind == "РегистрСведений" || kind == "РегистрНакопления") { attrs(c, m.Измерения, "", list); attrs(c, m.Ресурсы, "", list); attrs(c, m.Реквизиты, "", list); }
    else {
      attrs(c, m.Реквизиты, "", list);
      if (kind == "Справочник" && m.Владельцы.Количество() > 0) {
        var ow = [];
        for (var en = new Enumerator(m.Владельцы); !en.atEnd(); en.moveNext()) ow.push(q(en.item().ПолноеИмя())); // у коллекции владельцев нет Получить()
        list.push('"Владелец":[' + ow.join(",") + ']');
      }
      var tps = m.ТабличныеЧасти;
      for (var k = 0; k < tps.Количество(); k++) attrs(c, tps.Получить(k).Реквизиты, tps.Получить(k).Имя + ".", list);
    }
    out.WriteLine('{"types":' + q(TYPED[i]) + ',"attrs":{' + list.join(",") + '}}');
  }
} catch (e) { out.WriteLine('{"error":' + q(step + ": " + e.message) + '}'); }
out.Close();

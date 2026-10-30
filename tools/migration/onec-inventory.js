// Полная инвентаризация метаданных 1С (план tasks/migration-pg-go-vue.md, раздел 8, команда inventory; проверка G0.5):
// каждый объект всех коллекций метаданных (вместе с объектами расширений) и его таблицы хранения без полей.
// Число строк считается отдельно, точным COUNT(*) в PostgreSQL (tools/migration/pg-table-counts.sql). Только чтение.
//   C:\Windows\SysWOW64\cscript.exe //nologo //E:JScript onec-inventory.js <out.jsonl> [база=vitauto_dev] [пользователь=Автосервис]
var fso = new ActiveXObject("Scripting.FileSystemObject");
var out = fso.CreateTextFile(WScript.Arguments(0), true, true);
var base = WScript.Arguments.length > 1 ? WScript.Arguments(1) : "vitauto_dev";
var user = WScript.Arguments.length > 2 ? WScript.Arguments(2) : "Автосервис";
var step = "connect";

// коллекция метаданных -> вид объекта в полном имени
var COLLECTIONS = [
  ["Константы", "Константа"], ["Справочники", "Справочник"], ["Документы", "Документ"], ["Перечисления", "Перечисление"],
  ["ПланыВидовХарактеристик", "ПланВидовХарактеристик"], ["ПланыСчетов", "ПланСчетов"], ["ПланыВидовРасчета", "ПланВидовРасчета"],
  ["РегистрыСведений", "РегистрСведений"], ["РегистрыНакопления", "РегистрНакопления"], ["РегистрыБухгалтерии", "РегистрБухгалтерии"],
  ["РегистрыРасчета", "РегистрРасчета"], ["БизнесПроцессы", "БизнесПроцесс"], ["Задачи", "Задача"], ["ПланыОбмена", "ПланОбмена"],
  ["ЖурналыДокументов", "ЖурналДокументов"], ["Последовательности", "Последовательность"]
];

function q(s) { var b = String.fromCharCode(92), d = String.fromCharCode(34); return d + String(s).split(b).join(b + b).split(d).join(b + d) + d; }

try {
  var c = new ActiveXObject("V83.COMConnector").Connect('Srvr="localhost";Ref="' + base + '";Usr="' + user + '";Pwd=""');
  var all = c.NewObject("Массив");
  for (var i = 0; i < COLLECTIONS.length; i++) {
    step = "collection " + COLLECTIONS[i][0];
    var coll = c.Метаданные[COLLECTIONS[i][0]];
    var n = coll.Количество();
    for (var j = 0; j < n; j++) {
      var m = coll.Получить(j);
      var ext = m.РасширениеКонфигурации();
      out.WriteLine('{"object":' + q(m.ПолноеИмя()) + ',"kind":' + q(COLLECTIONS[i][1]) + ',"name":' + q(m.Имя)
        + ',"synonym":' + q(m.Синоним) + ',"extension":' + (ext == null ? "null" : q(ext.Имя)) + '}');
      all.Добавить(m);
    }
  }
  step = "structure";
  var t = c.ПолучитьСтруктуруХраненияБазыДанных(all, true);
  for (var i = 0; i < t.Количество(); i++) {
    var r = t.Получить(i);
    out.WriteLine('{"meta":' + q(r.Метаданные) + ',"table":' + q(r.ИмяТаблицы) + ',"storage":' + q(r.ИмяТаблицыХранения) + ',"purpose":' + q(r.Назначение) + '}');
  }
  step = "common";
  // общие таблицы (последовательности, итоги, служебные) без привязки к объекту
  var g = c.ПолучитьСтруктуруХраненияБазыДанных();
  for (var i = 0; i < g.Количество(); i++) {
    var r = g.Получить(i);
    if (r.Метаданные == "") out.WriteLine('{"meta":"","table":' + q(r.ИмяТаблицы) + ',"storage":' + q(r.ИмяТаблицыХранения) + ',"purpose":' + q(r.Назначение) + '}');
  }
} catch (e) { out.WriteLine('{"error":' + q(step + ": " + e.message) + '}'); }
out.Close();

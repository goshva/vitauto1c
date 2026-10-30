// Структура хранения объектов 1С, которые переносятся в типизированные таблицы (план tasks/migration-pg-go-vue.md, раздел 5.3):
// объект метаданных -> таблица PostgreSQL 1С (_Reference368X1, _InfoRg56838X1 ...) -> поля хранения, число записей,
// плюс контрольный GUID для проверки порядка байтов _IDRRef. Только чтение.
// Запуск (JScript, 32-битный cscript, файл в UTF-16):
//   C:\Windows\SysWOW64\cscript.exe //nologo //E:JScript onec-storage-structure.js <out.jsonl> [база=vitauto_dev] [пользователь=Автосервис]
var fso = new ActiveXObject("Scripting.FileSystemObject");
var out = fso.CreateTextFile(WScript.Arguments(0), true, true);
var base = WScript.Arguments.length > 1 ? WScript.Arguments(1) : "vitauto_dev";
var user = WScript.Arguments.length > 2 ? WScript.Arguments(2) : "Автосервис";
var step = "connect";

var OBJECTS = [
  "Справочник.Организации", "Справочник.Контрагенты", "Справочник.ДоговорыКонтрагентов", "Справочник.Номенклатура",
  "Справочник.ПартииНоменклатуры", "Справочник.КлассификаторЕдиницИзмерения", "Справочник.ВидыЦен", "Справочник.асАвтомобили",
  "Справочник.асМодели", "Справочник.Арм_ВидыУслуги", "Справочник.Арм_ФормыОплаты", "Справочник.Пользователи",
  "Справочник.СтруктурныеЕдиницы",
  "Документ.ЗаказПокупателя", "Документ.ЗаказПоставщику", "Документ.ПриходнаяНакладная", "Документ.РасходнаяНакладная",
  "РегистрСведений.ЦеныНоменклатуры", "РегистрСведений.асАвтомобили", "РегистрСведений.асЦеныАвторабот",
  "РегистрСведений.Арм_ДанныеЗакупокИПродаж", "РегистрСведений.Арм_ПраваПользователей", "РегистрСведений.Арм_Уведомления",
  "РегистрНакопления.Запасы",
  "Перечисление.Арм_СтатусыАРМ", "Перечисление.Арм_ВидыОпераций", "Перечисление.Арм_РолиИнтерфейса"
];

function q(s) { var b = String.fromCharCode(92), d = String.fromCharCode(34); return d + String(s).split(b).join(b + b).split(d).join(b + d) + d; }

function count(c, table) {
  try {
    var z = c.NewObject("Запрос"); z.Текст = "ВЫБРАТЬ КОЛИЧЕСТВО(*) КАК К ИЗ " + table + " КАК Т";
    var s = z.Выполнить().Выбрать(); s.Следующий(); return s.К;
  } catch (e) { return -1; }
}

try {
  var c = new ActiveXObject("V83.COMConnector").Connect('Srvr="localhost";Ref="' + base + '";Usr="' + user + '";Pwd=""');
  var arr = c.NewObject("Массив");
  for (var i = 0; i < OBJECTS.length; i++) {
    step = "meta " + OBJECTS[i];
    var m = c.Метаданные.НайтиПоПолномуИмени(OBJECTS[i]);
    if (m == null) { out.WriteLine('{"missing":' + q(OBJECTS[i]) + '}'); continue; }
    arr.Добавить(m);
  }
  step = "structure";
  var t = c.ПолучитьСтруктуруХраненияБазыДанных(arr, true);
  for (var i = 0; i < t.Количество(); i++) {
    var r = t.Получить(i), f = [];
    for (var j = 0; j < r.Поля.Количество(); j++) { var p = r.Поля.Получить(j); f.push('[' + q(p.ИмяПоляХранения) + ',' + q(p.ИмяПоля) + ']'); }
    var rows = (r.Назначение == "Основная" || r.Назначение == "ТабличнаяЧасть") && r.ИмяТаблицы != "" && r.ИмяТаблицы.indexOf("Перечисление.") != 0 ? count(c, r.ИмяТаблицы) : null;
    out.WriteLine('{"meta":' + q(r.Метаданные) + ',"table":' + q(r.ИмяТаблицы) + ',"storage":' + q(r.ИмяТаблицыХранения)
      + ',"purpose":' + q(r.Назначение) + ',"rows":' + (rows == null ? "null" : rows) + ',"fields":[' + f.join(',') + ']}');
  }
  step = "uuid";
  var z = c.NewObject("Запрос");
  z.Текст = "ВЫБРАТЬ ПЕРВЫЕ 1 Н.Ссылка КАК С, Н.Код КАК К ИЗ Справочник.Номенклатура КАК Н УПОРЯДОЧИТЬ ПО Н.Код";
  var s = z.Выполнить().Выбрать();
  if (s.Следующий()) out.WriteLine('{"uuidSample":{"object":"Справочник.Номенклатура","code":' + q(s.К) + ',"uuid":' + q(c.String(s.С.УникальныйИдентификатор())) + '}}');
} catch (e) { out.WriteLine('{"error":' + q(step + ": " + e.message) + '}'); }
out.Close();

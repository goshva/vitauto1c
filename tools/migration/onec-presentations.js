// Сверка R8 (план, раздел 9): представление ссылок «как видит пользователь» в 1С для выборки объектов. Только чтение.
// Вход (UTF-16): строки «Документ.ЗаказПокупателя<TAB>uuid». Выход (UTF-16): «uuid<TAB>представление».
//   C:\Windows\SysWOW64\cscript.exe //nologo //E:JScript onec-presentations.js <in.txt> <out.txt> [база=vitauto_dev] [пользователь=Автосервис]
var fso = new ActiveXObject("Scripting.FileSystemObject");
var input = fso.OpenTextFile(WScript.Arguments(0), 1, false, -1);
var out = fso.CreateTextFile(WScript.Arguments(1), true, true);
var base = WScript.Arguments.length > 2 ? WScript.Arguments(2) : "vitauto_dev";
var user = WScript.Arguments.length > 3 ? WScript.Arguments(3) : "Автосервис";
try {
  var c = new ActiveXObject("V83.COMConnector").Connect('Srvr="localhost";Ref="' + base + '";Usr="' + user + '";Pwd=""');
  while (!input.AtEndOfStream) {
    var line = input.ReadLine();
    if (!line) continue;
    var p = line.split("\t"), kind = p[0].split(".");
    try {
      var mgr = kind[0] == "Документ" ? c.Документы[kind[1]] : c.Справочники[kind[1]];
      var ref = mgr.ПолучитьСсылку(c.NewObject("УникальныйИдентификатор", p[1]));
      out.WriteLine(p[1] + "\t" + c.String(ref));
    } catch (e) { out.WriteLine(p[1] + "\t!" + e.message); }
  }
} catch (e) { out.WriteLine("ERROR\t" + e.message); }
input.Close();
out.Close();

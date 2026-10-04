// Фикстура: строку закупки (ИдентификаторЗаписи = аргумент 1) перевести в «Заказано» — как после заказа поставщику.
var fso = new ActiveXObject("Scripting.FileSystemObject");
var OUT = fso.CreateTextFile(WScript.Arguments(0), true, true);
try {
  var conn = new ActiveXObject("V83.COMConnector").Connect('File="D:\\1c\\test_fresh";Usr="Админ";Pwd=""');
  var set = conn.InformationRegisters.Арм_ДанныеЗакупокИПродаж.CreateRecordSet();
  set.Filter.ИдентификаторЗаписи.Set(WScript.Arguments(1));
  set.Read();
  for (var i = 0; i < set.Count(); i++) { var r = set.Get(i); r.СтатусСтроки = conn.Enums.Арм_СтатусыАРМ[WScript.Arguments(2)]; if (r.Количество == 0) r.Количество = 1; }
  set.Write();
  OUT.WriteLine("ok " + set.Count());
} catch (x) { OUT.WriteLine("ошибка: " + x.message); }
OUT.Close();

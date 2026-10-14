// Включение расширения (Активно, без безопасного режима и защиты от опасных действий) и роль АРМ пользователю.
// cscript //E:JScript ext-activate.js <файл со строкой соединения (UTF-16)> <отчёт> <расширение> [<пользователь> <роль АРМ>]
// Строку соединения передаём файлом: в ней кириллица и кавычки.
var a = WScript.Arguments;
var fso = new ActiveXObject('Scripting.FileSystemObject');
var cs = fso.OpenTextFile(a(0), 1, false, -1).ReadAll();
var out = fso.CreateTextFile(a(1), true, true);
try {
  var c = new ActiveXObject('V83.COMConnector').Connect(cs);
  var name = a(2), found = false;
  var list = c.РасширенияКонфигурации.Получить();
  for (var i = 0; i < list.Количество(); i++) {
    var e = list.Получить(i);
    if (e.Имя !== name) continue;
    found = true;
    e.Активно = true;
    e.БезопасныйРежим = false;
    try { e.ЗащитаОтОпасныхДействий = c.NewObject('ОписаниеЗащитыОтОпасныхДействий'); e.ЗащитаОтОпасныхДействий.ПредупреждатьОбОпасныхДействиях = false; } catch (x) {}
    e.Записать();
    out.WriteLine('OK ' + name + ': активно, без безопасного режима');
  }
  if (!found) out.WriteLine('ERROR=расширение ' + name + ' не найдено');
  if (a.length > 4) {
    var user = c.Справочники.Пользователи.НайтиПоНаименованию(a(3), true);
    if (user.Пустая()) out.WriteLine('ERROR=пользователь «' + a(3) + '» не найден в справочнике «Пользователи»');
    else {
      var m = c.РегистрыСведений.Арм_ПраваПользователей.СоздатьМенеджерЗаписи();
      m.Пользователь = user;
      m.РольИнтерфейса = c.Перечисления.Арм_РолиИнтерфейса[a(4)];
      m.Записать(true);
      out.WriteLine('OK роль АРМ «' + a(4) + '» — ' + a(3));
    }
  }
} catch (e) {
  out.WriteLine('ERROR=' + e.message);
}
out.Close();

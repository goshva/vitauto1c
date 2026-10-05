// COM-настройка базы после загрузки АРМ v2.9 (запускает deploy-prod.ps1 через 32-бит cscript, файл в UTF-16):
//   1) безопасный режим расширения АРМЗакупокИПродаж выключен, предупреждения об опасных действиях выключены;
//   2) пользователи ИБ для PWA (без ролей 1С — входят только через API) связаны с элементами справочника Пользователи
//      с ролями интерфейса АРМ (элементы «… (seed)», создаёт seed-1c.ps1).
// Аргументы: <файл отчёта> <каталог базы> <пароль>
var fso = new ActiveXObject("Scripting.FileSystemObject");
var OUT = fso.CreateTextFile(WScript.Arguments(0), true, true);
var IB = WScript.Arguments(1), PASSWORD = WScript.Arguments(2);
var USERS = [["arm.manager", "Менеджер"], ["arm.storekeeper", "Кладовщик"], ["arm.supply", "Снабжение"],
             ["arm.admin", "Администратор"], ["arm.mechanic", "ГлавныйМеханик"]];
var SEED = { "Менеджер": "Менеджер (seed)", "Кладовщик": "Кладовщик (seed)", "Снабжение": "Снабжение (seed)",
             "Администратор": "Администратор (seed)", "ГлавныйМеханик": "Главный механик (seed)" };
try {
  var conn = new ActiveXObject("V83.COMConnector").Connect('File="' + IB + '";Usr="Админ";Pwd=""');
  var list = conn.ConfigurationExtensions.Get(), found = false;
  for (var i = 0; i < list.Count(); i++) {
    var e = list.Get(i);
    if (e.Name != "АРМЗакупокИПродаж") continue;
    found = true;
    if (e.SafeMode) {
      // как seed\seed.js: с защитой от опасных действий 1С спрашивает подтверждение, через COM ответить нельзя
      var off = conn.NewObject("UnsafeOperationProtectionDescription");
      off.UnsafeOperationWarnings = false;
      e.UnsafeActionProtection = off;
      e.SafeMode = false;
      e.Write();
    }
    OUT.WriteLine("EXT version=" + e.Version + " safe=" + e.SafeMode + " active=" + e.Active);
  }
  if (!found) throw new Error("нет расширения АРМЗакупокИПродаж");
  if (!conn.Metadata.HTTPServices.Find("Арм_API")) throw new Error("нет HTTP-сервиса Арм_API — загружена не v2.9?");

  for (var i = 0; i < USERS.length; i++) {
    var login = USERS[i][0], role = USERS[i][1];
    var u = conn.InfoBaseUsers.FindByName(login);
    if (!u) { u = conn.InfoBaseUsers.CreateUser(); u.Name = login; u.FullName = SEED[role].replace(" (seed)", "") + " (PWA)"; }
    u.StandardAuthentication = true;
    u.ShowInList = false;
    u.Password = PASSWORD;
    u.Write();
    // элемент Пользователи: seed-элемент роли или новый; связь через ОбменДанными.Загрузка (обработчики УНФ её сбрасывают)
    var ref = conn.Catalogs.Пользователи.FindByDescription(SEED[role], true);
    var obj = ref.IsEmpty() ? conn.Catalogs.Пользователи.CreateItem() : ref.GetObject();
    if (ref.IsEmpty()) obj.Description = SEED[role];
    obj.ИдентификаторПользователяИБ = conn.NewObject("УникальныйИдентификатор", conn.String(u.UUID));
    obj.DataExchange.Load = true;
    obj.Write();
    var rm = conn.InformationRegisters.Арм_ПраваПользователей.CreateRecordManager();
    rm.Пользователь = obj.Ref;
    rm.РольИнтерфейса = conn.Enums.Арм_РолиИнтерфейса[role];
    rm.Write(true);
    OUT.WriteLine("USER " + login + " -> " + obj.Description + " role=" + role + " link=" + conn.String(obj.Ref.ИдентификаторПользователяИБ));
  }
  OUT.WriteLine("OK");
} catch (x) { OUT.WriteLine("ERROR " + x.message); }
OUT.Close();

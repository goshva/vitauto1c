// Тестовые пользователи PWA (режим OData): пользователь ИБ + элемент «Пользователи» с тем же именем + роль АРМ.
//   cscript //E:JScript pwa-test-users.js <файл со строкой соединения, UTF-16> <файл отчёта> <пароль>
// Пользователи ИБ получают роль ПолныеПрава (тестовая база: стандартный интерфейс OData требует прав на объекты).
var fso = new ActiveXObject("Scripting.FileSystemObject");
var a = WScript.Arguments;
var f = fso.OpenTextFile(a(0), 1, false, -1), cs = f.ReadAll(); f.Close();
var OUT = fso.CreateTextFile(a(1), true, true), PWD = a(2);
function log(s) { OUT.WriteLine(s); }
var USERS = [["arm.manager", "Менеджер"], ["arm.storekeeper", "Кладовщик"], ["arm.supply", "Снабжение"],
             ["arm.admin", "Администратор"], ["arm.mechanic", "ГлавныйМеханик"]];
try {
    var c = new ActiveXObject("V83.COMConnector").Connect(cs);
    var full = c.Metadata.Roles.Find("ПолныеПрава");
    var rights = c.InformationRegisters.Арм_ПраваПользователей;
    for (var i = 0; i < USERS.length; i++) {
        var name = USERS[i][0], role = USERS[i][1];
        var u = c.InfoBaseUsers.FindByName(name);
        var isNew = !u;
        if (isNew) { u = c.InfoBaseUsers.CreateUser(); u.Name = name; u.FullName = name; }
        u.StandardAuthentication = true; u.ShowInList = true; u.Password = PWD;
        if (full && !u.Roles.Contains(full)) u.Roles.Add(full);
        u.Write();
        // элемент «Пользователи», связанный с пользователем ИБ: без связи БСП не ставит параметр сеанса
        // ТекущийПользователь, и запись документов через OData падает в ОбработкаЗаполнения
        var ref = c.Catalogs.Пользователи.FindByDescription(name, true);
        var o = ref.IsEmpty() ? c.Catalogs.Пользователи.CreateItem() : ref.GetObject();
        o.Description = name;
        // через COM УникальныйИдентификатор — только NewObject (прямое присваивание u.UUID молча не пишется);
        // запись в режиме загрузки: обработчики БСП иначе сбрасывают связь, заданную не через ОписаниеПользователяИБ
        o.ИдентификаторПользователяИБ = c.NewObject("УникальныйИдентификатор", c.String(u.UUID));
        o.DataExchange.Load = true;
        o.Write();
        ref = o.Ref;
        if (c.String(ref.ИдентификаторПользователяИБ) != c.String(u.UUID)) log("WARN " + name + ": связь с пользователем ИБ не записалась");
        var rs = rights.CreateRecordSet(); rs.Filter.Пользователь.Set(ref); rs.Read(); rs.Clear();
        var r = rs.Add(); r.Пользователь = ref; r.РольИнтерфейса = c.Enums.Арм_РолиИнтерфейса[role]; rs.Write();
        log("OK " + name + " (" + role + ")" + (isNew ? " создан" : " обновлён"));
    }
} catch (e) { log("ERROR " + e.message.replace(/\s+/g, " ")); }
OUT.Close();

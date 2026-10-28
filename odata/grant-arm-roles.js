// Роли расширения АРМ пользователям PWA arm.*: пользователь ИБ получает роль АРМ (Арм_Пользователь / Арм_Администратор),
// вход 1С:Предприятия разрешён; элемент «Пользователи» — действителен; роль интерфейса в Арм_ПраваПользователей — если её нет.
// Остальные роли пользователя ИБ и пароль не меняются (пароль — только если передан).
// <полные права> = 1 — ещё и роль ПолныеПрава: роли АРМ не дают прав на регистры АРМ, а OData проверяет права
// (в клиенте 1С АРМ читает их привилегированно); других ролей с чтением Арм_ДанныеЗакупокИПродаж в базе нет.
//   cscript //E:JScript grant-arm-roles.js <файл со строкой соединения, UTF-16> <файл отчёта> <полные права 0|1> [<пароль>]
var fso = new ActiveXObject("Scripting.FileSystemObject");
var a = WScript.Arguments;
var f = fso.OpenTextFile(a(0), 1, false, -1), cs = f.ReadAll(); f.Close();
var OUT = fso.CreateTextFile(a(1), true, true), FULL = a(2) == "1", PWD = a.length > 3 ? a(3) : null;
function log(s) { OUT.WriteLine(s); }
// пользователь ИБ, роль конфигурации (расширения АРМ), роль интерфейса АРМ
var USERS = [["arm.manager", "Арм_Пользователь", "Менеджер"], ["arm.storekeeper", "Арм_Пользователь", "Кладовщик"],
             ["arm.supply", "Арм_Пользователь", "Снабжение"], ["arm.admin", "Арм_Администратор", "Администратор"],
             ["arm.mechanic", "Арм_Пользователь", "ГлавныйМеханик"]];
try {
    var c = new ActiveXObject("V83.COMConnector").Connect(cs);
    var rights = c.InformationRegisters.Арм_ПраваПользователей;
    var full = FULL ? c.Metadata.Roles.Find("ПолныеПрава") : null;
    if (FULL && !full) log("ERROR нет роли ПолныеПрава");
    for (var i = 0; i < USERS.length; i++) {
        var name = USERS[i][0], roleName = USERS[i][1], ui = USERS[i][2];
        try {
            var role = c.Metadata.Roles.Find(roleName);
            if (!role) { log("ERROR " + name + ": нет роли " + roleName + " — расширение АРМ не подключено?"); continue; }
            var u = c.InfoBaseUsers.FindByName(name);
            if (!u) { log("SKIP " + name + ": нет пользователя ИБ — создайте его в 1С (Пользователи)"); continue; }
            var added = !u.Roles.Contains(role);
            if (added) u.Roles.Add(role);
            var fullAdded = full && !u.Roles.Contains(full);
            if (fullAdded) u.Roles.Add(full);
            u.StandardAuthentication = true;
            if (PWD !== null) u.Password = PWD;
            u.Write();
            var msg = name + ": " + roleName + (added ? " добавлена" : " уже была")
                + (full ? ", ПолныеПрава" + (fullAdded ? " добавлена" : " уже была") : "") + (PWD !== null ? ", пароль задан" : "");
            // элемент «Пользователи»: действителен (иначе БСП не пустит), связь с пользователем ИБ — как в pwa-test-users.js
            var ref = c.Catalogs.Пользователи.FindByDescription(name, true);
            if (ref.IsEmpty()) msg += "; WARN нет элемента «Пользователи»";
            else {
                if (ref.Недействителен) { var o = ref.GetObject(); o.Недействителен = false; o.DataExchange.Load = true; o.Write(); msg += "; элемент снова действителен"; }
                if (c.String(ref.ИдентификаторПользователяИБ) != c.String(u.UUID)) msg += "; WARN элемент не связан с пользователем ИБ";
                var rs = rights.CreateRecordSet(); rs.Filter.Пользователь.Set(ref); rs.Read();
                if (rs.Count() == 0) {
                    var r = rs.Add(); r.Пользователь = ref; r.РольИнтерфейса = c.Enums.Арм_РолиИнтерфейса[ui]; rs.Write();
                    msg += "; роль АРМ «" + ui + "» записана";
                } else msg += "; роль АРМ «" + c.String(rs.Get(0).РольИнтерфейса) + "»";
            }
            log("OK " + msg);
        } catch (e) { log("ERROR " + name + ": " + e.message.replace(/\s+/g, " ")); }
    }
} catch (e) { log("ERROR " + e.message.replace(/\s+/g, " ")); }
OUT.Close();

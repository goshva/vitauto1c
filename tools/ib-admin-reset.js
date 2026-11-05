// Пустой пароль у пользователя ИБ (по умолчанию «Администратор») — вход под другим пользователем с полными правами.
//   cscript //E:JScript ib-admin-reset.js <файл со строкой соединения, UTF-16> <файл отчёта> <имя пользователя>
// Строка соединения — без Usr/Pwd: пользователи для входа перебираются (Usr=<кандидат>;Pwd="").
// Отчёт: LOGIN=<кто вошёл>, USERS=<список>, RESET=OK|NOUSER|ERR:<текст>, LOGIN_AFTER=OK|ERR.
var fso = new ActiveXObject("Scripting.FileSystemObject");
var a = WScript.Arguments;
var f = fso.OpenTextFile(a(0), 1, false, -1), base = f.ReadAll(); f.Close();
var OUT = fso.CreateTextFile(a(1), true, true), target = a(2);
function log(s) { OUT.WriteLine(s); }
function connect(user) { return new ActiveXObject("V83.COMConnector").Connect(base + 'Usr="' + user + '";Pwd="";'); }

var cands = [target, "Админ", "Автосервис", ""], conn = null, who = null;
for (var i = 0; i < cands.length && !conn; i++) { try { conn = connect(cands[i]); who = cands[i]; } catch (e) { } }
if (!conn) { log("LOGIN=ERR:нет входа без пароля (" + cands.join(", ") + ")"); OUT.Close(); WScript.Quit(1); }
log("LOGIN=" + who);
try {
    var u = conn.InfoBaseUsers.GetUsers(), names = [];
    for (var i = 0; i < u.Count(); i++) names.push(u.Get(i).Name);
    log("USERS=" + names.join(", "));
    var x = conn.InfoBaseUsers.FindByName(target);
    if (!x) log("RESET=NOUSER");
    else if (!x.PasswordIsSet) log("RESET=ALREADY");
    else { x.Password = ""; x.Write(); log("RESET=OK"); }
} catch (e) { log("RESET=ERR:" + e.message.replace(/\s+/g, " ")); }
conn = null; CollectGarbage();
try { connect(target); log("LOGIN_AFTER=OK"); } catch (e) { log("LOGIN_AFTER=ERR:" + e.message.replace(/\s+/g, " ").substring(0, 120)); }
OUT.Close();

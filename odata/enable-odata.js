// Включение полного состава стандартного интерфейса OData через расширение АРМ_OData (COM).
//   cscript //E:JScript enable-odata.js <файл со строкой соединения, UTF-16> <файл отчёта> [list]
// Отчёт: SAFEMODE=..., ENABLED=<число>, CANDIDATES=<число>, KIND <вид>=<число>, SKIPPED <объект: причина>,
// с аргументом list — ещё OBJ <ПолноеИмя> по каждому объекту состава.
var fso = new ActiveXObject("Scripting.FileSystemObject");
var a = WScript.Arguments;
var f = fso.OpenTextFile(a(0), 1, false, -1), cs = f.ReadAll(); f.Close();
var OUT = fso.CreateTextFile(a(1), true, true);
function log(s) { OUT.WriteLine(s); }
try {
    var c = new ActiveXObject("V83.COMConnector").Connect(cs);
    // безопасный режим расширения запрещает менять настройки ИБ — снимаем для АРМ_OData
    var exts = c.ConfigurationExtensions.Get(), ext = null;
    for (var i = 0; i < exts.Count(); i++) if (exts.Get(i).Name == "АРМ_OData") ext = exts.Get(i);
    if (!ext) throw new Error("расширение АРМ_OData не подключено к базе");
    log("SAFEMODE_WAS=" + (ext.SafeMode ? 1 : 0));
    if (ext.SafeMode) {
        try {
            var off = c.NewObject("UnsafeOperationProtectionDescription"); off.UnsafeOperationWarnings = false;
            ext.UnsafeActionProtection = off; ext.SafeMode = false; ext.Write();
        } catch (e) { log("NOTE=" + e.message.replace(/\s+/g, " ")); }
        log("RECONNECT=1");   // новое значение безопасного режима действует в новом сеансе
        c = null; CollectGarbage(); c = new ActiveXObject("V83.COMConnector").Connect(cs);
    }
    var m = c.АрмOData_Интерфейс;
    var r = m.ВключитьПолныйСоставOData();
    log("ENABLED=" + r.Включено);
    log("CANDIDATES=" + m.КоличествоКандидатовOData());
    var it = r.ПоВидам;
    var kinds = c.NewObject("СписокЗначений");
    for (var k = new Enumerator(it); !k.atEnd(); k.moveNext()) kinds.Add(k.item().Ключ, String(k.item().Значение));
    for (var i = 0; i < kinds.Count(); i++) log("KIND " + kinds.Get(i).Значение + "=" + kinds.Get(i).Представление);
    for (var i = 0; i < r.Пропущено.Количество(); i++) log("SKIPPED " + r.Пропущено.Получить(i));
    if (a.Length > 2 && a(2) == "list") {
        var names = String(m.ТекущийСоставOData()).split("\n");
        for (var i = 0; i < names.length; i++) if (names[i]) log("OBJ " + names[i]);
    }
} catch (e) { log("ERROR=" + e.message.replace(/\s+/g, " ")); }
OUT.Close();

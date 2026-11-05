// Выгрузка событий АРМ («АРМ.*») из журнала регистрации 1С для анализа ошибок. Запускает tools/arm-log-report.ps1.
//   cscript //E:JScript arm-log-report.js <строка соединения> <начало yyyyMMddHHmmss> <файл CSV> <файл сводки .md>
// Комментарий записей Арм_Журнал — строки «Ключ: значение» (Где, Пользователь, Контекст, Описание, Стек).
var fso = new ActiveXObject("Scripting.FileSystemObject");
var a = WScript.Arguments;

function writeUtf8(path, text) {
    var st = new ActiveXObject("ADODB.Stream");
    st.Type = 2; st.Charset = "utf-8"; st.Open(); st.WriteText(text); st.SaveToFile(path, 2); st.Close();
}
function field(comment, name) {
    var m = new RegExp("(^|\\n)" + name + ": ([^\\n]*)").exec(comment);
    return m ? m[2] : "";
}
function csv(v) { return '"' + String(v).replace(/"/g, '""').replace(/\r?\n/g, " ⏎ ") + '"'; }

var conn, start;
try {
    conn = new ActiveXObject("V83.COMConnector").Connect(a(0));
    var s = a(1);
    start = new Date(+s.substr(0, 4), +s.substr(4, 2) - 1, +s.substr(6, 2), +s.substr(8, 2), +s.substr(10, 2), +s.substr(12, 2)).getVarDate();
} catch (e) { WScript.Echo("ОШИБКА подключения: " + e.message); WScript.Quit(2); }
try {
    var tbl = conn.NewObject("ТаблицаЗначений");
    var flt = conn.NewObject("Структура");
    flt.Insert("StartDate", start);
    conn.UnloadEventLog(tbl, flt);

    var lines = ["Дата;Событие;Уровень;Пользователь ИБ;Где;Описание;Контекст;Комментарий"];
    var groups = {}, total = 0;
    for (var i = 0; i < tbl.Count(); i++) {
        var r = tbl.Get(i), ev = String(r.Событие);
        if (ev.indexOf("АРМ.") !== 0) continue;
        total++;
        var com = String(r.Комментарий), where = field(com, "Где") || "(без «Где»)", descr = field(com, "Описание") || com.split("\n")[0];
        lines.push([csv(conn.String(r.Дата)), csv(ev), csv(conn.String(r.Уровень)), csv(String(r.ИмяПользователя)),
            csv(where), csv(descr), csv(field(com, "Контекст")), csv(com)].join(";"));
        var k = ev + " | " + where;
        var g = groups[k] || (groups[k] = { ev: ev, where: where, n: 0, first: conn.String(r.Дата), last: "", sample: "" });
        g.n++; g.last = conn.String(r.Дата); g.sample = com;
    }
    writeUtf8(a(2), lines.join("\r\n") + "\r\n");

    var keys = [];
    for (var k in groups) keys.push(k);
    keys.sort(function (x, y) {
        var ex = groups[x].ev === "АРМ.Ошибка" ? 0 : 1, ey = groups[y].ev === "АРМ.Ошибка" ? 0 : 1;
        return ex !== ey ? ex - ey : groups[y].n - groups[x].n;
    });
    var md = ["# События АРМ в журнале регистрации", "", "- База: `" + a(0).replace(/Pwd="[^"]*"/, 'Pwd="***"') + "`",
        "- С: " + conn.String(start) + ", записей «АРМ.*»: " + total, "- Подробно (все записи): `" + a(2) + "`", "",
        "| Событие | Где | Сколько | Первое | Последнее |", "|---|---|---|---|---|"];
    for (var i = 0; i < keys.length; i++) {
        var g = groups[keys[i]];
        md.push("| " + g.ev + " | `" + g.where + "` | " + g.n + " | " + g.first + " | " + g.last + " |");
    }
    md.push("", "## Последний пример каждой ошибки", "");
    for (var i = 0; i < keys.length; i++) {
        var g = groups[keys[i]];
        if (g.ev !== "АРМ.Ошибка") continue;
        md.push("### " + g.where + " (" + g.n + ")", "", "```text", g.sample, "```", "");
    }
    writeUtf8(a(3), md.join("\r\n") + "\r\n");
} catch (e) { WScript.Echo("ОШИБКА: " + e.message); WScript.Quit(1); }

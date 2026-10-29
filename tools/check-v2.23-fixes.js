// Проверка исправлений АРМ v2.23 (блок 1 плана) на КОПИИ базы через COM под пользователем с ролью АРМ «Менеджер».
// Меняет данные: строки заказа НФНФ-000002 копии vitauto (ключи 08cce359, 7ed5b952, abc4d61d), пересчитывает остатки,
// вычеркивает и возвращает строку. Только на копии!   cscript //E:JScript check-v2.23-fixes.js <отчёт> <база> [<пользователь>]
var fso = new ActiveXObject("Scripting.FileSystemObject"), OUT = fso.CreateTextFile(WScript.Arguments(0), true, true);
function log(s) { OUT.WriteLine(s); }
var fails = 0;
if (/^(vitauto|autoservice|autoservice_main)$/i.test(WScript.Arguments(1))) { log("ERROR " + WScript.Arguments(1) + " — рабочая база, тест только для копии"); OUT.Close(); WScript.Quit(2); }
function check(name, ok, details) { if (!ok) fails++; log((ok ? "PASS " : "FAIL ") + name + (details ? " — " + details : "")); }
try {
var c = new ActiveXObject("V83.COMConnector").Connect('Srvr="localhost";Ref="' + WScript.Arguments(1) + '";Usr="' + (WScript.Arguments.length > 2 ? WScript.Arguments(2) : "Автосервис") + '";Pwd=""');
var A = c.Арм_ОбщегоНазначенияАРМ, REG = c.РегистрыСведений.Арм_ДанныеЗакупокИПродаж;
var ST = c.Перечисления.Арм_СтатусыАРМ, OP = c.Перечисления.Арм_ВидыОпераций, ME = c.ПараметрыСеанса.ТекущийПользователь;
function S(v) { return c.String(v); }

function fullKey(prefix) {
  var q = c.NewObject("Запрос");
  q.Текст = "ВЫБРАТЬ ПЕРВЫЕ 1 Т.КлючСвязиСтрок КАК К ИЗ РегистрСведений.Арм_ДанныеЗакупокИПродаж КАК Т ГДЕ Т.КлючСвязиСтрок ПОДОБНО &П";
  q.УстановитьПараметр("П", prefix + "%");
  var v = q.Выполнить().Выбрать(); v.Следующий(); return v.К;
}
function recs(key, op) {   // массив JS снимков записей ключа
  var rs = REG.СоздатьНаборЗаписей(); rs.Отбор.КлючСвязиСтрок.Установить(key); rs.Прочитать();
  var r = [];
  for (var i = 0; i < rs.Количество(); i++) { var z = rs.Получить(i);
    if (op && S(z.ВидОперации) != S(op)) continue;
    r.push({ id: z.ИдентификаторЗаписи, st: S(z.СтатусСтроки), qty: z.Количество, price: z.Цена, ord: z.Порядок,
      sup: S(z.Поставщик), cmt: z.КомментарийКСтроке, del: z.Удаление, nom: z.Номенклатура, doc: z.ДокументЗаказПокупателя }); }
  return r;
}
function update(key, op, fn) {     // правка записей ключа нужного вида операции
  var rs = REG.СоздатьНаборЗаписей(); rs.Отбор.КлючСвязиСтрок.Установить(key); rs.Прочитать();
  for (var i = 0; i < rs.Количество(); i++) { var z = rs.Получить(i); if (S(z.ВидОперации) == S(op)) fn(z); }
  rs.Записать();
}
function inOrder(doc, key) {
  var o = doc.ПолучитьОбъект(), n = 0;
  for (var i = 0; i < o.Запасы.Количество(); i++) if (S(o.Запасы.Получить(i).КлючСвязиСтрок) == S(key)) n++;
  return n;
}
function arr(list) { var a = c.NewObject("Массив"); for (var i = 0; i < list.length; i++) a.Добавить(list[i]); return a; }
function jsArr(a) { var r = []; for (var i = 0; i < a.Количество(); i++) r.push(a.Получить(i)); return r; }
var workSt = arr([ST.Черновик, ST.ВРаботе]);

// --- 1.2: закупка в работе не переписывается пересчётом
var K1 = fullKey("08cce359");
update(K1, OP.Закупка, function (z) { z.СтатусСтроки = ST.ВРаботе; z.Цена = 1200; z.Порядок = 5; });
var sale1 = recs(K1, OP.Продажа)[0];
A.ПолучитьОстаткиПоСтрокам(sale1.nom, sale1.doc);
var p1 = recs(K1, OP.Закупка);
log("1.2 закупки ключа после пересчёта: " + p1.length + "; " + (p1.length ? p1[0].st + ", цена " + p1[0].price + ", порядок " + p1[0].ord + ", кол-во " + p1[0].qty : ""));
log("1.2 продажи ключа: " + (function () { var r = recs(K1, OP.Продажа), s = []; for (var i = 0; i < r.length; i++) s.push(r[i].qty + " " + r[i].st); return s.join("; "); })());
var inWork = null; for (var i = 0; i < p1.length; i++) if (p1[i].st == "В работе") inWork = p1[i];
check("1.2 закупка «В работе» сохранила цену и порядок", inWork != null && inWork.price == 1200 && inWork.ord == 5,
  inWork ? "цена " + inWork.price + ", порядок " + inWork.ord : "закупки «В работе» нет");
check("1.2 нет лишней черновой закупки (потребность покрыта)", p1.length == 1, "закупок: " + p1.length);

// --- 1.4: поставщик, цена, комментарий черновой авто-закупки переживают пересчёт
var K2 = fullKey("7ed5b952");
var sup = c.Справочники.Контрагенты.Выбрать(); sup.Следующий(); var supRef = sup.Ссылка;
update(K2, OP.Закупка, function (z) { z.Поставщик = supRef; z.Цена = 777; z.КомментарийКСтроке = "тест v2.23"; });
var before2 = recs(K2, OP.Закупка)[0];
var sale2 = recs(K2, OP.Продажа)[0];
A.ПолучитьОстаткиПоСтрокам(sale2.nom, sale2.doc);
var p2 = recs(K2, OP.Закупка);
log("1.4 закупки ключа после пересчёта: " + p2.length + (p2.length ? "; " + p2[0].st + ", " + p2[0].sup + ", цена " + p2[0].price + ", «" + p2[0].cmt + "»" : ""));
check("1.4 поставщик сохранился", p2.length == 1 && p2[0].sup == S(supRef), p2.length ? p2[0].sup : "закупки нет");
check("1.4 цена и комментарий сохранились", p2.length == 1 && p2[0].price == 777 && p2[0].cmt == "тест v2.23");
check("1.4 идентификатор записи тот же", p2.length == 1 && p2[0].id == before2.id);

// --- 1.3: «Заказать» по отмеченной закупке одной позиции из трёх — вопрос о сплите.
// Как в Т6А: закупка есть только у этой позиции (закупки двух других временно вычеркнуты).
var K3 = fullKey("abc4d61d");
A.ВычеркнутьСтрокиПоКлючам(arr([K3]), false);       // после прошлых прогонов строка могла остаться вычеркнутой
update(K1, OP.Закупка, function (z) { z.Удаление = true; });
update(K2, OP.Закупка, function (z) { z.Удаление = true; });
update(K3, OP.Закупка, function (z) { z.ОтметкаСтроки = true; z.АвторСтроки = ME; });
var sale3 = recs(K3, OP.Продажа)[0];
var P = c.NewObject("Структура");
P.Вставить("ТекущийПользователь", ME); P.Вставить("МассивКлючей", arr([K3])); P.Вставить("МассивЗаказов", arr([sale3.doc]));
var addr = c.ПоместитьВоВременноеХранилище(null, c.NewObject("УникальныйИдентификатор")); P.Вставить("АдресРезультата", addr);
P.Вставить("РазрешитьСплит", false);
c.Арм_ДанныеЗакупокИПродажФон.СформироватьЗаказыФоновоеЗадание(P);
var R = c.ПолучитьИзВременногоХранилища(addr);
log("1.3 итог: Успешно=" + R.Успешно + ", СтатусВалидации=" + R.СтатусВалидации + ", выбрано " + R.ВсегоВыбраноШтук + " из " + R.ВсегоВБазеШтук + "; " + R.ТекстОшибки);
check("1.3 сплит требует подтверждения", R.СтатусВалидации == "ТребуетсяПодтверждениеМенеджера");
check("1.3 штуки считаются по продажам заказа", R.ВсегоВыбраноШтук == sale3.qty && R.ВсегоВБазеШтук > sale3.qty, R.ВсегоВыбраноШтук + " из " + R.ВсегоВБазеШтук);
update(K3, OP.Закупка, function (z) { z.ОтметкаСтроки = false; z.АвторСтроки = c.Справочники.Пользователи.ПустаяСсылка(); });
update(K1, OP.Закупка, function (z) { z.Удаление = false; });
update(K2, OP.Закупка, function (z) { z.Удаление = false; });

// --- Т7: вычеркнуть и вернуть строку
update(K3, OP.Продажа, function (z) { z.ОтметкаСтроки = true; z.АвторСтроки = ME; });
var keys = A.ПолучитьМассивОтмеченныхКлючейСвязи(workSt);
check("Т7 отмеченный ключ найден", jsArr(keys).length == 1 && jsArr(keys)[0] == K3, jsArr(keys).length + " ключей");
A.ВычеркнутьСтрокиПоКлючам(keys);
var s3 = recs(K3, OP.Продажа)[0];
check("Т7 строка вычеркнута и ушла из заказа", s3.del && inOrder(sale3.doc, K3) == 0, "удаление " + s3.del + ", строк в заказе " + inOrder(sale3.doc, K3));
update(K3, OP.Продажа, function (z) { z.ОтметкаСтроки = true; z.АвторСтроки = ME; });
check("Т7 по умолчанию вычеркнутая не выбирается (как v2.22)", jsArr(A.ПолучитьМассивОтмеченныхКлючейСвязи(workSt)).length == 0);
var keys2 = A.ПолучитьМассивОтмеченныхКлючейСвязи(workSt, null, true);
check("Т7 ВключаяВычеркнутые выбирает вычеркнутую", jsArr(keys2).length == 1, jsArr(keys2).length + " ключей");
A.ВычеркнутьСтрокиПоКлючам(keys2);
s3 = recs(K3, OP.Продажа)[0];
var pur3 = recs(K3, OP.Закупка);
check("Т7 строка возвращена: не вычеркнута, «В работе», снова в заказе", !s3.del && s3.st == "В работе" && inOrder(sale3.doc, K3) == 1,
  "удаление " + s3.del + ", " + s3.st + ", строк в заказе " + inOrder(sale3.doc, K3));
check("Т7 закупка ключа тоже возвращена", pur3.length > 0 && !pur3[0].del);
} catch (e) { fails++; log("ERROR " + e.message); }
log(fails ? "ИТОГ: ошибок " + fails : "ИТОГ: все проверки пройдены");
OUT.Close();

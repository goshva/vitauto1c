# ENV-1..4: окружение стенда (только чтение)
$out = @()
foreach ($s in 'pgsql-18-1c', '1C_8.3_Agent', '1C_8.3_RAS') { $x = Get-Service $s -ErrorAction SilentlyContinue; $out += "ENV-1 служба $s : $(if ($x) { $x.Status } else { 'НЕТ' })" }
foreach ($p in 5433, 1540, 1541, 1545, 8090) { $c = Test-NetConnection 127.0.0.1 -Port $p -WarningAction SilentlyContinue; $out += "ENV-1 порт $p : $(if ($c.TcpTestSucceeded) { 'OK' } else { 'ЗАКРЫТ' })" }
$h = @{Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('arm.manager:1'))}
foreach ($pub in 'e2e', 'mirror') {
  try { $r = Invoke-WebRequest -UseBasicParsing -Headers $h "http://127.0.0.1:8090/$pub/odata/standard.odata/`$metadata" -TimeoutSec 60; $out += "ENV-2 /$pub arm.manager : $($r.StatusCode)" }
  catch { $out += "ENV-2 /$pub arm.manager : ОШИБКА $($_.Exception.Message)" }
}
$tmp = 'D:\1c\e2e\tmp'; New-Item -ItemType Directory -Force $tmp | Out-Null
$js = @'
var fso = new ActiveXObject("Scripting.FileSystemObject"), a = WScript.Arguments;
var f = fso.OpenTextFile(a(0), 1, false, -1), cs = f.ReadAll(); f.Close();
var o = fso.CreateTextFile(a(1), true, true);
try { var c = new ActiveXObject("V83.COMConnector").Connect(cs); var e = c.РасширенияКонфигурации.Получить();
  for (var i = 0; i < e.Количество(); i++) { var x = e.Получить(i); o.WriteLine(x.Имя + " " + x.Версия + " активно=" + x.Активно); } }
catch (er) { o.WriteLine("ERROR " + er.message); }
o.Close();
'@
[IO.File]::WriteAllText("$tmp\ext.js", $js, [Text.Encoding]::Unicode)
foreach ($b in @(@('mirror', 'Srvr="localhost";Ref="vitauto_mirror";Usr="Автосервис";Pwd=""'), @('file', 'File="D:\1c_bases\autoservice";Usr="Админ";Pwd=""'))) {
  [IO.File]::WriteAllText("$tmp\c.txt", $b[1], [Text.Encoding]::Unicode)
  & "$env:WINDIR\SysWOW64\cscript.exe" //nologo //E:JScript "$tmp\ext.js" "$tmp\c.txt" "$tmp\ext-out.txt" | Out-Null
  foreach ($l in [IO.File]::ReadAllLines("$tmp\ext-out.txt", [Text.Encoding]::Unicode)) { $out += "ENV-3 $($b[0]): $l" }
}
$info = & 'D:\Program Files\1cv8\8.3.27.2342\bin\rac.exe' localhost:1545 cluster list 2>$null | Select-String '^cluster\s+:\s+(\S+)'
if ($info) {
  $cl = $info.Matches[0].Groups[1].Value
  $list = & 'D:\Program Files\1cv8\8.3.27.2342\bin\rac.exe' localhost:1545 infobase summary list --cluster=$cl
  for ($i = 0; $i -lt $list.Count; $i++) { if ($list[$i] -match '^name\s+:\s+vitauto_mirror') { $ib = ($list[$i - 1] -split ':\s+')[1].Trim() } }
  $ii = & 'D:\Program Files\1cv8\8.3.27.2342\bin\rac.exe' localhost:1545 infobase info --cluster=$cl --infobase=$ib --infobase-user=Автосервис --infobase-pwd= 2>&1
  $out += "ENV-4 зеркало: " + (($ii | Select-String 'scheduled-jobs-deny|sessions-deny') -join '; ')
}
$out | Out-File -Encoding utf8 D:\1c\logs\env-check.txt

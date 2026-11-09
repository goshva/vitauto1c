const http = require('http');

function req(method, path, body, token) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Accept': 'application/json' };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request({ host: '127.0.0.1', port: 18100, method, path: '/api/v1' + path, headers }, (res) => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => resolve({ code: res.statusCode, body: out }));
    });
    r.on('error', e => resolve({ code: 0, body: String(e) }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const login = await req('POST', '/session', { login: 'ГлавныйМеханик', password: 'chief123' });
  if (login.code !== 201) { console.log('LOGIN FAIL', login.code, login.body.slice(0, 200)); return; }
  const token = JSON.parse(login.body).token;

  const list = await req('GET', '/work-orders', null, token);
  console.log('LIST', list.code, list.body.slice(0, 200));
  const id = JSON.parse(list.body)[0].id;

  const print = await req('POST', '/print', { kind: 'work_order', workOrderIds: [id] }, token);
  console.log('PRINT', print.code);
  if (print.code === 200) {
    const html = JSON.parse(print.body).html || '';
    console.log('  len:', html.length);
    for (const probe of ['Работы:', 'н/ч', 'сумма:', 'Итого:', 'Позиций:', 'Заказ-наряд №']) {
      console.log(`  ${html.includes(probe) ? 'OK ' : 'MISS'} ${probe}`);
    }
    const m = html.match(/<p class="total">Работы:[^<]*<\/p>/);
    console.log('  строка «Работы»:', m ? m[0] : 'нет');
    const g = html.match(/<p class="grand">[^<]*<\/p>/);
    console.log('  строка «Итого»:', g ? g[0] : 'нет');
  } else {
    console.log('  body:', print.body.slice(0, 400));
  }
})();

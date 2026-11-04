const http = require('http');

const users = [
  { login: 'Администратор', password: 'admin123', role: 'admin' },
  { login: 'Менеджер', password: 'manager123', role: 'manager' },
  { login: 'Снабженец', password: 'supply123', role: 'supply' },
  { login: 'Кладовщик', password: 'storekeeper123', role: 'storekeeper' },
  { login: 'ГлавныйМеханик', password: 'chief123', role: 'chief' },
];

const api = 'http://localhost:18100';

function postLogin({ login, password }) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ login, password });
    const req = http.request(api + '/api/v1/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ code: res.statusCode, body: data }));
    });
    req.on('error', () => resolve({ code: 0, body: 'CONN_ERR' }));
    req.write(body);
    req.end();
  });
}

function getLines(token) {
  return new Promise((resolve) => {
    const req = http.get(api + '/api/v1/lines?status=Выполнено', {
      headers: { 'Authorization': 'Bearer ' + token },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ code: res.statusCode, body: data }));
    });
    req.on('error', () => resolve({ code: 0, body: 'CONN_ERR' }));
    req.end();
  });
}

(async () => {
  for (const u of users) {
    const loginRes = await postLogin(u);
    if (loginRes.code !== 201) {
      console.log(`${u.role.padEnd(12)} LOGIN FAIL: ${loginRes.body.slice(0, 60)}`);
      continue;
    }
    const session = JSON.parse(loginRes.body);
    const token = session.token;

    const linesRes = await getLines(token);
    const parsed = JSON.parse(linesRes.body);
    const items = parsed.items || parsed.data || [];
    
    // Показать первую строку если есть
    let preview = '';
    if (items.length > 0) {
      const first = items[0];
      preview = JSON.stringify(first).slice(0, 150);
    }
    
    console.log(`${u.role.padEnd(12)} lines(${items.length}): ${preview}`);
  }
})();

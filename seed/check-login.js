const http = require('http');

const users = [
  { login: 'Администратор', password: 'admin123' },
  { login: 'Менеджер', password: 'manager123' },
  { login: 'Снабженец', password: 'supply123' },
  { login: 'Кладовщик', password: 'storekeeper123' },
  { login: 'ГлавныйМеханик', password: 'chief123' },
  { login: 'arm.manager', password: '1' },
];

const api = 'http://localhost:18100/api/v1/session';

function postLogin({ login, password }) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ login, password });
    const req = http.request(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ code: res.statusCode, body: data }));
    });
    req.on('error', () => resolve({ code: 0, body: 'CONNECTION_ERROR' }));
    req.write(body);
    req.end();
  });
}

(async () => {
  for (const u of users) {
    const r = await postLogin(u);
    const token = r.code === 201 ? 'OK' : r.body.slice(0, 80);
    console.log(`${u.login.padEnd(20)} -> HTTP ${r.code}  ${token}`);
  }
})();

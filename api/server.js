'use strict';
// Запуск: node server.js   (из папки api)
//   PORT                 — порт, по умолчанию 8787
//   HOST                 — адрес, по умолчанию 127.0.0.1 (только эта машина)
//   VITAUTO_API_DATA     — каталог хранилища, по умолчанию api/data
//   VITAUTO_ADMIN_TOKEN  — токен администратора при первом запуске (иначе случайный, печатается в консоль)
const path = require('path');
const { createApp } = require('./lib/app');

const port = parseInt(process.env.PORT, 10) || 8787;
const host = process.env.HOST || '127.0.0.1';
const dataDir = process.env.VITAUTO_API_DATA || path.join(__dirname, 'data');

const { server } = createApp({ dataDir, adminToken: process.env.VITAUTO_ADMIN_TOKEN });
server.listen(port, host, () => {
  console.log(`API: http://${host}:${port}/api/v1   Swagger: http://${host}:${port}/docs   Данные: ${dataDir}`);
});

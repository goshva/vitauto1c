import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

// /odata/... проксируется на стандартный интерфейс OData публикации 1С: <ODATA_TARGET>/...
// По умолчанию — тестовая база D:/1c/test_v215 (публикация /odata215 с расширением АРМ_OData);
// другая публикация — ODATA_TARGET=http://<сервер>/<публикация>/odata/standard.odata (или .env.local).
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const target = env.ODATA_TARGET || 'http://127.0.0.1:8090/odata215/odata/standard.odata';
  const proxy = {
    '/odata': {
      target,
      changeOrigin: true,
      rewrite: path => path.replace(/^\/odata/, ''),
      // 1С недоступна — понятная ошибка OData вместо пустого 500
      configure: proxyServer => proxyServer.on('error', (err, req, res) => {
        if (!res || res.headersSent || typeof res.writeHead !== 'function') return;
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ 'odata.error': { code: 'api_unavailable', message: { lang: 'ru',
          value: `Публикация OData 1С ${target} недоступна (${err.code || err.message}): запущен ли Apache (npm run api)?` } } }));
      })
    }
  };
  return {
    plugins: [
      vue(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'АРМ закупок и продаж (OData)',
          short_name: 'АРМ',
          description: 'Клиент АРМ через стандартный интерфейс OData 1С',
          lang: 'ru',
          theme_color: '#2563eb',
          orientation: 'portrait-primary',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
          ]
        },
        workbox: {
          // OData не кэшируется: данные АРМ всегда с сервера
          navigateFallbackDenylist: [/^\/odata\//],
          runtimeCaching: [{ urlPattern: /^\/odata\//, handler: 'NetworkOnly' }]
        },
        devOptions: { enabled: true }
      })
    ],
    // 127.0.0.1, а не localhost: в Windows Node слушает только ::1, и часть клиентов не подключается
    server: { host: '127.0.0.1', port: 5173, proxy },
    preview: { host: '127.0.0.1', port: 4173, proxy }
  };
});

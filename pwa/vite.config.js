import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

// /api/arm/v1/... проксируется на публикацию 1С: <ARM_API_TARGET>/arm/v1/...
// По умолчанию — рабочая база (публикация /autoservice из tools/arm-api-1c/deploy-prod.ps1);
// `npm run dev:test` — тестовая копия D:\1c\test_fresh (/vitauto, .env.test).
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const target = env.ARM_API_TARGET || 'http://127.0.0.1:8090/autoservice/hs/api';
  const proxy = {
    '/api': {
      target,
      changeOrigin: true,
      rewrite: path => path.replace(/^\/api/, ''),
      // 1С недоступна — понятный Problem вместо пустого 500
      configure: proxyServer => proxyServer.on('error', (err, req, res) => {
        if (!res || res.headersSent || typeof res.writeHead !== 'function') return;
        res.writeHead(502, { 'Content-Type': 'application/problem+json; charset=utf-8' });
        res.end(JSON.stringify({
          code: 'api_unavailable',
          message: `Публикация 1С ${target} недоступна (${err.code || err.message}). Запустите: npm run api`
        }));
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
          name: 'АРМ закупок и продаж — тест API',
          short_name: 'АРМ API',
          description: 'Тестовый клиент REST API АРМ (1С, Арм_API)',
          lang: 'ru',
          theme_color: '#1f6feb',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
          ]
        },
        workbox: {
          // API не кэшируется: данные АРМ всегда с сервера
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [{ urlPattern: /^\/api\//, handler: 'NetworkOnly' }]
        },
        devOptions: { enabled: true }
      })
    ],
    // 127.0.0.1, а не localhost: в Windows Node слушает только ::1, и часть клиентов не подключается
    server: { host: '127.0.0.1', port: 5173, proxy },
    preview: { host: '127.0.0.1', port: 4173, proxy }
  };
});

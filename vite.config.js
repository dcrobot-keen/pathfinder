import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      // more specific path first: Vite checks proxy entries in declaration
      // order, so /api/path must be matched before the general /api rule.
      '/api/path': 'http://localhost:3002',
      // ws: true -- /api/live-pose/stream은 WebSocket 업그레이드가 필요하다
      // (server/index.mjs). 나머지 /api/* 경로는 평범한 HTTP라 영향 없음.
      '/api': { target: 'http://localhost:3001', ws: true },
    },
  },
});

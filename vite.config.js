import { defineConfig } from 'vite';

export default defineConfig({
  // src/appShared.js가 활성 프로젝트를 top-level await로 고른다 -- 기본 타깃(es2020)은 이를 거절해
  // `vite build`가 실패했었다. 개발 서버에는 영향이 없었고, 최신 Chromium만 대상이라 esnext로 둔다.
  build: { target: 'esnext' },
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

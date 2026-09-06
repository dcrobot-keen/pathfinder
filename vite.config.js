import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

let buildHash = 'dev';
try { buildHash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* git 없음 */ }

export default defineConfig({
  // 왼쪽 내비 하단 '버전 · 빌드' 표기 (지원 문의 때 어떤 빌드인지 알기 위해)
  define: { __BUILD_HASH__: JSON.stringify(buildHash) },
  // src/appShared.js가 활성 프로젝트를 top-level await로 고른다 -- 기본 타깃(es2020)은 이를 거절해
  // `vite build`가 실패했었다. 개발 서버에는 영향이 없었고, 최신 Chromium만 대상이라 esnext로 둔다.
  build: { target: 'esnext' },
  server: {
    port: 3000,
    proxy: {
      // more specific path first: Vite checks proxy entries in declaration
      // order, so /api/path and /api/scan-studio must be matched before the general /api rule.
      '/api/path': 'http://localhost:3002',
      // scan-engine(FastAPI) 전체를 경로 그대로: /scan-engine/api/groups -> :8000/api/groups (openapi-fetch 클라이언트가 씀)
      '/scan-engine': {
        target: 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/scan-engine/, ''),
      },
      '/api/scan-studio': {
        target: 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/api\/scan-studio/, '/api'),
      },
      '/scan-files': {
        target: 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/scan-files/, '/files'),
      },
      // ws: true -- /api/live-pose/stream은 WebSocket 업그레이드가 필요하다
      // (server/index.mjs). 나머지 /api/* 경로는 평범한 HTTP라 영향 없음.
      '/api': { target: 'http://localhost:3001', ws: true },

    },
  },
});

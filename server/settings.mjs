// 서비스 주소 등 현장 공통 설정 -- 브라우저 localStorage 가 아니라 서버(data/settings.json)에 둔다.
// 다른 PC 에서 Fleet Studio 를 열어도 같은 주소를 쓰고, 설정 화면의 "도구" 링크와 임베드가 이 값을 본다.
//   GET  /api/settings/services            -> { services: { simViewer, studio, navBrain, vpsServer, scanEngine } }
//   PUT  /api/settings/services  { services } -> 저장된 값 (빈 문자열은 기본값으로)
import { Router } from 'express';
import { JSONFilePreset } from 'lowdb/node';
import { resolve } from 'node:path';

export const DEFAULT_SERVICES = {
  simViewer: 'http://localhost:8767',
  studio: 'http://localhost:8000/groups',
  scanEngine: 'http://localhost:8000',
  navBrain: 'http://localhost:5173/apps/dashboard/nav.html',
  vpsServer: 'http://localhost:8080',
};

function sanitize(input) {
  const out = { ...DEFAULT_SERVICES };
  for (const key of Object.keys(DEFAULT_SERVICES)) {
    const v = input?.[key];
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t) continue;
    if (!/^https?:\/\//i.test(t)) throw Object.assign(new Error(`${key}: http(s):// 주소여야 합니다`), { status: 400 });
    out[key] = t;
  }
  return out;
}

export async function createSettingsRouter(dataDir) {
  const db = await JSONFilePreset(resolve(dataDir, 'settings.json'), { services: { ...DEFAULT_SERVICES } });
  const router = Router();
  router.get('/settings/services', (req, res) => {
    res.json({ services: { ...DEFAULT_SERVICES, ...(db.data.services ?? {}) }, defaults: DEFAULT_SERVICES });
  });
  router.put('/settings/services', async (req, res) => {
    try {
      db.data.services = sanitize(req.body?.services ?? req.body);
      await db.write();
      res.json({ services: db.data.services, defaults: DEFAULT_SERVICES });
    } catch (err) {
      res.status(err.status ?? 400).json({ error: err.message });
    }
  });
  return router;
}

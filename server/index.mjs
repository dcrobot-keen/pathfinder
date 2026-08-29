// 노드/링크/블록 편집 결과를 GeoJSON 파일 DB(lowdb)에 저장하는 초경량 API 서버.
// db.data가 그대로 파일에 쓰이므로, 저장 파일(data/nodelink.geojson) 자체가
// 유효한 GeoJSON FeatureCollection이 되어 QGIS 등 다른 GIS 툴에서도 바로 열린다.
import express from 'express';
import { JSONFilePreset } from 'lowdb/node';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { createRobotsRouter } from './robots.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../data/nodelink.geojson');
const IMPORTED_DIR = resolve(__dirname, '../data/imported');
const DEFAULT_FC = { type: 'FeatureCollection', features: [] };
const ROOM_NAME_RE = /^[a-zA-Z0-9_-]+$/;

const db = await JSONFilePreset(DB_PATH, DEFAULT_FC);

function isFeatureCollection(body) {
  return (
    body &&
    body.type === 'FeatureCollection' &&
    Array.isArray(body.features)
  );
}

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use('/api', await createRobotsRouter());

app.get('/api/nodelink', (req, res) => {
  res.json(db.data);
});

app.put('/api/nodelink', async (req, res) => {
  if (!isFeatureCollection(req.body)) {
    res.status(400).json({ error: '요청 본문이 유효한 GeoJSON FeatureCollection이 아닙니다.' });
    return;
  }
  db.data = req.body;
  await db.write();
  res.json({ ok: true, featureCount: db.data.features.length });
});

// scripts/import-scan-to-map-studio.mjs가 data/imported/<room>.geojson에 미리
// 써둔 결과를 읽기 전용으로 서빙한다. data/nodelink.geojson(위)과 달리 여기는
// 쓰기 API가 없다 -- 갱신은 항상 스크립트를 다시 실행해서 파일을 통째로 교체하는
// 방식으로만 이뤄진다(사용자가 손으로 편집하는 데이터가 아니므로).
app.get('/api/imported-obstacles', async (req, res) => {
  const files = await readdir(IMPORTED_DIR).catch(() => []);
  const rooms = files.filter((f) => f.endsWith('.geojson')).map((f) => f.slice(0, -'.geojson'.length));
  res.json({ rooms });
});

app.get('/api/imported-obstacles/:room', async (req, res) => {
  const { room } = req.params;
  if (!ROOM_NAME_RE.test(room)) {
    res.status(400).json({ error: '올바르지 않은 room 이름입니다.' });
    return;
  }
  try {
    const content = await readFile(resolve(IMPORTED_DIR, `${room}.geojson`), 'utf-8');
    res.json(JSON.parse(content));
  } catch {
    res.status(404).json({ error: `"${room}" 가져오기 결과를 찾을 수 없습니다.` });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`node-link API 서버 실행 중: http://localhost:${PORT} (DB: ${DB_PATH})`);
});

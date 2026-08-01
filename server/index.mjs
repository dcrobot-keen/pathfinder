// 노드/링크/블록 편집 결과를 GeoJSON 파일 DB(lowdb)에 저장하는 초경량 API 서버.
// db.data가 그대로 파일에 쓰이므로, 저장 파일(data/nodelink.geojson) 자체가
// 유효한 GeoJSON FeatureCollection이 되어 QGIS 등 다른 GIS 툴에서도 바로 열린다.
import express from 'express';
import { JSONFilePreset } from 'lowdb/node';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../data/nodelink.geojson');
const DEFAULT_FC = { type: 'FeatureCollection', features: [] };

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`node-link API 서버 실행 중: http://localhost:${PORT} (DB: ${DB_PATH})`);
});

// 노드/링크/블록 편집 결과를 GeoJSON 파일 DB(lowdb)에 저장하는 초경량 API 서버.
// db.data가 그대로 파일에 쓰이므로, 저장 파일(data/nodelink.geojson) 자체가
// 유효한 GeoJSON FeatureCollection이 되어 QGIS 등 다른 GIS 툴에서도 바로 열린다.
import express from 'express';
import { JSONFilePreset } from 'lowdb/node';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
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

// 실시간 로봇 위치 릴레이 -- vps-system(/localize)에서 계산해 scan-to-map-studio의
// registration_transform.json으로 map 프레임으로 옮긴 pose를(둘 다 ROS 없이,
// src/livePoseTransform.js 참고) 캡처 브리지 페이지가 PUT으로 밀어넣으면, 그걸
// 구독 중인 모든 pathfinder 브라우저 탭에 WebSocket으로 그대로 fan-out한다.
// 발행자는 하나(또는 소수), 구독자는 여럿인 비대칭 구조라 수신은 평범한 HTTP PUT,
// 배포만 WebSocket으로 밀어주는 쪽이 양방향 WebSocket보다 더 단순하다.
// data/nodelink.geojson과 달리 이 상태는 파일에 저장하지 않는다 -- 로봇이 "지금
// 어디 있는지"는 재시작하면 다시 받으면 그만인 휘발성 데이터다.
const latestPoseByRobot = new Map(); // robotId -> { x, y, headingRad, timestamp }

function isLivePose(body) {
  return (
    body &&
    typeof body.x === 'number' &&
    typeof body.y === 'number' &&
    typeof body.headingRad === 'number'
  );
}

app.put('/api/live-pose/:robotId', (req, res) => {
  if (!isLivePose(req.body)) {
    res.status(400).json({ error: 'x, y, headingRad(모두 number)가 필요합니다.' });
    return;
  }
  const { robotId } = req.params;
  const pose = {
    x: req.body.x,
    y: req.body.y,
    headingRad: req.body.headingRad,
    timestamp: typeof req.body.timestamp === 'number' ? req.body.timestamp : Date.now(),
  };
  latestPoseByRobot.set(robotId, pose);
  broadcastPose(robotId, pose);
  res.json({ ok: true });
});

app.get('/api/live-pose', (req, res) => {
  res.json(Object.fromEntries(latestPoseByRobot));
});

const PORT = process.env.PORT || 3001;
const httpServer = createServer(app);

// noServer 모드로 만들고 /api/live-pose/stream 경로만 직접 라우팅한다 -- 이 서버가
// 나중에 다른 용도로 업그레이드 요청을 받게 되더라도(지금은 없음) 서로 다른 경로를
// 각자 검사 없이 가로채지 않도록.
const wss = new WebSocketServer({ noServer: true });
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url !== '/api/live-pose/stream') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  // 새로 붙은 탭이 다음 업데이트를 기다리지 않고 바로 현재 상태를 보게 한다.
  for (const [robotId, pose] of latestPoseByRobot) {
    ws.send(JSON.stringify({ robotId, pose }));
  }
});

function broadcastPose(robotId, pose) {
  const payload = JSON.stringify({ robotId, pose });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

httpServer.listen(PORT, () => {
  console.log(`node-link API 서버 실행 중: http://localhost:${PORT} (DB: ${DB_PATH})`);
});

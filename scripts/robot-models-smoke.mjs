// 로봇 모델 카탈로그(/api/robot-models)와 로봇 기기(/api/robots) 연결 관계 검증 스모크 테스트.
// 임시 PATHFINDER_DATA_DIR 환경에서 모델 CRUD, 기기 등록 시 모델 사양 상속,
// 하위 호환 필드(sizeMeters, speedMps, algorithm, type, icon) 전달을 검증한다.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import express from 'express';
import { createRobotModelsRouter } from '../server/robotModels.mjs';
import { createRobotsRouter } from '../server/robots.mjs';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

const dataDir = await mkdtemp(join(tmpdir(), 'pf-models-'));
process.env.PATHFINDER_DATA_DIR = dataDir;

const app = express();
app.use(express.json());
const modelsRouter = await createRobotModelsRouter();
app.use('/api', modelsRouter);
const robotsRouter = await createRobotsRouter(modelsRouter.models);
app.use('/api', robotsRouter);

const server = createServer(app);
await new Promise((res) => server.listen(0, '127.0.0.1', res));
const base = `http://127.0.0.1:${server.address().port}`;

const api = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// --- 1. 기본 모델 시드 확인 ---
let r = await api('GET', '/api/robot-models');
check('GET /api/robot-models returns pre-seeded catalog', r.status === 200 && Array.isArray(r.body) && r.body.length >= 5);
const tb3Model = r.body.find((m) => m.id === 'turtlebot3-burger');
check('turtlebot3-burger model has 0.2m size and 0.22m/s speed', tb3Model && tb3Model.sizeMeters === 0.2 && tb3Model.speedMps === 0.22);
const formerModel = r.body.find((m) => m.id === 'former-2-0');
check('former-2-0 model has 0.4m size and 1.0m/s speed', formerModel && formerModel.sizeMeters === 0.4 && formerModel.speedMps === 1.0);

// --- 2. 모델 단건 조회 및 에러 처리 ---
r = await api('GET', '/api/robot-models/turtlebot3-burger');
check('GET /api/robot-models/:id returns single model', r.status === 200 && r.body.name === 'TurtleBot3 Burger');
r = await api('GET', '/api/robot-models/non-existent');
check('GET /api/robot-models/:id 404 for unknown model', r.status === 404);

// --- 3. 새 커스텀 로봇 모델 생성 ---
r = await api('POST', '/api/robot-models', {
  id: 'custom-heavy-amr',
  name: 'Custom Heavy AMR 500',
  manufacturer: 'Custom Robotics',
  type: 'agv_amr',
  algorithm: 'hybridastar',
  sizeMeters: 1.2,
  speedMps: 2.0,
  description: '고중량 파렛트 이송용 500kg급 AMR',
});
check('POST /api/robot-models creates new model', r.status === 201 && r.body.id === 'custom-heavy-amr');
check('created model has specified specs', r.body.sizeMeters === 1.2 && r.body.algorithm === 'hybridastar');

// 중복 ID 방지
r = await api('POST', '/api/robot-models', {
  id: 'custom-heavy-amr',
  name: 'Duplicate',
});
check('POST /api/robot-models rejects duplicate id', r.status === 409);

// 모델 수정
r = await api('PUT', '/api/robot-models/custom-heavy-amr', {
  speedMps: 2.5,
});
check('PUT /api/robot-models/:id updates specification', r.status === 200 && r.body.speedMps === 2.5 && r.body.sizeMeters === 1.2);

// --- 4. 기기 등록 시 모델 사양 상속 확인 ---
r = await api('POST', '/api/robots', {
  name: 'heavy-bot-01',
  modelId: 'custom-heavy-amr',
  vda5050Serial: 'heavy-01',
  vda5050Manufacturer: 'Custom Robotics',
});
check('POST /api/robots with modelId succeeds', r.status === 201 && r.body.name === 'heavy-bot-01');
check('device inherits size, speed, algorithm from referenced model', r.body.sizeMeters === 1.2 && r.body.speedMps === 2.5 && r.body.algorithm === 'hybridastar');
check('device response includes model information object', r.body.model && r.body.model.id === 'custom-heavy-amr');

// 기기 모델 변경
r = await api('PUT', `/api/robots/${r.body.id}`, {
  modelId: 'turtlebot3-burger',
});
check('PUT /api/robots/:id updates modelId and inherits new specs', r.status === 200 && r.body.modelId === 'turtlebot3-burger' && r.body.sizeMeters === 0.2 && r.body.speedMps === 0.22);

// 모델 삭제
r = await api('DELETE', '/api/robot-models/custom-heavy-amr');
check('DELETE /api/robot-models/:id succeeds', r.status === 204);

server.close();
await rm(dataDir, { recursive: true, force: true });

console.log(failures === 0 ? '\nall robot-models smoke checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);

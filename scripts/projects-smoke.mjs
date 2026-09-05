// pathfinder의 프로젝트(다중 방/좌표 평면) 기능 스모크 테스트.
//
// server/index.mjs를 자식 프로세스로 띄우되, PATHFINDER_DATA_DIR로 임시
// 디렉터리를 지정해 이 저장소의 진짜 data/(사용자의 실제 편집 결과)는 절대
// 건드리지 않는다 -- 이 테스트가 프로젝트를 만들고 지우는 걸 반복해도 실제
// nodelink.geojson/projects.json에는 흔적이 안 남는다.
//
// 검증 범위: 시드된 "기본 프로젝트"가 기존 data/nodelink.geojson 경로를 그대로
// 쓰는지, 새 프로젝트가 완전히 독립된 nodelink를 갖는지(핵심 — 이게 안 되면
// "다중 방" 기능의 의미가 없다), 입력 검증(400/404)까지.
//
//   node scripts/projects-smoke.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

const PORT = 4792;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = await mkdtemp(join(tmpdir(), 'pathfinder-projects-smoke-'));

const server = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT), PATHFINDER_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let serverLog = '';
server.stdout.on('data', (d) => {
  serverLog += d.toString();
});
process.on('exit', () => server.kill());

try {
  const serverStart = Date.now();
  while (!serverLog.includes(`http://localhost:${PORT}`) && Date.now() - serverStart < 5000) {
    await wait(50);
  }
  check('서버가 기동됨', serverLog.includes(`http://localhost:${PORT}`));

  // --- 1. 시드된 기본 프로젝트 ---
  const listRes = await fetch(`http://localhost:${PORT}/api/projects`);
  const list = await listRes.json();
  check('GET /api/projects가 기본 프로젝트 1개를 시드해둠', list.length === 1 && list[0].id === 'default');
  check('기본 프로젝트 크기는 기존 200x400 그대로', list[0].sizeX === 200 && list[0].sizeY === 400);

  const defaultNodelinkRes = await fetch(`http://localhost:${PORT}/api/projects/default/nodelink`);
  const defaultNodelink = await defaultNodelinkRes.json();
  check(
    '기본 프로젝트의 nodelink는 빈 FeatureCollection으로 시작(임시 data 디렉터리라 기존 파일 없음)',
    defaultNodelink.type === 'FeatureCollection' && defaultNodelink.features.length === 0
  );

  // --- 2. 기본 프로젝트에 저장 ---
  const putDefaultRes = await fetch(`http://localhost:${PORT}/api/projects/default/nodelink`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { kind: 'node' }, geometry: { type: 'Point', coordinates: [1, 2] } }],
    }),
  });
  const putDefaultBody = await putDefaultRes.json();
  check('PUT .../default/nodelink -> 200', putDefaultRes.status === 200 && putDefaultBody.featureCount === 1);

  // --- 3. 새 프로젝트 생성 ---
  const createRes = await fetch(`http://localhost:${PORT}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '테스트 방', sizeX: 50, sizeY: 30 }),
  });
  const created = await createRes.json();
  check('POST /api/projects -> 201', createRes.status === 201);
  check('새 프로젝트가 요청한 이름/크기를 그대로 가짐', created.name === '테스트 방' && created.sizeX === 50 && created.sizeY === 30);
  check('새 프로젝트 id는 "default"와 다름(고유 id 발급)', typeof created.id === 'string' && created.id !== 'default');

  const listAfterCreateRes = await fetch(`http://localhost:${PORT}/api/projects`);
  const listAfterCreate = await listAfterCreateRes.json();
  check('GET /api/projects가 이제 2개를 보여줌', listAfterCreate.length === 2);

  // --- 4. 핵심: 새 프로젝트의 nodelink는 기본 프로젝트와 완전히 독립적이다 ---
  const newNodelinkBeforeRes = await fetch(`http://localhost:${PORT}/api/projects/${created.id}/nodelink`);
  const newNodelinkBefore = await newNodelinkBeforeRes.json();
  check(
    '새 프로젝트의 nodelink는 기본 프로젝트의 기존 데이터를 안 물려받고 비어 있음',
    newNodelinkBefore.features.length === 0
  );

  await fetch(`http://localhost:${PORT}/api/projects/${created.id}/nodelink`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'node' }, geometry: { type: 'Point', coordinates: [10, 20] } },
        { type: 'Feature', properties: { kind: 'node' }, geometry: { type: 'Point', coordinates: [30, 40] } },
      ],
    }),
  });

  const defaultAfterRes = await fetch(`http://localhost:${PORT}/api/projects/default/nodelink`);
  const defaultAfter = await defaultAfterRes.json();
  check(
    '새 프로젝트에 저장해도 기본 프로젝트의 데이터(피처 1개)는 그대로 -- 좌표 충돌/데이터 오염 없음',
    defaultAfter.features.length === 1
  );

  const newAfterRes = await fetch(`http://localhost:${PORT}/api/projects/${created.id}/nodelink`);
  const newAfter = await newAfterRes.json();
  check('새 프로젝트 자신의 저장은 정상 반영됨(피처 2개)', newAfter.features.length === 2);

  // --- 5. 파일 시스템 확인: 기본 프로젝트는 레거시 경로, 새 프로젝트는 projects/<id>/ ---
  const legacyFile = await readFile(join(dataDir, 'nodelink.geojson'), 'utf-8').then(JSON.parse);
  check('기본 프로젝트는 실제로 data/nodelink.geojson(레거시 경로)에 저장됨', legacyFile.features.length === 1);
  const newProjectFile = await readFile(join(dataDir, 'projects', created.id, 'nodelink.geojson'), 'utf-8').then(JSON.parse);
  check('새 프로젝트는 data/projects/<id>/nodelink.geojson에 별도 저장됨', newProjectFile.features.length === 2);

  // --- 6. 입력 검증 ---
  const badCreateRes = await fetch(`http://localhost:${PORT}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sizeX: 10, sizeY: 10 }), // name 없음
  });
  check('이름 없이 프로젝트 생성 -> 400', badCreateRes.status === 400);

  const badPutRes = await fetch(`http://localhost:${PORT}/api/projects/default/nodelink`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ not: 'a feature collection' }),
  });
  check('유효하지 않은 FeatureCollection PUT -> 400', badPutRes.status === 400);

  const notFoundGetRes = await fetch(`http://localhost:${PORT}/api/projects/no-such-id`);
  check('존재하지 않는 프로젝트 조회 -> 404', notFoundGetRes.status === 404);

  const notFoundNodelinkRes = await fetch(`http://localhost:${PORT}/api/projects/no-such-id/nodelink`);
  check('존재하지 않는 프로젝트의 nodelink 조회 -> 404', notFoundNodelinkRes.status === 404);
} catch (err) {
  console.log(`FAIL  unexpected error: ${err.stack || err}`);
  failures++;
} finally {
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nall projects smoke checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

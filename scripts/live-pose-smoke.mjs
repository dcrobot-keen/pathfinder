// pathfinder의 첫 JS 자동 테스트 -- README/doc가 오랫동안 "JS: 자동화 테스트 0개"로
// 기록해 온 상태를 이번 실시간 로봇 위치 기능부터 깬다.
//
// 검증 범위:
//  1. src/livePoseTransform.js -- scan_basemap <-> map 좌표 왕복 변환이 정확한지
//     (ROS 없이 vps_localizer_node.py의 tf2 lookup을 대체하는 수학).
//  2. server/index.mjs -- PUT /api/live-pose/:robotId로 pose를 밀어넣으면
//     WebSocket 구독자에게 fan-out되고, 새로 접속한 구독자는 현재 상태를 즉시 받는지.
//  3. server/index.mjs -- PUT /api/drive-request/:robotId(폐루프 제어, 시뮬레이터
//     주행 릴레이)도 구독자에게 fan-out되는지.
// 캡처 브리지 페이지(카메라 필요)와 ros-chromium 쪽 sim-driver(시뮬레이터 필요)는
// 이 스크립트로 검증하지 않는다 -- README "알려진 제한" 참고.
//
//   node scripts/live-pose-smoke.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { scanBasemapToMap, mapToScanBasemap, yawFromQuaternion, arkitPoseToGroundPose } from '../src/livePoseTransform.js';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

// --- 1. 순수 변환 함수: 정방향 -> 역방향 왕복이 원래 값으로 돌아오는지 ---
{
  const calibration = { rotationDeg: 37, translation: [12.5, -4.2] };
  const original = { x: 3.1, y: -8.4, headingRad: 1.2 };
  const roundTrip = scanBasemapToMap(mapToScanBasemap(original, calibration), calibration);

  check(
    'scanBasemapToMap ∘ mapToScanBasemap round-trips x/y',
    Math.abs(roundTrip.x - original.x) < 1e-9 && Math.abs(roundTrip.y - original.y) < 1e-9,
    `got (${roundTrip.x.toFixed(6)}, ${roundTrip.y.toFixed(6)})`
  );
  check(
    'round-trip도 heading을 보존한다',
    Math.abs(roundTrip.headingRad - original.headingRad) < 1e-9,
    `got ${roundTrip.headingRad.toFixed(6)}`
  );
}

// --- identity 보정(회전 0, 평행이동 0)이면 좌표가 그대로여야 함 ---
{
  const identity = { rotationDeg: 0, translation: [0, 0] };
  const pose = { x: 5, y: 7, headingRad: 0.3 };
  const result = scanBasemapToMap(pose, identity);
  check(
    'identity 보정은 pose를 바꾸지 않는다',
    result.x === 5 && result.y === 7 && result.headingRad === 0.3
  );
}

// --- yaw 추출: Z축 90도 회전 쿼터니언 [0,0,sin(45°),cos(45°)] -> yaw = 90° ---
{
  const q90 = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const yaw = yawFromQuaternion(q90);
  check('yawFromQuaternion: 90도 회전 쿼터니언 -> π/2', Math.abs(yaw - Math.PI / 2) < 1e-9, `got ${yaw.toFixed(6)}`);
}

// --- arkitPoseToGroundPose: 2026-08-30 버그 수정 회귀 테스트.
// ARKit translation[1]은 높이(Y)이지 지면 좌표가 아니므로 무시되고, y는
// -translation[2]로 나와야 한다(export_pointcloud.py의 (x,y,z)->(x,-z,y) 관례).
{
  const pose = arkitPoseToGroundPose([1, 5, -3], [0, 0, 0, 1]);
  check(
    '높이(translation[1])는 무시되고 y = -translation[2]',
    pose.x === 1 && pose.y === 3,
    `got (${pose.x}, ${pose.y})`
  );
}

// identity 쿼터니언(카메라가 world -Z를 바라봄) -> heading은 이 평면 관례에서 π/2.
{
  const pose = arkitPoseToGroundPose([0, 0, 0], [0, 0, 0, 1]);
  check(
    'identity 쿼터니언의 heading -> π/2',
    Math.abs(pose.headingRad - Math.PI / 2) < 1e-9,
    `got ${pose.headingRad.toFixed(6)}`
  );
}

// Y축 180도 회전(카메라가 반대쪽을 바라봄) -> heading이 π만큼 뒤집혀야 함(π/2 -> -π/2).
{
  const pose = arkitPoseToGroundPose([0, 0, 0], [0, 1, 0, 0]);
  check(
    'Y축 180도 회전 -> heading이 π만큼 뒤집힘(-π/2)',
    Math.abs(pose.headingRad - -Math.PI / 2) < 1e-9,
    `got ${pose.headingRad.toFixed(6)}`
  );
}

// --- 2. server/index.mjs를 자식 프로세스로 띄워 PUT + WebSocket fan-out 확인 ---
const PORT = 4791;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = await mkdtemp(join(tmpdir(), 'pathfinder-live-pose-smoke-'));

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

  // 구독자 하나를 먼저 연결하고 pose를 하나 PUT한다.
  const early = new WebSocket(`ws://localhost:${PORT}/api/live-pose/stream`);
  const earlyMessages = [];
  early.on('message', (data) => earlyMessages.push(JSON.parse(data.toString())));
  await new Promise((resolve) => early.on('open', resolve));

  const putRes = await fetch(`http://localhost:${PORT}/api/live-pose/former-01`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: 1.5, y: 2.5, headingRad: 0.7 }),
  });
  check('PUT /api/live-pose/:robotId -> 200', putRes.status === 200);
  await wait(150);
  check(
    '이미 연결된 구독자가 새 pose를 실시간으로 받는다',
    earlyMessages.some((m) => m.robotId === 'former-01' && m.pose.x === 1.5 && m.pose.y === 2.5)
  );

  // 나중에 접속한 구독자는 "현재 상태"를 연결 즉시 받아야 한다(다음 업데이트를 기다리지 않고).
  const late = new WebSocket(`ws://localhost:${PORT}/api/live-pose/stream`);
  const lateMessages = [];
  late.on('message', (data) => lateMessages.push(JSON.parse(data.toString())));
  await new Promise((resolve) => late.on('open', resolve));
  await wait(150);
  check(
    '늦게 접속한 구독자도 연결 즉시 현재 pose를 받는다',
    lateMessages.some((m) => m.robotId === 'former-01' && m.pose.x === 1.5)
  );

  const getRes = await fetch(`http://localhost:${PORT}/api/live-pose`);
  const snapshot = await getRes.json();
  check('GET /api/live-pose가 현재 상태 스냅샷을 준다', snapshot['former-01']?.x === 1.5);

  const badRes = await fetch(`http://localhost:${PORT}/api/live-pose/former-01`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: 'not-a-number', y: 2.5, headingRad: 0.7 }),
  });
  check('숫자가 아닌 x는 400으로 거부됨', badRes.status === 400);

  // --- 3. /api/drive-request -- 폐루프 제어(시뮬레이터 주행) 릴레이 ---
  const driveSub = new WebSocket(`ws://localhost:${PORT}/api/drive-request/stream`);
  const driveMessages = [];
  driveSub.on('message', (data) => driveMessages.push(JSON.parse(data.toString())));
  await new Promise((resolve) => driveSub.on('open', resolve));

  const drivePutRes = await fetch(`http://localhost:${PORT}/api/drive-request/relay-bot-01`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: [[0, 0], [1, 0], [1, 1]] }),
  });
  check('PUT /api/drive-request/:robotId -> 200', drivePutRes.status === 200);
  await wait(150);
  check(
    '구독자가 drive-request를 실시간으로 받는다',
    driveMessages.some((m) => m.robotId === 'relay-bot-01' && m.path.length === 3)
  );

  const emptyPathRes = await fetch(`http://localhost:${PORT}/api/drive-request/relay-bot-01`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: [] }),
  });
  check('빈 path는 400으로 거부됨', emptyPathRes.status === 400);

  early.close();
  late.close();
  driveSub.close();
} catch (err) {
  console.log(`FAIL  unexpected error: ${err.stack || err}`);
  failures++;
} finally {
  server.kill();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}

console.log(failures === 0 ? '\nall live-pose smoke checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

// 설정 › 시뮬레이터 카드의 서버 쪽 -- 지금까지 "어떤 월드를 로드할지 · 로봇을 몇 대 띄울지"는
// deploy/.env 를 손으로 고치고 터미널에서 docker compose 를 다시 실행해야 했다. 이 라우터는 같은
// 일을 화면에서 하게 해준다: 프로젝트별로 저장된 설정(data/sim-config.json)을 읽고, 검증한 뒤
// docker compose(-f deploy/docker-compose.dev.yml, 소스 빌드형)를 자식 프로세스로 실행한다.
//
// 범위는 지금 하나뿐인 시뮬레이터 인스턴스(월드 하나 + 로봇 최대 2대, compose가 정의한 sim-driver/
// sim-driver-2 두 슬롯이 상한)를 켜고 끄는 것까지다. 여러 현장을 동시에 띄우는 오케스트레이션은
// 범위 밖(architecture-improvements.md 참고).
//
// GHCR 이미지(docker-compose.yml)는 아직 CI가 성공적으로 push한 적이 없어 여기서는 dev 파일을 쓴다 --
// 이미지가 준비되면 COMPOSE_FILE 상수만 바꾸면 된다.
//
//   GET  /api/sim/worlds              -> { worlds: ["room.world.json", "project_20260905.slicemap.json", ...] }
//   GET  /api/sim/config/:projectId   -> { world, robots }
//   POST /api/sim/start   { projectId, world, robots } -> 저장 + docker compose up
//   POST /api/sim/stop                                  -> docker compose stop (시뮬레이터 관련 서비스만)
//   GET  /api/sim/status              -> { simulator, driver1, driver2, config }
import { Router } from 'express';
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JSONFilePreset } from 'lowdb/node';

const COMPOSE_FILE = 'deploy/docker-compose.dev.yml';
const ROBOT_ID_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const SPAWN_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;
const MAX_ROBOTS = 2; // compose가 정의한 sim-driver/sim-driver-2 슬롯 수

function runCompose(repoRoot, args, envOverride = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'docker',
      ['compose', '-f', COMPOSE_FILE, ...args],
      { cwd: repoRoot, env: { ...process.env, ...envOverride }, timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(Object.assign(new Error(stderr?.trim().slice(-800) || err.message), { stdout, stderr }));
        else resolvePromise({ stdout, stderr });
      }
    );
  });
}

async function listWorlds(worldsDir) {
  const files = await readdir(worldsDir).catch(() => []);
  return files.filter((f) => f.endsWith('.world.json') || f.endsWith('.slicemap.json')).sort();
}

function validateRobots(robots) {
  if (!Array.isArray(robots)) throw Object.assign(new Error('robots 는 배열이어야 합니다.'), { status: 400 });
  if (robots.length > MAX_ROBOTS) throw Object.assign(new Error(`로봇은 최대 ${MAX_ROBOTS}대까지입니다 (sim-driver 슬롯 상한).`), { status: 400 });
  for (const r of robots) {
    if (!ROBOT_ID_RE.test(r?.id ?? '')) throw Object.assign(new Error(`로봇 id 가 올바르지 않습니다: ${r?.id}`), { status: 400 });
    const spawn = r?.spawn ?? 'auto';
    if (spawn !== 'auto' && !SPAWN_RE.test(spawn)) throw Object.assign(new Error(`spawn 은 "auto" 또는 "x,y,theta" 여야 합니다: ${spawn}`), { status: 400 });
  }
  return robots.map((r) => ({ id: r.id, spawn: r.spawn ?? 'auto' }));
}

async function validateWorld(world, worldsDir) {
  const worlds = await listWorlds(worldsDir);
  if (!worlds.includes(world)) throw Object.assign(new Error(`알 수 없는 월드 파일입니다: ${world}`), { status: 400 });
  return world;
}

export async function createSimControlRouter({ dataDir, repoRoot }) {
  const worldsDir = resolve(repoRoot, 'deploy/worlds');
  const db = await JSONFilePreset(resolve(dataDir, 'sim-config.json'), { byProject: {} });
  const router = Router();

  router.get('/sim/worlds', async (req, res) => {
    res.json({ worlds: await listWorlds(worldsDir) });
  });

  router.get('/sim/config/:projectId', (req, res) => {
    const saved = db.data.byProject[req.params.projectId];
    res.json(saved ?? { world: null, robots: [{ id: 'tb3-sim-01', spawn: 'auto' }] });
  });

  router.post('/sim/start', async (req, res) => {
    const { projectId, world, robots } = req.body ?? {};
    if (!projectId || typeof projectId !== 'string') {
      res.status(400).json({ error: 'projectId 가 필요합니다.' });
      return;
    }
    try {
      const validWorld = await validateWorld(world, worldsDir);
      const validRobots = validateRobots(robots);
      db.data.byProject[projectId] = { world: validWorld, robots: validRobots };
      await db.write();

      const envOverride = {
        SIM_WORLD: `worlds/${validWorld}`,
        SIM_ROBOTS: validRobots.map((r) => `${r.id}@${r.spawn}`).join(';'),
        ROBOT_ID: validRobots[0]?.id ?? 'tb3-sim-01',
        ROBOT_ID_2: validRobots[1]?.id ?? 'tb3-sim-02',
      };
      const services = ['simulator'];
      if (validRobots[0]) services.push('sim-driver');
      if (validRobots[1]) services.push('sim-driver-2');
      await runCompose(repoRoot, ['up', '-d', '--force-recreate', ...services], envOverride);
      if (!validRobots[1]) await runCompose(repoRoot, ['stop', 'sim-driver-2']).catch(() => {});
      if (!validRobots[0]) await runCompose(repoRoot, ['stop', 'sim-driver']).catch(() => {});

      res.json({ ok: true, world: validWorld, robots: validRobots });
    } catch (err) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  router.post('/sim/stop', async (req, res) => {
    try {
      await runCompose(repoRoot, ['stop', 'simulator', 'sim-driver', 'sim-driver-2']);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/sim/status', async (req, res) => {
    try {
      const { stdout } = await runCompose(repoRoot, ['ps', '--format', 'json']);
      const rows = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const stateOf = (name) => rows.find((r) => r.Service === name)?.State ?? 'stopped';
      res.json({
        simulator: stateOf('simulator'),
        driver1: stateOf('sim-driver'),
        driver2: stateOf('sim-driver-2'),
        configs: db.data.byProject,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

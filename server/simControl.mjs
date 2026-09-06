// 설정 › 시뮬레이터 카드의 서버 쪽 -- 현장(pathfinder 프로젝트)마다 어떤 월드를 로드할지 · 로봇을 몇 대
// 띄울지를 화면에서 정하고 docker compose 로 실행한다. 여러 현장을 **동시에** 띄울 수 있다: 시뮬레이터·
// sim-driver 만 현장별 compose 프로젝트로 분리하고(브로커·대시보드·시그널링은 deploy/docker-compose.dev.yml
// 이 공유 인프라로 계속 띄운다), 현장마다 포트 베이스를 하나씩 배정해 호스트 포트가 겹치지 않게 한다.
//
// 기본은 deploy/docker-compose.site.dev.yml(소스 빌드형, 이 저장소를 hacking 하는 개발 환경 기준) -- 형제
// 저장소(ROS_CHROMIUM_DIR) 체크아웃이 있어야 한다. simulator/robot-os-chromium 소스를 안 고치는 보통 환경(예:
// GHCR 이미지만 pull 하는 다른 머신)에서는 환경변수 SIM_STACK_MODE=prod 로 deploy/docker-compose.site.yml(이미지
// pull 형)을 쓰게 한다.
//
//   GET  /api/sim/worlds                 -> { worlds: [...] }
//   GET  /api/sim/config/:projectId      -> { world, robots, ports }
//   POST /api/sim/start/:projectId  { world, robots } -> 저장 + docker compose up (포트 배정, 다른 현장과 로봇 id 충돌 검사)
//   POST /api/sim/stop/:projectId                      -> 이 현장의 컨테이너만 정지 (공유 인프라는 안 건드림)
//   GET  /api/sim/status/:projectId      -> { simulator, driver1, driver2, world, robots, ports }
import { Router } from 'express';
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JSONFilePreset } from 'lowdb/node';

const SITE_COMPOSE = process.env.SIM_STACK_MODE === 'prod' ? 'deploy/docker-compose.site.yml' : 'deploy/docker-compose.site.dev.yml';
const ROBOT_ID_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const SPAWN_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;
const MAX_ROBOTS = 2; // 이 현장에서 -- compose가 정의한 sim-driver/sim-driver-2 두 슬롯이 상한
const FIRST_PORT_BASE = 8765;
const PORT_STEP = 100; // 시뮬레이터 5개 포트(8765/6/7, 8775/6)를 한 블록으로 다음 현장에 넘겨준다

const composeProjectFor = (projectId) => `fs-sim-${projectId.slice(0, 8)}`;
const portsFor = (base) => ({ roboteq: base, sensor: base + 1, viewer: base + 2, roboteq2: base + 10, sensor2: base + 11 });

function runCompose(repoRoot, composeProject, args, envOverride = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'docker',
      ['compose', '-p', composeProject, '-f', SITE_COMPOSE, ...args],
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
  if (robots.length > MAX_ROBOTS) throw Object.assign(new Error(`이 현장에서 로봇은 최대 ${MAX_ROBOTS}대까지입니다 (sim-driver 슬롯 상한).`), { status: 400 });
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

async function composeState(repoRoot, composeProject) {
  try {
    const { stdout } = await runCompose(repoRoot, composeProject, ['ps', '--format', 'json']);
    const rows = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const stateOf = (name) => rows.find((r) => r.Service === name)?.State ?? 'stopped';
    return { simulator: stateOf('simulator'), driver1: stateOf('sim-driver'), driver2: stateOf('sim-driver-2') };
  } catch {
    return { simulator: 'stopped', driver1: 'stopped', driver2: 'stopped' };
  }
}

export async function createSimControlRouter({ dataDir, repoRoot }) {
  const worldsDir = resolve(repoRoot, 'deploy/worlds');
  const db = await JSONFilePreset(dataDir + '/sim-config.json', { nextPortBase: FIRST_PORT_BASE, byProject: {} });
  // 이전 버전(현장 하나만 관리하던 시절)의 data/sim-config.json 은 nextPortBase 가 없다 -- JSONFilePreset 은
  // 파일이 이미 있으면 기본값을 무시하고 그 내용을 그대로 쓰므로, 없으면 채워 넣는다.
  if (typeof db.data.nextPortBase !== 'number') {
    db.data.nextPortBase = FIRST_PORT_BASE;
    await db.write();
  }
  const router = Router();

  router.get('/sim/worlds', async (req, res) => {
    res.json({ worlds: await listWorlds(worldsDir) });
  });

  router.get('/sim/config/:projectId', (req, res) => {
    const saved = db.data.byProject[req.params.projectId];
    if (!saved) {
      res.json({ world: null, robots: [{ id: 'tb3-sim-01', spawn: 'auto' }], ports: null });
      return;
    }
    res.json({ world: saved.world, robots: saved.robots, ports: saved.portBase ? portsFor(saved.portBase) : null });
  });

  router.post('/sim/start/:projectId', async (req, res) => {
    const { projectId } = req.params;
    const { world, robots } = req.body ?? {};
    try {
      const validWorld = await validateWorld(world, worldsDir);
      const validRobots = validateRobots(robots);

      // 다른 현장 중 지금 떠 있는 것과 로봇 id 가 겹치는지 확인 -- 같은 브로커를 쓰므로 시리얼이 겹치면 서로 덮어쓴다.
      const requestedIds = new Set(validRobots.map((r) => r.id));
      for (const [otherId, otherCfg] of Object.entries(db.data.byProject)) {
        if (otherId === projectId || !otherCfg.portBase) continue;
        const state = await composeState(repoRoot, composeProjectFor(otherId));
        if (state.simulator !== 'running') continue;
        for (const r of otherCfg.robots ?? []) {
          if (requestedIds.has(r.id)) {
            throw Object.assign(new Error(`로봇 id "${r.id}" 는 이미 실행 중인 다른 현장(${otherId})에서 쓰고 있습니다.`), { status: 409 });
          }
        }
      }

      const existing = db.data.byProject[projectId];
      const portBase = existing?.portBase ?? db.data.nextPortBase;
      if (!existing?.portBase) db.data.nextPortBase = portBase + PORT_STEP;
      db.data.byProject[projectId] = { world: validWorld, robots: validRobots, portBase };
      await db.write();

      const ports = portsFor(portBase);
      const composeProject = composeProjectFor(projectId);
      const envOverride = {
        SIM_WORLD: `worlds/${validWorld}`,
        SIM_ROBOTS: validRobots.map((r) => `${r.id}@${r.spawn}`).join(';'),
        ROBOT_ID: validRobots[0]?.id ?? 'tb3-sim-01',
        ROBOT_ID_2: validRobots[1]?.id ?? 'tb3-sim-02',
        SIM_PORT_0: String(ports.roboteq),
        SIM_PORT_1: String(ports.sensor),
        SIM_PORT_2: String(ports.viewer),
        SIM_PORT_3: String(ports.roboteq2),
        SIM_PORT_4: String(ports.sensor2),
      };
      const services = ['simulator'];
      if (validRobots[0]) services.push('sim-driver');
      if (validRobots[1]) services.push('sim-driver-2');
      await runCompose(repoRoot, composeProject, ['up', '-d', '--force-recreate', ...services], envOverride);
      if (!validRobots[1]) await runCompose(repoRoot, composeProject, ['stop', 'sim-driver-2']).catch(() => {});
      if (!validRobots[0]) await runCompose(repoRoot, composeProject, ['stop', 'sim-driver']).catch(() => {});

      res.json({ ok: true, world: validWorld, robots: validRobots, ports });
    } catch (err) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  router.post('/sim/stop/:projectId', async (req, res) => {
    const composeProject = composeProjectFor(req.params.projectId);
    try {
      await runCompose(repoRoot, composeProject, ['stop', 'simulator', 'sim-driver', 'sim-driver-2']);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/sim/status/:projectId', async (req, res) => {
    const { projectId } = req.params;
    const saved = db.data.byProject[projectId];
    if (!saved?.portBase) {
      res.json({ simulator: 'stopped', driver1: 'stopped', driver2: 'stopped', world: saved?.world ?? null, robots: saved?.robots ?? [], ports: null });
      return;
    }
    const state = await composeState(repoRoot, composeProjectFor(projectId));
    res.json({ ...state, world: saved.world, robots: saved.robots, ports: portsFor(saved.portBase) });
  });

  return router;
}

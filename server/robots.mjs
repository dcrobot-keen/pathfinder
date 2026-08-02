// 로봇 등록 CRUD API. data/robots.json에 lowdb로 저장하고, 최초 실행 시
// 4개의 샘플 로봇(Atlas/MoBED/SPOT/AGV-AMR)을 자동으로 시드한다.
import express from 'express';
import { JSONFilePreset } from 'lowdb/node';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ROBOT_ICON_DATA_URI } from '../shared/robotIcons.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../data/robots.json');

export const ROBOT_TYPES = ['humanoid', 'agv_amr', 'quadruped', 'wheeled_nonholonomic', 'unknown'];
export const ROBOT_ALGORITHMS = ['dijkstra', 'astar', 'gridastar', 'hybridastar'];
export const ROBOT_STATUSES = ['on_mission', 'charging', 'connection_failed', 'standby', 'broken'];

// 로봇 크기/속도 기본값 (필드가 없거나 잘못된 값이 올 때 대체). 대략 성인 보행자 수준.
export const DEFAULT_SIZE_M = 0.5;
export const DEFAULT_SPEED_MPS = 1.0;

const SEED_ROBOTS = [
  {
    name: 'Atlas',
    type: 'humanoid',
    algorithm: 'gridastar',
    status: 'standby',
    company: 'Boston Dynamics',
    description:
      '완전한 동역학 제어 기반의 이족보행 휴머노이드 로봇. 계단 오르기, 점프 등 고난도 지형 대응이 가능합니다.',
    icon: ROBOT_ICON_DATA_URI.humanoid,
    sizeMeters: 0.55, // 이족보행 기준 어깨너비 정도의 발자국
    speedMps: 1.5, // 사람 빠른 걸음 수준
  },
  {
    name: 'MoBED',
    type: 'wheeled_nonholonomic',
    algorithm: 'hybridastar',
    status: 'standby',
    company: 'Research Platform',
    description:
      '4개의 조향 가능한 바퀴를 가진 non-holonomic 모바일 베이스. 정밀한 경로 추종이 필요한 연구/물류 환경에 적합합니다.',
    icon: ROBOT_ICON_DATA_URI.wheeled_nonholonomic,
    sizeMeters: 0.6,
    speedMps: 0.8, // 연구용 플랫폼은 안전을 위해 저속 운용
  },
  {
    name: 'SPOT',
    type: 'quadruped',
    algorithm: 'gridastar',
    status: 'standby',
    company: 'Boston Dynamics',
    description: '4족 보행 산업/필드 점검용 로봇. 계단과 불규칙한 지형을 안정적으로 이동할 수 있습니다.',
    icon: ROBOT_ICON_DATA_URI.quadruped,
    sizeMeters: 0.7,
    speedMps: 1.2, // SPOT 표준 보행 속도(최대 1.6m/s)보다 약간 낮게
  },
  {
    name: 'AGV/AMR',
    type: 'agv_amr',
    algorithm: 'astar',
    status: 'standby',
    company: 'Generic',
    description: '창고/공장에서 자재를 운반하는 자율주행 이동로봇(AGV/AMR) 샘플 항목입니다.',
    icon: ROBOT_ICON_DATA_URI.agv_amr,
    sizeMeters: 0.9, // 전형적인 AMR 카트 폭
    speedMps: 1.2, // 실내 물류 AMR의 일반적인 운용 속도
  },
];

function nowIso() {
  return new Date().toISOString();
}

function seedRobot(base) {
  const timestamp = nowIso();
  return { id: randomUUID(), createdAt: timestamp, updatedAt: timestamp, ...base };
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function pickPositiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function createRobotsRouter() {
  const db = await JSONFilePreset(DB_PATH, { robots: [] });
  if (db.data.robots.length === 0) {
    db.data.robots = SEED_ROBOTS.map(seedRobot);
    await db.write();
  }

  const router = express.Router();

  router.get('/robots', (req, res) => {
    res.json(db.data.robots);
  });

  router.post('/robots', async (req, res) => {
    const body = req.body || {};
    if (!body.name || typeof body.name !== 'string') {
      res.status(400).json({ error: 'name은 필수입니다.' });
      return;
    }
    const type = pickEnum(body.type, ROBOT_TYPES, 'unknown');
    const timestamp = nowIso();
    const robot = {
      id: randomUUID(),
      name: body.name,
      type,
      algorithm: pickEnum(body.algorithm, ROBOT_ALGORITHMS, 'astar'),
      status: pickEnum(body.status, ROBOT_STATUSES, 'standby'),
      company: body.company || '',
      description: body.description || '',
      icon: body.icon || ROBOT_ICON_DATA_URI[type],
      sizeMeters: pickPositiveNumber(body.sizeMeters, DEFAULT_SIZE_M),
      speedMps: pickPositiveNumber(body.speedMps, DEFAULT_SPEED_MPS),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.data.robots.push(robot);
    await db.write();
    res.status(201).json(robot);
  });

  router.put('/robots/:id', async (req, res) => {
    const idx = db.data.robots.findIndex((r) => r.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: '로봇을 찾을 수 없습니다.' });
      return;
    }
    const body = req.body || {};
    const existing = db.data.robots[idx];
    const updated = {
      ...existing,
      name: body.name ?? existing.name,
      type: body.type !== undefined ? pickEnum(body.type, ROBOT_TYPES, existing.type) : existing.type,
      algorithm:
        body.algorithm !== undefined
          ? pickEnum(body.algorithm, ROBOT_ALGORITHMS, existing.algorithm)
          : existing.algorithm,
      status:
        body.status !== undefined ? pickEnum(body.status, ROBOT_STATUSES, existing.status) : existing.status,
      company: body.company ?? existing.company,
      description: body.description ?? existing.description,
      icon: body.icon ?? existing.icon,
      sizeMeters:
        body.sizeMeters !== undefined
          ? pickPositiveNumber(body.sizeMeters, existing.sizeMeters)
          : existing.sizeMeters,
      speedMps:
        body.speedMps !== undefined ? pickPositiveNumber(body.speedMps, existing.speedMps) : existing.speedMps,
      updatedAt: nowIso(),
    };
    db.data.robots[idx] = updated;
    await db.write();
    res.json(updated);
  });

  router.delete('/robots/:id', async (req, res) => {
    const idx = db.data.robots.findIndex((r) => r.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: '로봇을 찾을 수 없습니다.' });
      return;
    }
    db.data.robots.splice(idx, 1);
    await db.write();
    res.status(204).end();
  });

  return router;
}

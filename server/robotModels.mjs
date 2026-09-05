// 로봇 모델(타입/사양) 카탈로그 CRUD API. data/robot-models.json에 lowdb로 저장하고,
// TurtleBot3 Burger, Former 2.0, Atlas, MoBED, SPOT, 표준 AGV/AMR 등 기본 모델을 시드한다.
import express from 'express';
import { JSONFilePreset } from 'lowdb/node';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROBOT_ICON_DATA_URI } from '../shared/robotIcons.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PATHFINDER_DATA_DIR ? resolve(process.env.PATHFINDER_DATA_DIR) : resolve(__dirname, '../data');
const DB_PATH = resolve(DATA_DIR, 'robot-models.json');

export const ROBOT_TYPES = ['humanoid', 'agv_amr', 'quadruped', 'wheeled_nonholonomic', 'unknown'];
export const ROBOT_ALGORITHMS = ['dijkstra', 'astar', 'gridastar', 'hybridastar'];

export const DEFAULT_MODEL_ID = 'turtlebot3-burger';

export const SEED_ROBOT_MODELS = [
  {
    id: 'turtlebot3-burger',
    name: 'TurtleBot3 Burger',
    manufacturer: 'ROBOTIS',
    type: 'agv_amr',
    algorithm: 'gridastar',
    sizeMeters: 0.2, // 지름 ~140-180mm 기준 안전 반경 0.2m
    speedMps: 0.22, // TB3 Burger 최대 주행 속도 0.22m/s
    icon: ROBOT_ICON_DATA_URI.agv_amr,
    description: 'ROBOTIS TurtleBot3 Burger (DYNAMIXEL XM430, Raspberry Pi, 360° LiDAR, 138×178×192mm, 1kg 가반하중).',
  },
  {
    id: 'former-2-0',
    name: 'Former 2.0',
    manufacturer: 'Yujin Robot',
    type: 'agv_amr',
    algorithm: 'hybridastar',
    sizeMeters: 0.4,
    speedMps: 1.0,
    icon: ROBOT_ICON_DATA_URI.agv_amr,
    description: '유진로봇 자율주행 모바일 로봇 플랫폼 Former 2.0 (3D ToF, 2D LiDAR, 100kg 가반하중, 슬램/내비게이션 지원).',
  },
  {
    id: 'atlas',
    name: 'Atlas',
    manufacturer: 'Boston Dynamics',
    type: 'humanoid',
    algorithm: 'gridastar',
    sizeMeters: 0.55, // 이족보행 기준 어깨너비 정도의 발자국
    speedMps: 1.5, // 사람 빠른 걸음 수준
    icon: ROBOT_ICON_DATA_URI.humanoid,
    description: '완전한 동역학 제어 기반의 이족보행 휴머노이드 로봇. 계단 오르기, 점프 등 고난도 지형 대응이 가능합니다.',
  },
  {
    id: 'mobed',
    name: 'MoBED',
    manufacturer: 'Hyundai Motor Group',
    type: 'wheeled_nonholonomic',
    algorithm: 'hybridastar',
    sizeMeters: 0.6,
    speedMps: 0.8, // 연구/정밀 운용 플랫폼
    icon: ROBOT_ICON_DATA_URI.wheeled_nonholonomic,
    description: '4개의 편심 바퀴를 가진 특수 조향 모바일 베이스. 거친 지형에서도 수평을 유지하며 정밀 주행합니다.',
  },
  {
    id: 'spot',
    name: 'SPOT',
    manufacturer: 'Boston Dynamics',
    type: 'quadruped',
    algorithm: 'gridastar',
    sizeMeters: 0.7,
    speedMps: 1.2, // SPOT 표준 보행 속도
    icon: ROBOT_ICON_DATA_URI.quadruped,
    description: '4족 보행 산업/필드 점검용 로봇. 계단과 불규칙한 비정형 지형을 안정적으로 이동할 수 있습니다.',
  },
  {
    id: 'generic-agv-amr',
    name: '표준 물류 AGV/AMR',
    manufacturer: 'Generic',
    type: 'agv_amr',
    algorithm: 'astar',
    sizeMeters: 0.9, // 전형적인 물류 AMR 폭
    speedMps: 1.2, // 실내 물류 AMR 일반 운용 속도
    icon: ROBOT_ICON_DATA_URI.agv_amr,
    description: '창고 및 공장에서 자재/파렛트를 운반하는 표준형 자율주행 이동로봇(AGV/AMR) 규격입니다.',
  },
];

function nowIso() {
  return new Date().toISOString();
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function pickPositiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function createRobotModelsStore() {
  await mkdir(DATA_DIR, { recursive: true });
  const db = await JSONFilePreset(DB_PATH, { models: [] });
  if (db.data.models.length === 0) {
    const timestamp = nowIso();
    db.data.models = SEED_ROBOT_MODELS.map((m) => ({
      ...m,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    await db.write();
  }

  return {
    list: () => db.data.models,
    get: (id) => db.data.models.find((m) => m.id === id) || null,
    add: async (model) => {
      db.data.models.push(model);
      await db.write();
      return model;
    },
    update: async (id, patch) => {
      const idx = db.data.models.findIndex((m) => m.id === id);
      if (idx === -1) return null;
      db.data.models[idx] = { ...db.data.models[idx], ...patch, updatedAt: nowIso() };
      await db.write();
      return db.data.models[idx];
    },
    remove: async (id) => {
      const idx = db.data.models.findIndex((m) => m.id === id);
      if (idx === -1) return false;
      db.data.models.splice(idx, 1);
      await db.write();
      return true;
    },
  };
}

export async function createRobotModelsRouter(store) {
  const modelStore = store || (await createRobotModelsStore());
  const router = express.Router();

  router.get('/robot-models', (req, res) => {
    res.json(modelStore.list());
  });

  router.get('/robot-models/:id', (req, res) => {
    const model = modelStore.get(req.params.id);
    if (!model) {
      res.status(404).json({ error: '로봇 모델을 찾을 수 없습니다.' });
      return;
    }
    res.json(model);
  });

  router.post('/robot-models', async (req, res) => {
    const body = req.body || {};
    if (!body.name || typeof body.name !== 'string') {
      res.status(400).json({ error: 'name은 필수입니다.' });
      return;
    }
    const id = (body.id && typeof body.id === 'string' ? body.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') : '') ||
      `model-${Date.now()}`;
    
    if (modelStore.get(id)) {
      res.status(409).json({ error: `이미 존재하는 모델 ID("${id}")입니다.` });
      return;
    }

    const type = pickEnum(body.type, ROBOT_TYPES, 'unknown');
    const timestamp = nowIso();
    const model = {
      id,
      name: body.name.trim(),
      manufacturer: (body.manufacturer || body.company || '').trim(),
      type,
      algorithm: pickEnum(body.algorithm, ROBOT_ALGORITHMS, 'astar'),
      sizeMeters: pickPositiveNumber(body.sizeMeters, 0.5),
      speedMps: pickPositiveNumber(body.speedMps, 1.0),
      icon: body.icon || ROBOT_ICON_DATA_URI[type] || ROBOT_ICON_DATA_URI.unknown,
      description: (body.description || '').trim(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await modelStore.add(model);
    res.status(201).json(model);
  });

  router.put('/robot-models/:id', async (req, res) => {
    const existing = modelStore.get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: '로봇 모델을 찾을 수 없습니다.' });
      return;
    }
    const body = req.body || {};
    const type = body.type !== undefined ? pickEnum(body.type, ROBOT_TYPES, existing.type) : existing.type;
    const patch = {
      name: body.name !== undefined ? String(body.name).trim() : existing.name,
      manufacturer: body.manufacturer !== undefined ? String(body.manufacturer).trim() : existing.manufacturer,
      type,
      algorithm: body.algorithm !== undefined ? pickEnum(body.algorithm, ROBOT_ALGORITHMS, existing.algorithm) : existing.algorithm,
      sizeMeters: body.sizeMeters !== undefined ? pickPositiveNumber(body.sizeMeters, existing.sizeMeters) : existing.sizeMeters,
      speedMps: body.speedMps !== undefined ? pickPositiveNumber(body.speedMps, existing.speedMps) : existing.speedMps,
      icon: body.icon !== undefined ? body.icon : existing.icon,
      description: body.description !== undefined ? String(body.description).trim() : existing.description,
    };
    const updated = await modelStore.update(req.params.id, patch);
    res.json(updated);
  });

  router.delete('/robot-models/:id', async (req, res) => {
    const success = await modelStore.remove(req.params.id);
    if (!success) {
      res.status(404).json({ error: '로봇 모델을 찾을 수 없습니다.' });
      return;
    }
    res.status(204).end();
  });

  router.models = modelStore;
  return router;
}

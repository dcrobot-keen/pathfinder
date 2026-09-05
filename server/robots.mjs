// 로봇 기기(Fleet Device) 등록 CRUD API. data/robots.json에 lowdb로 저장하며,
// 각 로봇 기기는 로봇 모델(server/robotModels.mjs)을 참조(modelId)하여 사양(크기, 속도, 알고리즘, 아이콘)을 상속받는다.
// 기존 클라이언트 및 스모크 테스트와의 100% 호환성을 위해 API 응답 시 모델 사양을 병합(decorate)하여 반환한다.
import express from 'express';
import { JSONFilePreset } from 'lowdb/node';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ROBOT_ICON_DATA_URI } from '../shared/robotIcons.mjs';
import { createRobotModelsStore, ROBOT_TYPES, ROBOT_ALGORITHMS } from './robotModels.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PATHFINDER_DATA_DIR ? resolve(process.env.PATHFINDER_DATA_DIR) : resolve(__dirname, '../data');
const DB_PATH = resolve(DATA_DIR, 'robots.json');

export { ROBOT_TYPES, ROBOT_ALGORITHMS };
export const ROBOT_STATUSES = ['on_mission', 'charging', 'connection_failed', 'standby', 'broken'];

export const DEFAULT_SIZE_M = 0.5;
export const DEFAULT_SPEED_MPS = 1.0;

// 초기 기기 데이터 (시뮬레이터 로봇 및 주요 장비 기기)
const SEED_ROBOT_DEVICES = [
  {
    name: 'tb3-sim-01',
    modelId: 'turtlebot3-burger',
    status: 'standby',
    company: 'ros-chromium simulator',
    description: 'VDA5050(MQTT) 시뮬레이터 로봇 #1 (TurtleBot3 Burger 치수).',
    vda5050Serial: 'tb3-sim-01',
    vda5050Manufacturer: 'dcrobot',
  },
  {
    name: 'tb3-sim-02',
    modelId: 'turtlebot3-burger',
    status: 'standby',
    company: 'ros-chromium simulator',
    description: 'VDA5050(MQTT) 시뮬레이터 로봇 #2 (TurtleBot3 Burger 치수).',
    vda5050Serial: 'tb3-sim-02',
    vda5050Manufacturer: 'dcrobot',
  },
  {
    name: 'tb3-nav-01',
    modelId: 'turtlebot3-burger',
    status: 'standby',
    company: 'dcrobot',
    description: 'TurtleBot3 Burger 실기 기기 (VDA5050/MQTT 연동).',
    vda5050Serial: 'tb3-nav-01',
    vda5050Manufacturer: 'dcrobot',
  },
];

// VDA5050 로봇(serialNumber/manufacturer)과 레지스트리 항목을 잇는 선택 필드.
function pickVda5050(body, existing = {}) {
  const has = (k) => body[k] !== undefined;
  return {
    vda5050Serial: has('vda5050Serial') ? (typeof body.vda5050Serial === 'string' ? body.vda5050Serial.trim() : '') : existing.vda5050Serial ?? '',
    vda5050Manufacturer: has('vda5050Manufacturer')
      ? (typeof body.vda5050Manufacturer === 'string' ? body.vda5050Manufacturer.trim() : '')
      : existing.vda5050Manufacturer ?? '',
  };
}

const SIM_SERIAL_RE = /(^|-)sim(-|$)/i;

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

/**
 * 로봇 기기 정보에 모델 사양을 병합(decoration)하여 기존 클라이언트 및 테스트가
 * sizeMeters, speedMps, algorithm, type, icon 등을 투명하게 접근할 수 있도록 한다.
 */
export function decorateRobot(robot, models) {
  let model = null;
  if (robot.modelId) {
    model = models.find((m) => m.id === robot.modelId);
  }
  if (!model && robot.type) {
    model = models.find((m) => m.type === robot.type);
  }
  if (!model) {
    model = models.find((m) => m.id === 'generic-agv-amr') || models[0];
  }

  const modelId = robot.modelId || (model ? model.id : 'turtlebot3-burger');
  const type = robot.type || (model ? model.type : 'agv_amr');
  const sizeMeters = robot.sizeMeters !== undefined ? robot.sizeMeters : (model ? model.sizeMeters : DEFAULT_SIZE_M);
  const speedMps = robot.speedMps !== undefined ? robot.speedMps : (model ? model.speedMps : DEFAULT_SPEED_MPS);
  const algorithm = robot.algorithm || (model ? model.algorithm : 'astar');
  const icon = robot.icon || (model ? model.icon : ROBOT_ICON_DATA_URI[type] || ROBOT_ICON_DATA_URI.unknown);
  const company = robot.company || (model ? model.manufacturer : '');

  return {
    ...robot,
    modelId,
    modelName: model?.name || '표준 모델',
    model: model
      ? {
          id: model.id,
          name: model.name,
          manufacturer: model.manufacturer,
          type: model.type,
          sizeMeters: model.sizeMeters,
          speedMps: model.speedMps,
          algorithm: model.algorithm,
          icon: model.icon,
          description: model.description,
        }
      : null,
    // 하위 호환 필드
    type,
    sizeMeters,
    speedMps,
    algorithm,
    icon,
    company,
  };
}

export async function createRobotsRouter(modelStoreInstance) {
  await mkdir(DATA_DIR, { recursive: true });
  const modelStore = modelStoreInstance || (await createRobotModelsStore());
  const db = await JSONFilePreset(DB_PATH, { robots: [] });

  // 초기 시드 (비어있는 경우)
  if (db.data.robots.length === 0) {
    const timestamp = nowIso();
    db.data.robots = SEED_ROBOT_DEVICES.map((d) => ({
      id: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...d,
    }));
    await db.write();
  } else {
    // 기존 레거시 데이터가 있는 경우 modelId 자동 매핑 마이그레이션
    let migrated = false;
    for (const r of db.data.robots) {
      if (!r.modelId) {
        if (/(^|-)sim(-|$)/i.test(r.name) || /(^|-)sim(-|$)/i.test(r.vda5050Serial || '')) {
          r.modelId = 'turtlebot3-burger';
        } else if (r.name.toLowerCase().includes('burger') || r.name === 'tb3-nav-01') {
          r.modelId = 'turtlebot3-burger';
        } else if (r.name.toLowerCase().includes('former')) {
          r.modelId = 'former-2-0';
        } else if (r.name.toLowerCase().includes('atlas')) {
          r.modelId = 'atlas';
        } else if (r.name.toLowerCase().includes('mobed')) {
          r.modelId = 'mobed';
        } else if (r.name.toLowerCase().includes('spot')) {
          r.modelId = 'spot';
        } else if (r.type === 'humanoid') {
          r.modelId = 'atlas';
        } else if (r.type === 'quadruped') {
          r.modelId = 'spot';
        } else if (r.type === 'wheeled_nonholonomic') {
          r.modelId = 'mobed';
        } else {
          r.modelId = 'generic-agv-amr';
        }
        migrated = true;
      }
    }
    if (migrated) {
      await db.write();
    }
  }

  const router = express.Router();

  router.get('/robots', (req, res) => {
    const models = modelStore.list();
    res.json(db.data.robots.map((r) => decorateRobot(r, models)));
  });

  router.get('/robots/:id', (req, res) => {
    const found = db.data.robots.find((r) => r.id === req.params.id);
    if (!found) {
      res.status(404).json({ error: '로봇을 찾을 수 없습니다.' });
      return;
    }
    const models = modelStore.list();
    res.json(decorateRobot(found, models));
  });

  router.post('/robots', async (req, res) => {
    const body = req.body || {};
    if (!body.name || typeof body.name !== 'string') {
      res.status(400).json({ error: 'name은 필수입니다.' });
      return;
    }

    const models = modelStore.list();
    let modelId = body.modelId;
    if (!modelId || !models.some((m) => m.id === modelId)) {
      if (body.type && models.some((m) => m.type === body.type)) {
        modelId = models.find((m) => m.type === body.type).id;
      } else {
        modelId = 'generic-agv-amr';
      }
    }
    const matchedModel = models.find((m) => m.id === modelId) || models[0];

    const timestamp = nowIso();
    const robot = {
      id: randomUUID(),
      name: body.name.trim(),
      modelId,
      status: pickEnum(body.status, ROBOT_STATUSES, 'standby'),
      company: body.company !== undefined ? body.company : (matchedModel?.manufacturer || ''),
      description: body.description || '',
      ...pickVda5050(body),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // 사용자가 모델 기본값 대신 개별 지정한 경우에만 인스턴스 오버라이드로 보관
    if (body.sizeMeters !== undefined) {
      robot.sizeMeters = pickPositiveNumber(body.sizeMeters, matchedModel.sizeMeters);
    }
    if (body.speedMps !== undefined) {
      robot.speedMps = pickPositiveNumber(body.speedMps, matchedModel.speedMps);
    }
    if (body.algorithm !== undefined) {
      robot.algorithm = pickEnum(body.algorithm, ROBOT_ALGORITHMS, matchedModel.algorithm);
    }
    if (body.type !== undefined) {
      robot.type = pickEnum(body.type, ROBOT_TYPES, matchedModel.type);
    }
    if (body.icon) {
      robot.icon = body.icon;
    }

    db.data.robots.push(robot);
    await db.write();

    res.status(201).json(decorateRobot(robot, models));
  });

  /** VDA5050 로 처음 보인 로봇을 레지스트리에 자동 등록한다(이미 있으면 그대로 반환). */
  async function ensureVda5050Robot(manufacturer, serialNumber) {
    const models = modelStore.list();
    const existing = db.data.robots.find(
      (r) => r.vda5050Serial === serialNumber && (!r.vda5050Manufacturer || r.vda5050Manufacturer === manufacturer)
    );
    if (existing) {
      return { robot: decorateRobot(existing, models), created: false };
    }

    const sim = SIM_SERIAL_RE.test(serialNumber);
    const timestamp = nowIso();
    // sim 로봇은 turtlebot3-burger 모델 참조, 그 외 일반 VDA5050 로봇은 generic-agv-amr 참조
    const modelId = sim ? 'turtlebot3-burger' : 'generic-agv-amr';
    const model = models.find((m) => m.id === modelId) || models[0];

    const robot = {
      id: randomUUID(),
      name: serialNumber,
      modelId,
      status: 'standby',
      company: sim ? 'ros-chromium simulator' : manufacturer,
      description: sim
        ? 'VDA5050(MQTT)으로 자동 등록된 시뮬레이터 로봇 (TurtleBot3 Burger 치수). ros-chromium sim-driver가 운전한다.'
        : `VDA5050(MQTT)으로 자동 등록된 로봇 (${manufacturer}/${serialNumber}).`,
      vda5050Serial: serialNumber,
      vda5050Manufacturer: manufacturer,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    db.data.robots.push(robot);
    await db.write();
    return { robot: decorateRobot(robot, models), created: true };
  }

  router.robots = {
    ensureVda5050Robot,
    list: () => {
      const models = modelStore.list();
      return db.data.robots.map((r) => decorateRobot(r, models));
    },
  };

  router.put('/robots/:id', async (req, res) => {
    const idx = db.data.robots.findIndex((r) => r.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: '로봇을 찾을 수 없습니다.' });
      return;
    }
    const body = req.body || {};
    const existing = db.data.robots[idx];
    const models = modelStore.list();

    let modelId = body.modelId !== undefined ? body.modelId : existing.modelId;
    if (modelId && !models.some((m) => m.id === modelId)) {
      modelId = existing.modelId || 'generic-agv-amr';
    }

    const updated = {
      ...existing,
      name: body.name ?? existing.name,
      modelId,
      status: body.status !== undefined ? pickEnum(body.status, ROBOT_STATUSES, existing.status) : existing.status,
      company: body.company ?? existing.company,
      description: body.description ?? existing.description,
      ...pickVda5050(body, existing),
      updatedAt: nowIso(),
    };

    if (body.type !== undefined) {
      updated.type = pickEnum(body.type, ROBOT_TYPES, existing.type);
    }
    if (body.algorithm !== undefined) {
      updated.algorithm = pickEnum(body.algorithm, ROBOT_ALGORITHMS, existing.algorithm);
    }
    if (body.sizeMeters !== undefined) {
      updated.sizeMeters = pickPositiveNumber(body.sizeMeters, existing.sizeMeters);
    }
    if (body.speedMps !== undefined) {
      updated.speedMps = pickPositiveNumber(body.speedMps, existing.speedMps);
    }
    if (body.icon !== undefined) {
      updated.icon = body.icon;
    }

    db.data.robots[idx] = updated;
    await db.write();
    res.json(decorateRobot(updated, models));
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

// VDA5050 MQTT 브리지 -- pathfinder를 RCS(관제) 쪽으로 세운다. 브로커의
// uagv/v2/<manufacturer>/<serialNumber>/{connection,state,visualization}을 구독해
//   1) 위치를 기존 live-pose fan-out(onPose)으로 넘겨 지도 마커가 그대로 뜨게 하고
//   2) 로봇별 플릿 상태(연결·주문·오류)를 모아 REST + WebSocket(/api/vda5050/stream)으로
//      "플릿 (RCS)" 탭에 내보내며
//   3) 탭에서 시킨 order / instantActions 를 같은 접두사의 토픽으로 발행한다.
// 설정(브로커 URL, 구독 목록)은 data/vda5050.json(lowdb)에 저장되고 PUT으로 바뀌면
// 즉시 재접속한다. 기본은 enabled:false -- 브로커가 없는 개발 환경에서 서버가
// 접속을 시도하며 로그를 채우지 않게. 설계: doc/vda5050-rcs.md (워크스페이스 루트).
//
// MQTT 클라이언트 생성은 `connect(brokerUrl, options)`로 주입받는다(기본은 npm mqtt).
// 스모크 테스트는 가짜 클라이언트를 넘겨 브로커 없이 전체 경로를 검증한다.
import express from 'express';
import { JSONFilePreset } from 'lowdb/node';
import { WebSocketServer } from 'ws';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CONFIG,
  instantActionsMessage,
  normalizeConfig,
  parseVda5050Topic,
  pathToOrder,
  poseFromAgvPosition,
  robotKey,
  summarizeState,
  vda5050Header,
  vda5050Topic,
} from '../shared/vda5050.mjs';

const SUBSCRIBED_NAMES = ['connection', 'state', 'visualization'];
const RCS_SERIAL = 'pathfinder-rcs'; // serialNumber in the headers of what WE publish
const SUPPORTED_INSTANT_ACTIONS = ['cancelOrder', 'stopPause', 'startPause'];
// 노드가 비기 전후 이 시간 안에 FATAL 오류/cancelOrder 완료가 보이면 그 주문은 도착이 아니라 중단/취소다.
const ABORT_WINDOW_MS = 5000;

async function defaultConnect(brokerUrl, options) {
  const { default: mqtt } = await import('mqtt');
  return mqtt.connect(brokerUrl, options);
}

export async function createVda5050Bridge({
  dataDir,
  onPose = () => {},
  onRobotDiscovered = null, // (manufacturer, serialNumber) => void|Promise -- 처음 메시지를 보낸 로봇마다 1회
  connect = defaultConnect,
  log = (m) => console.log(`[vda5050] ${m}`),
}) {
  await mkdir(dataDir, { recursive: true });
  const db = await JSONFilePreset(resolve(dataDir, 'vda5050.json'), { config: { ...DEFAULT_CONFIG } });
  // 파일에 옛 필드만 있어도 기본값으로 채운다.
  db.data.config = normalizeConfig(db.data.config).config ?? { ...DEFAULT_CONFIG };

  const robots = new Map(); // key -> record
  // 이벤트·주문 이력은 재시작해도 남아야 하는 운영 기록이라 data/fleet-log.json 에 쓴다
  // (lowdb, 쓰기는 1초 디바운스). 메모리 상한: 이벤트 300, 로봇당 주문 50.
  const logDb = await JSONFilePreset(resolve(dataDir, 'fleet-log.json'), { events: [], orders: {} });
  const events = Array.isArray(logDb.data.events) ? logDb.data.events : []; // newest first
  const orderHistory = new Map(Object.entries(logDb.data.orders ?? {})); // serialNumber -> recent orders, newest first
  const EVENTS_MAX = 300, ORDERS_MAX = 50;
  let logWriteTimer = null;
  function persistLog() {
    if (logWriteTimer) return;
    logWriteTimer = setTimeout(() => {
      logWriteTimer = null;
      logDb.data = { events, orders: Object.fromEntries(orderHistory) };
      logDb.write().catch((err) => log(`fleet-log write failed: ${err.message || err}`));
    }, 1000);
  }
  const status = { connected: false, brokerUrl: null, error: null, since: null };
  const headerIds = new Map(); // topic -> next headerId
  let client = null;
  let generation = 0;

  const wss = new WebSocketServer({ noServer: true });
  function broadcast(obj) {
    const payload = JSON.stringify(obj);
    for (const c of wss.clients) if (c.readyState === c.OPEN) c.send(payload);
  }
  function setStatus(patch) {
    Object.assign(status, patch);
    broadcast({ type: 'status', status: { ...status } });
  }

  function pushEvent(type, level, serialNumber, message) {
    const ev = { id: randomUUID(), timestamp: Date.now(), type, level, serialNumber, message };
    events.unshift(ev);
    if (events.length > EVENTS_MAX) events.length = EVENTS_MAX;
    persistLog();
    broadcast({ type: 'event', event: ev });
  }

  function recordOrder(serialNumber, orderInfo) {
    let list = orderHistory.get(serialNumber);
    if (!list) {
      list = [];
      orderHistory.set(serialNumber, list);
    }
    list.unshift(orderInfo);
    if (list.length > ORDERS_MAX) list.length = ORDERS_MAX;
    persistLog();
    broadcast({ type: 'order', serialNumber, order: orderInfo });
  }

  function updateOrderStatus(serialNumber, orderId, patch) {
    const list = orderHistory.get(serialNumber);
    if (!list) return;
    const found = list.find((o) => o.orderId === orderId);
    if (found) {
      Object.assign(found, patch);
      persistLog();
      broadcast({ type: 'order_update', serialNumber, order: found });
    }
  }

  function record(manufacturer, serialNumber) {
    const key = robotKey(manufacturer, serialNumber);
    let r = robots.get(key);
    if (!r) {
      r = {
        key,
        manufacturer,
        serialNumber,
        connectionState: 'UNKNOWN',
        position: null, // { x, y, theta, mapId }
        velocity: null,
        state: null, // summarizeState()
        lastSeen: null,
        lastStateAt: null,
        lastOrder: null, // { orderId, orderUpdateId, sentAt, waypoints }
      };
      robots.set(key, r);
    }
    return r;
  }

  function onMessage(topic, payloadBuf) {
    const t = parseVda5050Topic(topic);
    if (!t || !SUBSCRIBED_NAMES.includes(t.name)) return;
    let msg;
    try {
      msg = JSON.parse(payloadBuf.toString());
    } catch {
      return; // 남의 브로커에 섞인 비-JSON은 조용히 무시
    }
    const known = robots.has(robotKey(t.manufacturer, t.serialNumber));
    const r = record(t.manufacturer, t.serialNumber);
    if (!known && onRobotDiscovered) {
      Promise.resolve(onRobotDiscovered(t.manufacturer, t.serialNumber)).catch((err) => log(`onRobotDiscovered failed: ${err.message || err}`));
    }
    const now = Date.now();
    r.lastSeen = now;
    if (t.name === 'connection') {
      const next = typeof msg.connectionState === 'string' ? msg.connectionState : 'UNKNOWN';
      if (r.connectionState !== next) {
        pushEvent('CONNECTION', next === 'ONLINE' ? 'INFO' : 'WARN', t.serialNumber, `연결 상태 변화: ${r.connectionState} → ${next}`);
      }
      r.connectionState = next;
    } else {
      if (r.connectionState === 'UNKNOWN') {
        r.connectionState = 'ONLINE';
        pushEvent('CONNECTION', 'INFO', t.serialNumber, '로봇 신호 감지: ONLINE');
      }
      if (msg.agvPosition) {
        const pose = poseFromAgvPosition(msg.agvPosition, now);
        if (pose) {
          r.position = { x: pose.x, y: pose.y, theta: pose.headingRad, mapId: msg.agvPosition.mapId ?? null };
          onPose(t.serialNumber, pose);
        }
      }
      if (msg.velocity) r.velocity = { vx: msg.velocity.vx ?? 0, vy: msg.velocity.vy ?? 0, omega: msg.velocity.omega ?? 0 };
      if (t.name === 'state') {
        const prevErrors = r.state?.errors ?? [];
        r.state = summarizeState(msg);
        r.lastStateAt = now;
        if (r.state.errors && r.state.errors.length > 0) {
          for (const err of r.state.errors) {
            const isNew = !prevErrors.some((p) => p.errorType === err.errorType && p.errorDescription === err.errorDescription);
            if (isNew) {
              pushEvent('ERROR', err.errorLevel ?? 'WARN', t.serialNumber, `[${err.errorType}] ${err.errorDescription ?? '-'}`);
              // 로봇이 주문을 스스로 중단한 이유(pathDeviation, obstacleBlocked ...). 몇 초 안에
              // 노드가 비면 그 주문은 FINISHED 가 아니라 ABORTED 로 기록한다(아래).
              if (err.errorLevel === 'FATAL') r.lastFatal = { at: now, errorType: err.errorType, description: err.errorDescription ?? '' };
            }
          }
        }
        if (msg.orderId) {
          const rec = (orderHistory.get(t.serialNumber) ?? []).find((o) => o.orderId === msg.orderId);
          const left = msg.nodeStates?.length ?? 0;
          const patch = { lastNodeId: msg.lastNodeId, driving: msg.driving, paused: msg.paused };
          if (left > 0) {
            patch.nodesLeft = left;
            patch.status = msg.driving ? 'DRIVING' : msg.paused ? 'PAUSED' : 'ACTIVE';
          } else if (rec && (rec.status === 'ABORTED' || rec.status === 'CANCELLED')) {
            patch.status = rec.status; // 한 번 중단/취소로 판정한 주문은 그대로 둔다
          } else {
            // 노드가 다 비었다 = 정상 도착, 취소(cancelOrder 액션 완료), 또는 로봇의 자체 중단(FATAL 오류).
            // 정상 도착도 nodesLeft 0 이라 셋을 구분해야 "중단된 주문이 109/109 완료"로 보이지 않는다.
            const cancelled = (msg.actionStates ?? []).some((a) => a.actionType === 'cancelOrder' && a.actionStatus === 'FINISHED')
              && rec?.status !== 'FINISHED';
            const fatal = r.lastFatal && now - r.lastFatal.at < ABORT_WINDOW_MS ? r.lastFatal : null;
            const wasFinished = rec?.status === 'FINISHED' && now - (rec.finishedAt ?? 0) > ABORT_WINDOW_MS;
            if (!wasFinished && cancelled) {
              patch.status = 'CANCELLED';
              patch.nodesLeft = rec?.nodesLeft ?? 0;
            } else if (!wasFinished && fatal) {
              patch.status = 'ABORTED';
              patch.nodesLeft = rec?.nodesLeft ?? 0;
              patch.abortReason = fatal.errorType;
              patch.abortDescription = fatal.description;
            } else {
              patch.status = 'FINISHED';
              patch.nodesLeft = 0;
              if (rec && !rec.finishedAt) patch.finishedAt = now;
            }
          }
          updateOrderStatus(t.serialNumber, msg.orderId, patch);
        }
      }
    }
    broadcast({ type: 'robot', robot: r });
  }

  function subscriptionTopics(cfg) {
    const topics = [];
    for (const s of cfg.subscriptions) {
      for (const name of SUBSCRIBED_NAMES) {
        topics.push(vda5050Topic({ ...cfg, manufacturer: s.manufacturer, serialNumber: s.serialNumber }, name));
      }
    }
    return topics;
  }

  async function disconnect() {
    generation++;
    if (client) {
      const c = client;
      client = null;
      try {
        c.removeAllListeners?.();
        await new Promise((res) => (c.end ? c.end(true, {}, res) : res()));
      } catch {
        /* ignore */
      }
    }
    setStatus({ connected: false, brokerUrl: null, since: null });
  }

  async function applyConfig() {
    await disconnect();
    const cfg = db.data.config;
    if (!cfg.enabled) {
      setStatus({ error: null });
      log('disabled (enable it in the 플릿 (RCS) tab)');
      return;
    }
    const gen = generation;
    let c;
    try {
      c = await connect(cfg.brokerUrl, { clientId: `${RCS_SERIAL}-${randomUUID().slice(0, 8)}`, reconnectPeriod: 2000, connectTimeout: 5000 });
    } catch (err) {
      setStatus({ error: err.message || String(err) });
      log(`connect failed: ${err.message || err}`);
      return;
    }
    if (gen !== generation) {
      c.end?.(true);
      return;
    }
    client = c;
    c.on('connect', () => {
      setStatus({ connected: true, brokerUrl: cfg.brokerUrl, error: null, since: Date.now() });
      const topics = subscriptionTopics(cfg);
      c.subscribe(topics, { qos: 0 });
      log(`connected ${cfg.brokerUrl}, subscribed ${topics.length} topics`);
    });
    c.on('reconnect', () => setStatus({ connected: false }));
    c.on('close', () => setStatus({ connected: false }));
    c.on('offline', () => setStatus({ connected: false }));
    c.on('error', (err) => {
      setStatus({ error: err.message || String(err) });
      log(`error: ${err.message || err}`);
    });
    c.on('message', onMessage);
  }

  function publish(topic, message, opts = { qos: 0, retain: false }) {
    if (!client || !status.connected) throw Object.assign(new Error('브로커에 연결되어 있지 않습니다.'), { status: 503 });
    client.publish(topic, JSON.stringify(message), opts);
  }

  function header(topic) {
    const id = headerIds.get(topic) ?? 0;
    headerIds.set(topic, id + 1);
    return vda5050Header({ headerId: id, manufacturer: db.data.config.manufacturer, serialNumber: RCS_SERIAL });
  }

  /** 경로 -> order 발행. 같은 로봇의 직전 orderId를 이어받으면(updatePrevious) orderUpdateId를 올린다. */
  function sendOrder(manufacturer, serialNumber, path, { mapId, updatePrevious = false } = {}) {
    const r = record(manufacturer, serialNumber);
    const topic = vda5050Topic({ ...db.data.config, manufacturer, serialNumber }, 'order');
    let orderId = randomUUID();
    let orderUpdateId = 0;
    if (updatePrevious && r.lastOrder) {
      orderId = r.lastOrder.orderId;
      orderUpdateId = r.lastOrder.orderUpdateId + 1;
    }
    const order = pathToOrder(path, { orderId, orderUpdateId, mapId: mapId ?? r.position?.mapId ?? undefined, header: header(topic) });
    publish(topic, order);
    // path([x,y]...) 도 함께 둔다 -- 현장 3D 와 다른 클라이언트가 계획 경로·진행을 그릴 수 있게 (레코드는 스트림으로 방송된다)
    r.lastOrder = { orderId, orderUpdateId, sentAt: Date.now(), waypoints: path.length, path };
    recordOrder(serialNumber, {
      orderId,
      orderUpdateId,
      serialNumber,
      manufacturer,
      mapId: mapId ?? r.position?.mapId ?? 'default',
      nodeCount: order.nodes.length,
      sentAt: Date.now(),
      status: 'SENT',
      lastNodeId: null,
      nodesLeft: order.nodes.length,
    });
    pushEvent('COMMAND', 'INFO', serialNumber, `주문 발행: ${orderId.slice(0, 8)} (${order.nodes.length}개 노드)`);
    broadcast({ type: 'robot', robot: r });
    return { orderId, orderUpdateId, topic, nodes: order.nodes.length };
  }

  function sendInstantAction(manufacturer, serialNumber, actionType) {
    const topic = vda5050Topic({ ...db.data.config, manufacturer, serialNumber }, 'instantActions');
    const actionId = randomUUID();
    publish(topic, instantActionsMessage(actionType, { actionId, header: header(topic) }));
    pushEvent('COMMAND', 'INFO', serialNumber, `즉시 제어 명령 전송: ${actionType}`);
    if (actionType === 'cancelOrder') {
      const list = orderHistory.get(serialNumber);
      if (list && list[0] && list[0].status !== 'FINISHED') {
        list[0].status = 'CANCELLED';
        broadcast({ type: 'order_update', serialNumber, order: list[0] });
      }
    }
    return { actionId, topic };
  }

  // --- REST -----------------------------------------------------------
  const router = express.Router();

  router.get('/vda5050/config', (req, res) => {
    res.json({ config: db.data.config, status: { ...status }, supportedInstantActions: SUPPORTED_INSTANT_ACTIONS });
  });

  router.put('/vda5050/config', async (req, res) => {
    const result = normalizeConfig(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    db.data.config = result.config;
    await db.write();
    await applyConfig();
    res.json({ config: db.data.config, status: { ...status } });
  });

  router.get('/vda5050/robots', (req, res) => {
    res.json({ robots: Array.from(robots.values()), status: { ...status }, staleAfterMs: db.data.config.staleAfterMs });
  });

  router.get('/vda5050/events', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, EVENTS_MAX);
    res.json({ events: events.slice(0, limit) });
  });

  router.get('/vda5050/orders/:serialNumber', (req, res) => {
    const orders = orderHistory.get(req.params.serialNumber) ?? [];
    res.json({ orders });
  });

  router.delete('/vda5050/robots/:manufacturer/:serialNumber', (req, res) => {
    const key = robotKey(req.params.manufacturer, req.params.serialNumber);
    const existed = robots.delete(key);
    if (existed) broadcast({ type: 'forget', key });
    res.json({ ok: true, existed });
  });

  router.post('/vda5050/robots/:manufacturer/:serialNumber/order', (req, res) => {
    const { path, mapId, updatePrevious } = req.body ?? {};
    try {
      const result = sendOrder(req.params.manufacturer, req.params.serialNumber, path, { mapId, updatePrevious: updatePrevious === true });
      res.json(result);
    } catch (err) {
      res.status(err.status ?? 400).json({ error: err.message });
    }
  });

  router.post('/vda5050/robots/:manufacturer/:serialNumber/instant-actions', (req, res) => {
    const { actionType } = req.body ?? {};
    if (!SUPPORTED_INSTANT_ACTIONS.includes(actionType)) {
      res.status(400).json({ error: `actionType은 ${SUPPORTED_INSTANT_ACTIONS.join(', ')} 중 하나여야 합니다.` });
      return;
    }
    try {
      res.json(sendInstantAction(req.params.manufacturer, req.params.serialNumber, actionType));
    } catch (err) {
      res.status(err.status ?? 400).json({ error: err.message });
    }
  });

  // --- WebSocket: 새 구독자는 스냅샷을 먼저 받는다 ------------------------
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({
      type: 'snapshot',
      status: { ...status },
      robots: Array.from(robots.values()),
      events: events.slice(0, 30),
      staleAfterMs: db.data.config.staleAfterMs,
    }));
  });

  await applyConfig();

  return {
    router,
    wss,
    streamPath: '/api/vda5050/stream',
    get config() {
      return db.data.config;
    },
    get status() {
      return { ...status };
    },
    robots,
    sendOrder,
    sendInstantAction,
    /** 로봇의 serialNumber만 알 때(기존 drive-request 흐름) 온라인 여부 + manufacturer 조회. */
    findOnlineBySerial(serialNumber) {
      for (const r of robots.values()) {
        if (r.serialNumber === serialNumber && status.connected && r.connectionState === 'ONLINE') return r;
      }
      return null;
    },
    async close() {
      await disconnect();
      for (const c of wss.clients) c.close();
    },
  };
}

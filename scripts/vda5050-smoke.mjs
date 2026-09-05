// VDA5050 브리지 스모크 -- 브로커 없이. shared/vda5050.mjs의 순수 함수와
// server/vda5050.mjs를 가짜 MQTT 클라이언트(connect 주입)로 검증한다:
//   config PUT -> 접속/구독, state/visualization 수신 -> onPose + 플릿 상태,
//   order/instantActions 발행, WebSocket 스트림 스냅샷, drive-request의 MQTT 우회.
//
//   node scripts/vda5050-smoke.mjs
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import express from 'express';
import { WebSocket } from 'ws';
import { createVda5050Bridge } from '../server/vda5050.mjs';
import {
  DEFAULT_CONFIG,
  instantActionsMessage,
  normalizeConfig,
  parseVda5050Topic,
  pathToOrder,
  poseFromAgvPosition,
  summarizeState,
  vda5050Topic,
} from '../shared/vda5050.mjs';

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. 순수 함수 ---
{
  const ids = { interfaceName: 'uagv', majorVersion: 'v2', manufacturer: 'dcrobot', serialNumber: 'tb3-sim-01' };
  check('topic', vda5050Topic(ids, 'order') === 'uagv/v2/dcrobot/tb3-sim-01/order');
  check('parse', parseVda5050Topic('uagv/v2/dcrobot/tb3-sim-01/state')?.serialNumber === 'tb3-sim-01' && parseVda5050Topic('x/y') === null);
  const order = pathToOrder([[0, 0], [1, 0], [1, 2]], { orderId: 'o', orderUpdateId: 3, mapId: 'default', header: { headerId: 7 } });
  check('pathToOrder nodes/edges/header', order.nodes.length === 3 && order.edges.length === 2 && order.headerId === 7 && order.orderUpdateId === 3 && order.nodes[2].nodePosition.mapId === 'default');
  check('pathToOrder sequenceIds', order.nodes.map((n) => n.sequenceId).join() === '0,2,4' && order.edges.map((e) => e.sequenceId).join() === '1,3');
  let threw = false; try { pathToOrder([[0, 'a']], { orderId: 'o' }); } catch { threw = true; } check('pathToOrder rejects non-numeric', threw);
  const ia = instantActionsMessage('cancelOrder', { actionId: 'a1' });
  check('instantActionsMessage 2.0 shape', ia.actions[0].actionType === 'cancelOrder' && ia.actions[0].blockingType === 'HARD');
  const pose = poseFromAgvPosition({ x: 1, y: 2, theta: 0.5, mapId: 'm', positionInitialized: true }, 123);
  check('poseFromAgvPosition -> live-pose shape', pose.x === 1 && pose.y === 2 && pose.headingRad === 0.5 && pose.timestamp === 123);
  check('poseFromAgvPosition null when uninitialised/malformed', poseFromAgvPosition({ x: 0, y: 0, theta: 0, positionInitialized: false }) === null && poseFromAgvPosition({ x: 'a' }) === null);
  const sum = summarizeState({ orderId: 'o', nodeStates: [1, 2], driving: true, batteryState: { batteryCharge: 55 }, errors: [{ errorType: 'e', errorLevel: 'WARNING', errorDescription: 'd', errorReferences: [] }] });
  check('summarizeState', sum.nodesLeft === 2 && sum.driving && sum.batteryCharge === 55 && sum.errors[0].errorType === 'e' && sum.paused === false);
  check('normalizeConfig defaults', normalizeConfig({}).ok && normalizeConfig({}).config.brokerUrl === DEFAULT_CONFIG.brokerUrl);
  check('normalizeConfig rejects bad url', normalizeConfig({ brokerUrl: 'http://x' }).ok === false);
  check('normalizeConfig rejects bad subscription', normalizeConfig({ subscriptions: [{ manufacturer: 'a/b' }] }).ok === false);
  check('normalizeConfig fills wildcard', normalizeConfig({ subscriptions: [{ serialNumber: 'tb3' }] }).config.subscriptions[0].manufacturer === '+');
}

// --- 2. 브리지 + 가짜 MQTT ---
class FakeMqttClient extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.subscribed = [];
    this.published = [];
    this.ended = false;
    setTimeout(() => this.emit('connect'), 5);
  }
  subscribe(topics) { this.subscribed.push(...(Array.isArray(topics) ? topics : [topics])); }
  publish(topic, payload, opts) { this.published.push({ topic, message: JSON.parse(payload), opts }); }
  end(force, opts, cb) { this.ended = true; cb?.(); }
  inject(topic, message) { this.emit('message', topic, Buffer.from(JSON.stringify(message))); }
}

{
  const dataDir = await mkdtemp(join(tmpdir(), 'pf-vda5050-'));
  const clients = [];
  const poses = [];
  const bridge = await createVda5050Bridge({
    dataDir,
    onPose: (robotId, pose) => poses.push({ robotId, pose }),
    connect: async (url) => { const c = new FakeMqttClient(url); clients.push(c); return c; },
    log: () => {},
  });
  check('disabled by default: no client created', clients.length === 0 && bridge.status.connected === false);

  const app = express();
  app.use(express.json());
  app.use('/api', bridge.router);
  const server = createServer(app);
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== bridge.streamPath) return socket.destroy();
    bridge.wss.handleUpgrade(req, socket, head, (ws) => bridge.wss.emit('connection', ws, req));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };

  let r = await api('GET', '/api/vda5050/config');
  check('GET config returns defaults + status', r.status === 200 && r.body.config.enabled === false && r.body.status.connected === false && r.body.supportedInstantActions.includes('cancelOrder'));

  r = await api('PUT', '/api/vda5050/config', { brokerUrl: 'nope' });
  check('PUT config validates', r.status === 400);

  r = await api('PUT', '/api/vda5050/config', { ...DEFAULT_CONFIG, enabled: true, brokerUrl: 'mqtt://broker.test:1883', subscriptions: [{ manufacturer: 'dcrobot', serialNumber: '+' }] });
  await sleep(30);
  check('PUT config enables -> client connected to the URL', r.status === 200 && clients.length === 1 && clients[0].url === 'mqtt://broker.test:1883' && bridge.status.connected === true);
  check('subscribes connection/state/visualization for each subscription', clients[0].subscribed.length === 3 && clients[0].subscribed.includes('uagv/v2/dcrobot/+/state'));

  // WS 구독자: 스냅샷 먼저
  const ws = new WebSocket(base.replace('http', 'ws') + bridge.streamPath);
  const wsMsgs = [];
  ws.on('message', (d) => wsMsgs.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  await sleep(30);
  check('stream sends snapshot first', wsMsgs[0]?.type === 'snapshot' && Array.isArray(wsMsgs[0].robots) && wsMsgs[0].status.connected === true);

  // 로봇 메시지 수신
  const c = clients[0];
  c.inject('uagv/v2/dcrobot/tb3-sim-01/connection', { headerId: 0, connectionState: 'ONLINE' });
  c.inject('uagv/v2/dcrobot/tb3-sim-01/state', { headerId: 3, agvPosition: { x: 0, y: 0, theta: 0, positionInitialized: false } }); // 위치 미확정: onPose 안 됨
  c.inject('uagv/v2/dcrobot/tb3-sim-01/visualization', { headerId: 1, agvPosition: { x: 1.5, y: -2, theta: 0.3, mapId: 'default', positionInitialized: true }, velocity: { vx: 0.2, vy: 0, omega: 0 } });
  c.inject('uagv/v2/dcrobot/tb3-sim-01/state', { headerId: 2, orderId: 'abc', orderUpdateId: 0, lastNodeId: 'n1', nodeStates: [{}, {}], edgeStates: [], driving: true, paused: false, agvPosition: { x: 1.6, y: -2, theta: 0.3, mapId: 'default', positionInitialized: true }, errors: [], actionStates: [], operatingMode: 'AUTOMATIC', safetyState: { eStop: 'NONE', fieldViolation: false } });
  c.inject('other/topic', { ignored: true });
  c.emit('message', 'uagv/v2/dcrobot/tb3-sim-01/state', Buffer.from('not json'));
  await sleep(20);
  check('onPose called for initialised positions only', poses.length === 2 && poses[0].robotId === 'tb3-sim-01' && poses[0].pose.headingRad === 0.3 && poses[1].pose.x === 1.6);
  r = await api('GET', '/api/vda5050/robots');
  const rec = r.body.robots.find((x) => x.serialNumber === 'tb3-sim-01');
  check('robot record: ONLINE, position, summarised state', rec?.connectionState === 'ONLINE' && rec.position.x === 1.6 && rec.state.orderId === 'abc' && rec.state.nodesLeft === 2 && rec.velocity.vx === 0.2);
  check('stream broadcasts robot updates', wsMsgs.filter((m) => m.type === 'robot' && m.robot.key === 'dcrobot/tb3-sim-01').length >= 3);
  check('findOnlineBySerial', bridge.findOnlineBySerial('tb3-sim-01')?.manufacturer === 'dcrobot' && bridge.findOnlineBySerial('ghost') === null);

  // order 발행
  r = await api('POST', '/api/vda5050/robots/dcrobot/tb3-sim-01/order', { path: [[1.6, -2], [3, -2], [3, 0]], mapId: 'default' });
  const pub = c.published.at(-1);
  check('POST order publishes to the robot order topic', r.status === 200 && pub.topic === 'uagv/v2/dcrobot/tb3-sim-01/order' && pub.message.orderId === r.body.orderId && pub.message.nodes.length === 3 && pub.message.orderUpdateId === 0);
  check('order header identifies the RCS', pub.message.manufacturer === 'dcrobot' && pub.message.serialNumber === 'pathfinder-rcs' && pub.message.version === '2.0.0');
  const firstOrderId = r.body.orderId;
  r = await api('POST', '/api/vda5050/robots/dcrobot/tb3-sim-01/order', { path: [[3, -2], [3, 0]], updatePrevious: true });
  check('updatePrevious keeps orderId and bumps orderUpdateId', r.body.orderId === firstOrderId && r.body.orderUpdateId === 1 && c.published.at(-1).message.orderUpdateId === 1);
  r = await api('POST', '/api/vda5050/robots/dcrobot/tb3-sim-01/order', { path: [] });
  check('POST order validates path', r.status === 400);

  // instantActions
  r = await api('POST', '/api/vda5050/robots/dcrobot/tb3-sim-01/instant-actions', { actionType: 'stopPause' });
  check('POST instant-actions publishes', r.status === 200 && c.published.at(-1).topic.endsWith('/instantActions') && c.published.at(-1).message.actions[0].actionType === 'stopPause' && c.published.at(-1).message.actions[0].actionId === r.body.actionId);
  r = await api('POST', '/api/vda5050/robots/dcrobot/tb3-sim-01/instant-actions', { actionType: 'selfDestruct' });
  check('unsupported instant action rejected', r.status === 400);

  // forget
  r = await api('DELETE', '/api/vda5050/robots/dcrobot/tb3-sim-01');
  check('DELETE forgets the robot', r.body.existed === true && (await api('GET', '/api/vda5050/robots')).body.robots.length === 0);

  // 재설정 -> 이전 클라이언트 end, 새 클라이언트
  r = await api('PUT', '/api/vda5050/config', { ...DEFAULT_CONFIG, enabled: true, brokerUrl: 'mqtt://other.test:1883' });
  await sleep(30);
  check('re-PUT config reconnects (old client ended, new URL)', c.ended && clients.length === 2 && clients[1].url === 'mqtt://other.test:1883');
  r = await api('POST', '/api/vda5050/robots/dcrobot/tb3-sim-01/order', { path: [[0, 0]] });
  check('order to a never-seen robot still publishes (RCS decides)', r.status === 200 && clients[1].published.length === 1);

  // 비활성화 -> 발행 503
  await api('PUT', '/api/vda5050/config', { ...DEFAULT_CONFIG, enabled: false, brokerUrl: 'mqtt://other.test:1883' });
  await sleep(10);
  r = await api('POST', '/api/vda5050/robots/dcrobot/tb3-sim-01/order', { path: [[0, 0]] });
  check('publishing while disconnected -> 503', r.status === 503 && clients[1].ended);
  check('config persisted to disk', (await api('GET', '/api/vda5050/config')).body.config.brokerUrl === 'mqtt://other.test:1883');

  ws.close();
  await bridge.close();
  server.close();
  await rm(dataDir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nall vda5050 bridge smoke checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);

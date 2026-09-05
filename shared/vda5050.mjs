// VDA5050 2.x helpers shared by server/vda5050.mjs (MQTT bridge) and the
// browser's 플릿 (RCS) tab. The robot side lives in a different repo
// (ros-chromium/robot-os-chromium packages/nodes/src/vda5050.js) and carries
// its own copy of the same conventions -- the two are pinned to each other
// by hand, like shared/scanAlignment.mjs and its Python/Swift twins.
// Design + fixed values: doc/vda5050-rcs.md in the workspace root.

export const VDA5050_VERSION = '2.0.0';
export const TOPIC_NAMES = ['connection', 'state', 'visualization', 'order', 'instantActions', 'factsheet'];

/** Persisted bridge configuration (data/vda5050.json). */
export const DEFAULT_CONFIG = {
  enabled: false,
  brokerUrl: 'mqtt://127.0.0.1:1883',
  interfaceName: 'uagv',
  majorVersion: 'v2',
  manufacturer: 'dcrobot', // used for the RCS's own header when publishing orders
  // MQTT wildcards allowed: '+' = every manufacturer / serial.
  subscriptions: [{ manufacturer: '+', serialNumber: '+' }],
  // A robot whose last message is older than this is shown as stale.
  staleAfterMs: 5000,
};

export function vda5050Topic({ interfaceName, majorVersion, manufacturer, serialNumber }, name) {
  if (!TOPIC_NAMES.includes(name)) throw new Error(`unknown VDA5050 topic name "${name}"`);
  return `${interfaceName}/${majorVersion}/${manufacturer}/${serialNumber}/${name}`;
}

export function parseVda5050Topic(topic) {
  const parts = String(topic).split('/');
  if (parts.length !== 5 || !TOPIC_NAMES.includes(parts[4])) return null;
  const [interfaceName, majorVersion, manufacturer, serialNumber, name] = parts;
  return { interfaceName, majorVersion, manufacturer, serialNumber, name };
}

export function robotKey(manufacturer, serialNumber) {
  return `${manufacturer}/${serialNumber}`;
}

export function vda5050Header({ headerId, manufacturer, serialNumber, version = VDA5050_VERSION, timestamp = new Date().toISOString() }) {
  return { headerId, timestamp, version, manufacturer, serialNumber };
}

/** pathfinder path [[x, y], ...] -> VDA5050 order (all released, even/odd sequenceIds). */
export function pathToOrder(path, { orderId, orderUpdateId = 0, mapId, header = {} }) {
  if (!Array.isArray(path) || path.length === 0) throw new Error('path must be a non-empty [[x, y], ...]');
  if (!path.every((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))) {
    throw new Error('path points must be [x, y] numbers');
  }
  if (typeof orderId !== 'string' || !orderId) throw new Error('orderId required');
  const nodes = path.map(([x, y], i) => ({
    nodeId: `n${i}`,
    sequenceId: i * 2,
    released: true,
    nodePosition: { x, y, ...(mapId ? { mapId } : {}) },
    actions: [],
  }));
  const edges = path.slice(1).map((_, i) => ({
    edgeId: `e${i}`,
    sequenceId: i * 2 + 1,
    released: true,
    startNodeId: `n${i}`,
    endNodeId: `n${i + 1}`,
    actions: [],
  }));
  return { ...header, orderId, orderUpdateId, nodes, edges };
}

/** One instantActions message (2.0 field name `actions`). */
export function instantActionsMessage(actionType, { actionId, actionParameters = [], blockingType = 'HARD', header = {} }) {
  if (typeof actionType !== 'string' || !actionType) throw new Error('actionType required');
  return { ...header, actions: [{ actionId, actionType, blockingType, actionParameters }] };
}

/** agvPosition -> pathfinder live-pose shape, or null when the robot has no position yet. */
export function poseFromAgvPosition(agvPosition, timestamp = Date.now()) {
  if (!agvPosition || agvPosition.positionInitialized === false) return null;
  const { x, y, theta } = agvPosition;
  if (![x, y, theta].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return { x, y, headingRad: theta, timestamp };
}

/** Trim a state message to what the fleet table shows (drop nothing the UI needs, keep payloads small). */
export function summarizeState(state) {
  if (!state || typeof state !== 'object') return null;
  return {
    orderId: state.orderId ?? '',
    orderUpdateId: state.orderUpdateId ?? 0,
    lastNodeId: state.lastNodeId ?? '',
    nodesLeft: Array.isArray(state.nodeStates) ? state.nodeStates.length : null,
    driving: state.driving === true,
    paused: state.paused === true,
    operatingMode: state.operatingMode ?? null,
    batteryCharge: typeof state.batteryState?.batteryCharge === 'number' ? state.batteryState.batteryCharge : null,
    charging: state.batteryState?.charging === true,
    errors: Array.isArray(state.errors) ? state.errors.map((e) => ({ errorType: e.errorType, errorLevel: e.errorLevel, errorDescription: e.errorDescription })) : [],
    actionStates: Array.isArray(state.actionStates) ? state.actionStates.slice(-5) : [],
    eStop: state.safetyState?.eStop ?? null,
  };
}

const SUBSCRIPTION_PART_RE = /^[A-Za-z0-9_.:+-]+$/;

/** Validate a config document coming from the UI; returns { ok, config | error }. */
export function normalizeConfig(input) {
  const cfg = { ...DEFAULT_CONFIG, ...(input ?? {}) };
  if (typeof cfg.enabled !== 'boolean') return { ok: false, error: 'enabled must be a boolean' };
  if (typeof cfg.brokerUrl !== 'string' || !/^(mqtt|mqtts|ws|wss):\/\/.+/.test(cfg.brokerUrl)) {
    return { ok: false, error: 'brokerUrl must start with mqtt://, mqtts://, ws:// or wss://' };
  }
  for (const k of ['interfaceName', 'majorVersion', 'manufacturer']) {
    if (typeof cfg[k] !== 'string' || !SUBSCRIPTION_PART_RE.test(cfg[k]) || cfg[k] === '+') return { ok: false, error: `${k} is not a valid topic segment` };
  }
  if (!Array.isArray(cfg.subscriptions) || cfg.subscriptions.length === 0) return { ok: false, error: 'subscriptions must be a non-empty array' };
  const subscriptions = [];
  for (const s of cfg.subscriptions) {
    const manufacturer = String(s?.manufacturer ?? '+').trim() || '+';
    const serialNumber = String(s?.serialNumber ?? '+').trim() || '+';
    if (!SUBSCRIPTION_PART_RE.test(manufacturer) || !SUBSCRIPTION_PART_RE.test(serialNumber)) return { ok: false, error: `invalid subscription ${manufacturer}/${serialNumber}` };
    subscriptions.push({ manufacturer, serialNumber });
  }
  const staleAfterMs = Number(cfg.staleAfterMs);
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 500) return { ok: false, error: 'staleAfterMs must be >= 500' };
  return {
    ok: true,
    config: {
      enabled: cfg.enabled,
      brokerUrl: cfg.brokerUrl,
      interfaceName: cfg.interfaceName,
      majorVersion: cfg.majorVersion,
      manufacturer: cfg.manufacturer,
      subscriptions,
      staleAfterMs,
    },
  };
}

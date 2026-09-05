// 로봇 기기(/api/robots) 및 로봇 모델 사양(/api/robot-models) CRUD API 클라이언트.
const ROBOTS_URL = '/api/robots';
const MODELS_URL = '/api/robot-models';

async function handle(res) {
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `요청 실패 (${res.status})`);
  }
  return data;
}

// --- 로봇 기기 (Fleet Devices) ---
export function listRobots() {
  return fetch(ROBOTS_URL).then(handle);
}

export function getRobot(id) {
  return fetch(`${ROBOTS_URL}/${id}`).then(handle);
}

export function createRobot(robot) {
  return fetch(ROBOTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(robot),
  }).then(handle);
}

export function updateRobot(id, robot) {
  return fetch(`${ROBOTS_URL}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(robot),
  }).then(handle);
}

export function deleteRobot(id) {
  return fetch(`${ROBOTS_URL}/${id}`, { method: 'DELETE' }).then(handle);
}

// --- 로봇 모델 카탈로그 (Robot Models) ---
export function listRobotModels() {
  return fetch(MODELS_URL).then(handle);
}

export function getRobotModel(id) {
  return fetch(`${MODELS_URL}/${id}`).then(handle);
}

export function createRobotModel(model) {
  return fetch(MODELS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(model),
  }).then(handle);
}

export function updateRobotModel(id, model) {
  return fetch(`${MODELS_URL}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(model),
  }).then(handle);
}

export function deleteRobotModel(id) {
  return fetch(`${MODELS_URL}/${id}`, { method: 'DELETE' }).then(handle);
}

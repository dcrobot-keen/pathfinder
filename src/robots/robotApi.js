// 로봇 등록 CRUD API 클라이언트 (server/robots.mjs, :3001, Vite가 /api를 프록시).
const BASE_URL = '/api/robots';

async function handle(res) {
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `요청 실패 (${res.status})`);
  }
  return data;
}

export function listRobots() {
  return fetch(BASE_URL).then(handle);
}

export function createRobot(robot) {
  return fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(robot),
  }).then(handle);
}

export function updateRobot(id, robot) {
  return fetch(`${BASE_URL}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(robot),
  }).then(handle);
}

export function deleteRobot(id) {
  return fetch(`${BASE_URL}/${id}`, { method: 'DELETE' }).then(handle);
}

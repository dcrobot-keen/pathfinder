// server/simControl.mjs 호출용 클라이언트 -- 설정 › 시뮬레이터 카드.
async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

/** { worlds: string[] } -- deploy/worlds/ 의 *.world.json | *.slicemap.json 파일명 */
export function getSimWorlds() {
  return request('/api/sim/worlds');
}

/** 프로젝트별 저장된 설정. { world, robots: [{id, spawn}] } */
export function getSimConfig(projectId) {
  return request(`/api/sim/config/${encodeURIComponent(projectId)}`);
}

/** 저장하고 docker compose 로 시뮬레이터를 (재)시작한다. { ok, world, robots } */
export function startSim(projectId, world, robots) {
  return request('/api/sim/start', { method: 'POST', body: { projectId, world, robots } });
}

/** 시뮬레이터 관련 컨테이너만 정지 (mosquitto/dashboard/signaling 은 그대로). { ok } */
export function stopSim() {
  return request('/api/sim/stop', { method: 'POST' });
}

/** { simulator, driver1, driver2, configs } -- docker compose ps 파싱 */
export function getSimStatus() {
  return request('/api/sim/status');
}

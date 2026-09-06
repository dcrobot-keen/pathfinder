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

/** 프로젝트(현장)별 저장된 설정. { world, robots: [{id, spawn}], ports } */
export function getSimConfig(projectId) {
  return request(`/api/sim/config/${encodeURIComponent(projectId)}`);
}

/** 저장하고 docker compose 로 이 현장의 시뮬레이터를 (재)시작한다. 포트는 현장마다 자동 배정되며 재시작해도
 *  유지된다. { ok, world, robots, ports } */
export function startSim(projectId, world, robots) {
  return request(`/api/sim/start/${encodeURIComponent(projectId)}`, { method: 'POST', body: { world, robots } });
}

/** 이 현장의 시뮬레이터 컨테이너만 정지 (공유 인프라·다른 현장은 그대로). { ok } */
export function stopSim(projectId) {
  return request(`/api/sim/stop/${encodeURIComponent(projectId)}`, { method: 'POST' });
}

/** { simulator, driver1, driver2, world, robots, ports } -- 이 현장의 docker compose ps 파싱 */
export function getSimStatus(projectId) {
  return request(`/api/sim/status/${encodeURIComponent(projectId)}`);
}

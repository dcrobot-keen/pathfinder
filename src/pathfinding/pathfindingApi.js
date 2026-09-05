// pathfinder/server (Go, :3002) 호출용 클라이언트. Vite가 /api/path를 프록시한다.
async function postPath(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `요청 실패 (${res.status})`);
  }
  return data; // { path: [[x,y],...], distance, algorithm }
}

/** 노드/링크 그래프 위에서 경로를 찾는다 (algorithm: "dijkstra" | "astar"). */
export function findNodeLinkPath({ featureCollection, start, end, algorithm }) {
  return postPath('/api/path/nodelink', { featureCollection, start, end, algorithm });
}

/**
 * block(폴리곤) 장애물을 피해 자유 공간에서 경로를 찾는다 (algorithm: "gridastar" | "hybridastar").
 * inflationM: 로봇 반경 + 여유(m). Go 서버가 장애물을 이만큼 부풀려 벽에서 떨어진 경로를 낸다
 * (없으면 셀 중심 경로가 벽에 붙어 실제/시뮬레이터 몸체가 충돌한다). 출발점 주변은 다시 비운다.
 */
export function findObstaclePath({ featureCollection, start, end, algorithm, cellSize, inflationM }) {
  return postPath('/api/path/obstacle', { featureCollection, start, end, algorithm, cellSize, inflationM });
}

/** 등록 로봇 크기(지름, m) -> 계획 시 장애물 인플레이션(반경 + 5 cm 여유). */
export function inflationForRobot(sizeMeters, fallbackSizeMeters = 0.5) {
  const size = Number.isFinite(sizeMeters) && sizeMeters > 0 ? sizeMeters : fallbackSizeMeters;
  return Math.round((size / 2 + 0.05) * 1000) / 1000;
}

// server/index.mjs(:3001, ROS 없음)의 폐루프 제어 릴레이 호출용. ros-chromium의
// apps/sim-driver가 이 요청을 구독해 PathFollowerNode로 넘기고, 그 결과가 실제
// 시뮬레이터(ros-chromium/simulator)를 움직인다 -- doc/architecture-improvements.md 참고.
export async function sendDriveRequest(robotId, path) {
  const res = await fetch(`/api/drive-request/${encodeURIComponent(robotId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `요청 실패 (${res.status})`);
  }
  return data;
}

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

/** block(폴리곤) 장애물을 피해 자유 공간에서 경로를 찾는다 (algorithm: "gridastar" | "hybridastar"). */
export function findObstaclePath({ featureCollection, start, end, algorithm, cellSize }) {
  return postPath('/api/path/obstacle', { featureCollection, start, end, algorithm, cellSize });
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

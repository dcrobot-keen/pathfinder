// scripts/import-scan-to-map-studio.mjs가 data/imported/<room>.geojson에 써둔
// 결과를 읽어오는 API 클라이언트.
const BASE_URL = '/api/imported-obstacles';

/** @returns {Promise<string[]>} 가져오기(import)된 방 이름 목록 */
export async function listImportedRooms() {
  const res = await fetch(BASE_URL);
  if (!res.ok) {
    throw new Error(`목록 조회 실패 (${res.status})`);
  }
  const data = await res.json();
  return data.rooms;
}

/** @returns {Promise<GeoJSON.FeatureCollection>} */
export async function loadImportedObstacles(room) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(room)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `불러오기 실패 (${res.status})`);
  }
  return res.json();
}

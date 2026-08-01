// 노드/링크/블록 편집 레이어를 위한 GeoJSON 파일 DB(서버) 클라이언트.
const API_URL = '/api/nodelink';

/** @returns {Promise<GeoJSON.FeatureCollection>} */
export async function loadFeatureCollection() {
  const res = await fetch(API_URL);
  if (!res.ok) {
    throw new Error(`불러오기 실패 (${res.status})`);
  }
  return res.json();
}

/**
 * @param {GeoJSON.FeatureCollection} featureCollection
 * @returns {Promise<{ ok: boolean, featureCount: number }>}
 */
export async function saveFeatureCollection(featureCollection) {
  const res = await fetch(API_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(featureCollection),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `저장 실패 (${res.status})`);
  }
  return res.json();
}

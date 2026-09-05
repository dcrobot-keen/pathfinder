/**
 * Client for the scan-to-map-studio FastAPI server (:8000).
 * Connects via the Vite proxy (/api/scan-studio) or directly to http://localhost:8000.
 */

const PROXY_BASE = '/api/scan-studio';
const DIRECT_BASE = 'http://localhost:8000/api';

let activeBase = PROXY_BASE;

async function request(path, options = {}) {
  try {
    const res = await fetch(`${activeBase}${path}`, options);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[${res.status}] ${errText || res.statusText}`);
    }
    return await res.json();
  } catch (err) {
    // If proxy failed on initial request, try direct fallback
    if (activeBase === PROXY_BASE && err.message.includes('Failed to fetch')) {
      activeBase = DIRECT_BASE;
      const res = await fetch(`${activeBase}${path}`, options);
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`[${res.status}] ${errText || res.statusText}`);
      }
      return await res.json();
    }
    throw err;
  }
}

export async function listScanProjects() {
  return request('/projects');
}

export async function createScanProject(name) {
  const form = new FormData();
  form.set('name', name);
  return request('/projects', { method: 'POST', body: form });
}

export async function processScanProject(name, {
  scanFile,
  usdzFile,
  robotMapPgm = null,
  robotMapYaml = null,
  trajectory = null,
  removeIsolatedClusters = false,
  classify = false,
}) {
  const file = scanFile || usdzFile;
  const form = new FormData();
  if (file) {
    form.set('scan_file', file);
    form.set('usdz', file);
  }
  if (robotMapPgm) form.set('robot_map_pgm', robotMapPgm);
  if (robotMapYaml) form.set('robot_map_yaml', robotMapYaml);
  if (trajectory) form.set('trajectory', trajectory);
  form.set('remove_isolated_clusters', String(Boolean(removeIsolatedClusters)));
  form.set('classify', String(Boolean(classify)));

  return request(`/projects/${encodeURIComponent(name)}/process`, {
    method: 'POST',
    body: form,
  });
}

export async function uploadGroupZip(file, name = '') {
  const form = new FormData();
  form.set('file', file);
  if (name) form.set('name', name);
  return request('/groups/upload', {
    method: 'POST',
    body: form,
  });
}

export async function getScanProjectStatus(name) {
  return request(`/projects/${encodeURIComponent(name)}/status`);
}


// ---- 다중 스캔 그룹 (정합 워크스페이스 네이티브 통합, architecture-improvements ⑱) ----
export function listGroups() {
  return request('/groups');
}

export function prepareGroup(name) {
  return request(`/groups/${encodeURIComponent(name)}/prepare`, { method: 'POST' });
}

/** 스캔별 슬라이스(b64 코드 격자)·정합·지표·바닥 이미지·게이트 -- 워크스페이스 페이로드 */
export function getGroupWorkspace(name) {
  return request(`/groups/${encodeURIComponent(name)}/workspace`);
}

export function postGroupMetrics(name, body) {
  return request(`/groups/${encodeURIComponent(name)}/metrics`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

export function postGroupIcp(name, body) {
  return request(`/groups/${encodeURIComponent(name)}/icp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

/** 저장: 서버가 group_alignment.json 을 쓰고 합성 슬라이스맵을 다시 만들어 publish 한다 */
export function putGroupAlignment(name, doc) {
  return request(`/groups/${encodeURIComponent(name)}/alignment`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc),
  });
}

export function getGroupMergedSlicemap(name) {
  return request(`/groups/${encodeURIComponent(name)}/merged.slicemap.json`);
}

export function getGroupMergedFloorMeta(name) {
  return request(`/groups/${encodeURIComponent(name)}/merged.floor.json`);
}

/** 그룹의 파일(merged.png, merged.floor.png ...) URL -- <img>/fetch 용 */
export function groupFileUrl(name, file) {
  return `${activeBase}/groups/${encodeURIComponent(name)}/${file}`;
}

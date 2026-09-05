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
  usdzFile,
  robotMapPgm = null,
  robotMapYaml = null,
  trajectory = null,
  removeIsolatedClusters = false,
  classify = false,
}) {
  const form = new FormData();
  form.set('usdz', usdzFile);
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

export async function getScanProjectStatus(name) {
  return request(`/projects/${encodeURIComponent(name)}/status`);
}

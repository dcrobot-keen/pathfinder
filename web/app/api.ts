/** Thin fetch wrapper for the server/app.py FastAPI backend. Plain `fetch` is
 * enough for this surface -- no HTTP client library needed. Requests to
 * `/api` and files at `/files` are same-origin via the Vite dev-server proxy
 * (see vite.config.ts), so no base URL / CORS handling is required.
 */

export type ProjectPhase = 'running' | 'done' | 'error' | 'needs-attention';

export interface ProjectSummary {
  name: string;
  phase: ProjectPhase;
  steps: Record<string, string>;
  error: string | null;
  mtime: number;
}

export interface StatusResponse {
  phase: 'running' | 'done' | 'error' | null;
  steps: Record<string, string>;
  log: string[];
  error: string | null;
}

export interface ReportJson {
  name: string;
  timestamp: string;
  num_raw_points: number;
  num_base_points: number;
  ceiling_z: number;
  outliers_removed: number;
  isolated_clusters_removed: number | null;
  n_free: number;
  n_occupied: number;
  num_wall_planes: number | null;
  class_counts: { floor: number; wall: number; furniture: number } | null;
  num_rooms: number;
  num_furniture: number;
  registration: { rotation_deg: number; translation: [number, number]; rmse: number; iterations: number } | null;
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export function listProjects(): Promise<ProjectSummary[]> {
  return fetch('/api/projects').then((res) => asJson<ProjectSummary[]>(res));
}

export function createProject(name: string): Promise<{ name: string }> {
  const form = new FormData();
  form.set('name', name);
  return fetch('/api/projects', { method: 'POST', body: form }).then((res) => asJson<{ name: string }>(res));
}

export interface ProcessOptions {
  usdz: File;
  robotMapPgm?: File;
  robotMapYaml?: File;
  trajectory?: File;
  removeIsolatedClusters?: boolean;
  classify?: boolean;
}

export function processProject(name: string, opts: ProcessOptions): Promise<{ status: string }> {
  const form = new FormData();
  form.set('usdz', opts.usdz);
  if (opts.robotMapPgm && opts.robotMapYaml) {
    form.set('robot_map_pgm', opts.robotMapPgm);
    form.set('robot_map_yaml', opts.robotMapYaml);
  }
  if (opts.trajectory) form.set('trajectory', opts.trajectory);
  form.set('remove_isolated_clusters', String(!!opts.removeIsolatedClusters));
  form.set('classify', String(!!opts.classify));
  return fetch(`/api/projects/${encodeURIComponent(name)}/process`, { method: 'POST', body: form }).then((res) =>
    asJson<{ status: string }>(res),
  );
}

export function getStatus(name: string): Promise<StatusResponse> {
  return fetch(`/api/projects/${encodeURIComponent(name)}/status`).then((res) => asJson<StatusResponse>(res));
}

export function alignGeojson(name: string, geojson: File): Promise<{ url: string }> {
  const form = new FormData();
  form.set('geojson', geojson);
  return fetch(`/api/projects/${encodeURIComponent(name)}/align/geojson`, { method: 'POST', body: form }).then((res) =>
    asJson<{ url: string }>(res),
  );
}

export function alignImage(name: string, image: File): Promise<{ url: string }> {
  const form = new FormData();
  form.set('image', image);
  return fetch(`/api/projects/${encodeURIComponent(name)}/align/image`, { method: 'POST', body: form }).then((res) =>
    asJson<{ url: string }>(res),
  );
}

export function getReport(name: string): Promise<ReportJson> {
  return fetch(fileUrl(name, 'report.json')).then((res) => asJson<ReportJson>(res));
}

export function fileUrl(name: string, path: string): string {
  return `/files/${encodeURIComponent(name)}/${path}`;
}

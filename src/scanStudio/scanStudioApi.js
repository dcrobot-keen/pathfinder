// scan-engine(FastAPI, 구 scan-to-map-studio, :8000) 클라이언트.
//
// openapi-fetch 를 scan-engine/openapi.json 에서 생성한 타입(scanEngine.gen.d.ts)으로 묶어서
// 경로·메서드·경로 파라미터·요청 본문이 엔진과 어긋나면 `npm run check:api`(tsc, checkJs)에서 잡힌다.
// 엔진 라우트를 바꾸면 `npm run gen:scan-engine-api` 로 타입을 다시 만든다.
//
// 응답은 엔진이 `-> dict` 로 선언해 스키마가 자유 객체라 여기서는 any 로 풀어 넘긴다(호출부는 예전과
// 같은 모양). 응답 모델(pydantic)을 붙이면 그때부터 응답도 타입이 붙는다.
//
// 주소: Vite dev 프록시 `/scan-engine/*` -> http://localhost:8000/* (vite.config.js). 프록시가 없는
// 환경(빌드 정적 서빙 등)에서 네트워크 오류가 나면 직접 주소로 한 번 갈아탄다.
import createClient from 'openapi-fetch';

/** @typedef {import('./scanEngine.gen').paths} Paths */

const PROXY_BASE = '/scan-engine';
const DIRECT_BASE = 'http://localhost:8000';

/** @type {import('openapi-fetch').Client<Paths>} */
const proxyClient = createClient({ baseUrl: PROXY_BASE });
/** @type {import('openapi-fetch').Client<Paths>} */
const directClient = createClient({ baseUrl: DIRECT_BASE });
let active = proxyClient;
let activeBase = PROXY_BASE;

/**
 * openapi-fetch 결과 -> data (오류면 [status] detail 로 throw)
 * @param {{ data?: unknown, error?: unknown, response: Response }} result
 * @returns {any}
 */
function unwrap({ data, error, response }) {
  if (!response.ok || (error !== undefined && error !== null)) {
    const detail = typeof error === 'string' ? error : error ? JSON.stringify(error) : response.statusText;
    throw new Error(`[${response.status}] ${detail}`);
  }
  return data;
}

/**
 * 프록시로 시도하고, 프록시 자체가 없어서(네트워크 오류) 실패하면 직접 주소로 재시도.
 * @template T
 * @param {(client: import('openapi-fetch').Client<Paths>) => Promise<T>} op
 * @returns {Promise<any>}
 */
async function call(op) {
  try {
    return unwrap(/** @type {any} */ (await op(active)));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (active === proxyClient && /Failed to fetch|NetworkError|ECONNREFUSED/.test(msg)) {
      active = directClient;
      activeBase = DIRECT_BASE;
      return unwrap(/** @type {any} */ (await op(active)));
    }
    throw err;
  }
}

/** multipart/form-data 본문: 값이 있는 필드만 FormData 로 (File/Blob/string) */
function formSerializer(body) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(body ?? {})) {
    if (v === undefined || v === null) continue;
    fd.set(k, /** @type {any} */ (v));
  }
  return fd;
}

// ---- 단일 스캔 프로젝트 (스캔 위저드) ----------------------------------------------
export function listScanProjects() {
  return call((c) => c.GET('/api/projects'));
}

export function createScanProject(name) {
  return call((c) => c.POST('/api/projects', { body: { name }, bodySerializer: formSerializer }));
}

export function processScanProject(name, {
  scanFile,
  usdzFile,
  robotMapPgm = null,
  robotMapYaml = null,
  trajectory = null,
  removeIsolatedClusters = false,
  classify = false,
}) {
  const file = scanFile || usdzFile;
  return call((c) => c.POST('/api/projects/{name}/process', {
    params: { path: { name } },
    body: /** @type {any} */ ({
      // 엔진은 usdz 필드로 받는다 (.usdz 또는 앱 zip 패키지 -- 서버가 확장자로 구분)
      usdz: file,
      robot_map_pgm: robotMapPgm ?? undefined,
      robot_map_yaml: robotMapYaml ?? undefined,
      trajectory: trajectory ?? undefined,
      remove_isolated_clusters: String(Boolean(removeIsolatedClusters)),
      classify: String(Boolean(classify)),
    }),
    bodySerializer: formSerializer,
  }));
}

export function getScanProjectStatus(name) {
  return call((c) => c.GET('/api/projects/{name}/status', { params: { path: { name } } }));
}

// ---- 다중 스캔 그룹 (정합 워크스페이스 네이티브 통합, architecture-improvements ⑱) ----
export function uploadGroupZip(file, name = '') {
  return call((c) => c.POST('/api/groups/upload', {
    body: /** @type {any} */ ({ file, name: name || undefined }),
    bodySerializer: formSerializer,
  }));
}

export function listGroups() {
  return call((c) => c.GET('/api/groups'));
}

export function prepareGroup(name) {
  return call((c) => c.POST('/api/groups/{name}/prepare', { params: { path: { name } } }));
}

/** 스캔별 슬라이스(b64 코드 격자)·정합·지표·바닥 이미지·게이트 -- 워크스페이스 페이로드 */
export function getGroupWorkspace(name) {
  return call((c) => c.GET('/api/groups/{name}/workspace', { params: { path: { name } } }));
}

export function postGroupMetrics(name, body) {
  return call((c) => c.POST('/api/groups/{name}/metrics', { params: { path: { name } }, body }));
}

export function postGroupIcp(name, body) {
  return call((c) => c.POST('/api/groups/{name}/icp', { params: { path: { name } }, body }));
}

/** 저장: 서버가 group_alignment.json 을 쓰고 합성 슬라이스맵을 다시 만들어 publish 한다 */
export function putGroupAlignment(name, doc) {
  return call((c) => c.PUT('/api/groups/{name}/alignment', { params: { path: { name } }, body: doc }));
}

export function getGroupMergedSlicemap(name) {
  return call((c) => c.GET('/api/groups/{name}/merged.slicemap.json', { params: { path: { name } } }));
}

export function getGroupMergedFloorMeta(name) {
  return call((c) => c.GET('/api/groups/{name}/merged.floor.json', { params: { path: { name } } }));
}

/** 그룹의 파일(merged.png, merged.floor.png ...) URL -- <img>/fetch 용 */
export function groupFileUrl(name, file) {
  return `${activeBase}/api/groups/${encodeURIComponent(name)}/${file}`;
}

/** 엔진이 정적으로 내주는 프로젝트 파일 (/files/<project>/...) -- 위저드가 slicemap/floorplan 을 읽는다 */
export function scanFileUrl(project, file) {
  return `${activeBase}/files/${encodeURIComponent(project)}/${file}`;
}

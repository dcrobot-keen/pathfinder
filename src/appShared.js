// 여러 탭(2D 지도 / 3D 뷰 / 길찾기 두 모드)이 공유하는 좌표계와 데이터 소스.
// 하나의 VectorSource를 여러 지도 인스턴스의 레이어가 동시에 참조할 수 있으므로,
// 여기 둔 소스를 채우면 그걸 구독하는 모든 탭이 항상 최신 상태를 보여준다.
//
// 2026-08-30부터 "프로젝트"(독립된 좌표 평면 하나) 개념이 생기면서, 이 파일이
// 만드는 좌표계/평면 크기는 더 이상 전역 상수가 아니라 "지금 활성화된 프로젝트"
// 기준으로 매번 정해진다 — doc/architecture-improvements.md 참고. 프로젝트
// 전환은 지도 인스턴스를 그 자리에서 다시 만드는 대신 `?project=<id>` 쿼리
// 파라미터를 바꾸고 페이지를 새로고침하는 방식으로 처리한다(OL 뷰/소스를 살아있는
// 상태로 재구성하는 것보다 훨씬 단순하고, 탭마다 중복된 초기화 코드를 안 건드려도
// 됨). 그래서 이 모듈은 로드 시점에 활성 프로젝트를 한 번 정하고, 나머지 앱은
// 그 결과(크기·투영법)를 상수처럼 그대로 가져다 쓴다.
import Projection from 'ol/proj/Projection.js';
import { addProjection } from 'ol/proj.js';
import VectorSource from 'ol/source/Vector.js';
import { listProjects, createProject } from './projects/projectApi.js';

const params = new URLSearchParams(location.search);

// 서버가 최초 실행 시 "기본 프로젝트"를 항상 시드하므로 빈 목록은 있을 수 없는
// 상황이지만, 혹시 모를 경우를 대비해 방어적으로 하나 만든다.
// 프로젝트 선택 UI(projectSelector.js)가 재조회 없이 바로 쓰는 전체 목록.
export let allProjects = await listProjects();
if (allProjects.length === 0) {
  allProjects = [await createProject({ name: '기본 프로젝트' })];
}

const requestedId = params.get('project');
const activeProject = allProjects.find((p) => p.id === requestedId) ?? allProjects[0];

// 주소창을 활성 프로젝트로 정규화해둔다(새로고침해도 같은 프로젝트가 유지되고,
// 주소를 복사해서 공유하면 같은 프로젝트가 열리도록) -- 새로고침 없이 URL만 갱신.
if (params.get('project') !== activeProject.id) {
  const url = new URL(location.href);
  url.searchParams.set('project', activeProject.id);
  history.replaceState(null, '', url);
}
export const activeProjectId = activeProject.id;
export const activeProjectName = activeProject.name;
// POST /api/projects/from-slicemap 으로 만든 프로젝트는 자기 스캔 장애물 방(room)을
// 기억한다 -- 열자마자 main.js가 importedObstacleSource에 불러온다.
export const activeProjectImportedRoom = activeProject.importedRoom ?? null;
// 정합 워크스페이스가 합성한 바닥 이미지(앱 floorplan) -- { url, extent:[minX,minY,maxX,maxY] } (프로젝트 평면).
export const activeProjectFloorImage = activeProject.floorImage ?? null;
// from-slicemap 프로젝트의 슬라이스맵 헤더 { resolution, cols, rows, origin, z, sources } -- 현장 3D 가 스캔 메시 배치에 쓴다.
export const activeProjectSlicemap = activeProject.slicemap ?? null;

// 실내 지도용 평면 좌표계: 0,0을 기점으로 m 단위, 활성 프로젝트가 정한 크기.
export const MAP_SIZE_X = activeProject.sizeX;
export const MAP_SIZE_Y = activeProject.sizeY;
export const indoorProjection = new Projection({
  // 프로젝트마다 크기(=extent)가 다를 수 있어 code도 프로젝트별로 달라야 한다 --
  // OL의 프로젝션 레지스트리는 code 하나당 정의 하나만 허용한다.
  code: `indoor-plane-${activeProjectId}`,
  units: 'm',
  extent: [0, 0, MAP_SIZE_X, MAP_SIZE_Y],
});
addProjection(indoorProjection);

// 컬러드 PCD 포인트 (전체/높이 슬라이스 레이어들이 공유하는 원본 소스)
export const pcdSource = new VectorSource();

// 노드/링크/블록 편집 데이터 (편집 탭과 길찾기 탭이 공유) -- 활성 프로젝트 소유.
export const nodeLinkSource = new VectorSource();

// scan-to-map-studio에서 가져온(import) 장애물 블록. 사용자가 손으로 그린
// nodeLinkSource와는 별도로 관리해, 재가져오기(re-import)가 수동 편집 데이터를
// 절대 건드리지 않게 한다. 경로탐색 요청을 만들 때 nodeLinkSource와 합쳐서 보낸다.
// (지금은 프로젝트와 무관하게 전역 — 어느 프로젝트에서든 같은 가져오기 목록을
// 고를 수 있다. 스캔 방과 프로젝트를 1:1로 묶는 건 이번 범위 밖.)
export const importedObstacleSource = new VectorSource();

// 실시간 로봇 위치(liveRobotPose.js가 채움) — 2D 지도 탭과 길찾기(장애물) 탭이
// 하나의 WebSocket 연결과 이 소스를 공유하고, 각 탭은 자기 VectorLayer로만 감싼다.
export const liveRobotPoseSource = new VectorSource();

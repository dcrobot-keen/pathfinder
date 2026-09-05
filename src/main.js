import './style.css';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import ImageLayer from 'ol/layer/Image.js';
import ImageStatic from 'ol/source/ImageStatic.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { defaults as defaultControls } from 'ol/control.js';
import ScaleLine from 'ol/control/ScaleLine.js';
import MousePosition from 'ol/control/MousePosition.js';
import { createStringXY } from 'ol/coordinate.js';
import { parsePcd } from './pcd.js';
import { createView3D } from './view3d.js';
import { buildHeightBands, createSliceLayers, renderSlicePanel } from './heightSlices.js';
import VectorLayer from 'ol/layer/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { createEditLayer } from './editLayer.js';
import { buildGridLayer } from './grid2d.js';
import { indoorProjection, MAP_SIZE_X, MAP_SIZE_Y, activeProjectName, pcdSource, importedObstacleSource, liveRobotPoseSource, activeProjectImportedRoom, activeProjectFloorImage } from './appShared.js';
import { importedObstacleStyle, createImportedObstaclesPanel } from './importedObstacles.js';
import { loadImportedObstacles } from './importedObstaclesApi.js';
import { startLiveRobotPoseTracking } from './liveRobotPose.js';
import { createPathfindingTab } from './pathfinding/tab.js';
import { createRobotRegistryTab } from './robots/robotRegistry.js';
import { createBrokerSettings } from './fleet/brokerSettings.js';
import { createProjectSelector } from './projects/projectSelector.js';

createProjectSelector(document.getElementById('project-selector'));
document.title = `Pathfinder — ${activeProjectName}`;

const SLICE_HEIGHT_M = 0.5;

// 2D 지도 맨 아래 깔리는 배경 도면. data/에 있는 파일을 vite 에셋으로 바로
// 참조한다(별도 서버/정적 경로 설정 없이 dev·build 양쪽에서 동작).
// 실측 동서(가로) 폭은 25.923m. 이미지 픽셀이 정사각형(3840x3840)이라 남북(세로)도
// 같은 축척(25.923m)으로 가정했다 — 세로 실측이 다르면 BLUEPRINT_HEIGHT_M만
// 따로 바꾸면 된다. world file(정확한 원점 옵셋)이 없어서 우선 지도 원점(0,0)에
// 왼쪽 아래를 맞춰 깔았다 — 실제 배치 지점이 다르면 imageExtent의 원점을
// 옮겨야 한다.
const BLUEPRINT_WIDTH_M = 25.923;
const BLUEPRINT_HEIGHT_M = 25.923;
const BLUEPRINT_URL = new URL('../data/blueprint_9108.jpg', import.meta.url).href;
// 스캔 지도로 만든 프로젝트(from-slicemap + floor)는 앱의 바닥 이미지를 배경으로 깐다 --
// 정합 워크스페이스가 같은 격자로 합성해 publish 한 <group>.floor.png. 없으면 예전 샘플 도면.
const BLUEPRINT_LABEL = activeProjectFloorImage ? '바닥 이미지 (앱 스캔)' : '배경 도면';
const blueprintLayer = new ImageLayer({
  source: new ImageStatic(
    activeProjectFloorImage
      ? { url: activeProjectFloorImage.url, imageExtent: activeProjectFloorImage.extent, projection: indoorProjection }
      : { url: BLUEPRINT_URL, imageExtent: [0, 0, BLUEPRINT_WIDTH_M, BLUEPRINT_HEIGHT_M], projection: indoorProjection }
  ),
  // 샘플 도면은 꺼둔 채 시작(레이어 패널에서 켬); 스캔 바닥 이미지는 프로젝트의 것이라 바로 보인다.
  visible: Boolean(activeProjectFloorImage),
  opacity: activeProjectFloorImage ? 0.85 : 1,
});

const gridLayer = buildGridLayer(MAP_SIZE_X, MAP_SIZE_Y, 10);

// scan-to-map-studio에서 가져온(import) 장애물 블록 레이어 (공유 소스, appShared.js 참고)
const importedObstacleLayer = new VectorLayer({ source: importedObstacleSource, style: importedObstacleStyle });

// 실시간 로봇 위치 레이어. WebSocket 연결은 여기서 한 번만 시작하고, 길찾기(장애물)
// 탭은 같은 liveRobotPoseSource를 자기 레이어로만 감싼다(appShared.js 참고).
const liveRobotPoseLayer = new VectorLayer({ source: liveRobotPoseSource, zIndex: 20 });
startLiveRobotPoseTracking(liveRobotPoseSource);

const map = new Map({
  target: 'map',
  layers: [blueprintLayer, gridLayer, importedObstacleLayer, liveRobotPoseLayer],
  view: new View({
    projection: indoorProjection,
    center: [MAP_SIZE_X / 2, MAP_SIZE_Y / 2],
    zoom: 1,
    minZoom: 0,
    maxZoom: 8,
    extent: [
      -MAP_SIZE_X * 0.2,
      -MAP_SIZE_Y * 0.2,
      MAP_SIZE_X * 1.2,
      MAP_SIZE_Y * 1.2,
    ],
    // 이 extent는 "화면 중심이 벗어날 수 없는 범위"로만 쓴다(constrainOnlyCenter).
    // 기본값(false)이면 확대/축소 배율도 이 extent 안에 다 들어오게 강제되는데,
    // 데이터는 세로가 긴 200x400인데 브라우저 창은 보통 가로로 넓어서(landscape),
    // 그 상태로 축소하면 필요한 배율이 extent의 가로 폭을 넘어버려 OL이 축소를
    // 막아버린다 — 그 결과 세로(400m)를 다 못 보여주고 잘렸다. 그냥 팬 범위만
    // 제한하고 배율 자체는 fit()이 정하는 대로 두면 해결된다.
    constrainOnlyCenter: true,
  }),
  controls: defaultControls().extend([
    new ScaleLine({ units: 'metric' }),
    new MousePosition({
      coordinateFormat: createStringXY(2),
      projection: indoorProjection,
      className: 'mouse-position',
    }),
  ]),
});

// 처음 실행 시 200x400m 공장 부지 전체가 보이도록 뷰를 맞춘다(고정 zoom 대신
// fit을 써서 가로세로 비율이 달라도 항상 전체 부지가 프레임에 들어오게 함).
// updateSize()를 먼저 호출해야 한다 — 생성 직후에는 OL이 아직 컨테이너 크기를
// 측정하지 않은 상태라, 그 전에 fit()을 부르면 잘못된(0에 가까운) 크기 기준으로
// 계산해서 세로(400m)가 다 안 보이는 등 엉뚱한 확대 배율이 나올 수 있다.
map.updateSize();
map.getView().fit([0, 0, MAP_SIZE_X, MAP_SIZE_Y], { padding: [20, 20, 20, 20] });

// 컬러드 PCD(3D) 포인트 클라우드 레이어 ("전체(비분류)" 옵션으로 남겨둠)
const pcdLayer = new WebGLVectorLayer({
  source: pcdSource,
  style: {
    'circle-radius': 2,
    'circle-fill-color': ['color', ['get', 'r'], ['get', 'g'], ['get', 'b']],
    'circle-opacity': 0.9,
  },
});
map.addLayer(pcdLayer);

// 노드/링크/블록 편집 레이어 (GeoJSON 파일 DB에 저장)
const editLayerApi = createEditLayer(map, indoorProjection, document.getElementById('edit-panel'));

// "스캔 장애물" 패널: scan-to-map-studio에서 가져온(import) 방을 골라 불러온다.
const importedGeojsonFormat = new GeoJSON({
  dataProjection: indoorProjection,
  featureProjection: indoorProjection,
});
createImportedObstaclesPanel(
  document.getElementById('imported-obstacles-panel'),
  importedGeojsonFormat,
  map
);

// 스캔 지도로 만든 프로젝트(from-slicemap)는 자기 장애물 방을 열자마자 불러오고
// 그 범위로 뷰를 맞춘다 -- 사용자가 패널에서 다시 고르지 않아도 되도록.
if (activeProjectImportedRoom) {
  loadImportedObstacles(activeProjectImportedRoom)
    .then((fc) => {
      importedObstacleSource.clear();
      importedObstacleSource.addFeatures(importedGeojsonFormat.readFeatures(fc));
      const extent = importedObstacleSource.getExtent();
      if (extent.every(Number.isFinite)) map.getView().fit(extent, { padding: [40, 40, 40, 40], maxZoom: 7 });
    })
    .catch((err) => console.error('프로젝트 스캔 장애물 자동 로드 실패', err));
}

// PCD를 아직 업로드하지 않은 초기 상태에도 레이어 토글 패널이 보이도록 먼저 한 번 그린다
// (배경 도면 / 노드·링크·블록만 — 높이 슬라이스·원본 PCD는 업로드 후에 채워짐).
renderSlicePanel(document.getElementById('slice-panel'), [], [], [
  { layer: blueprintLayer, label: BLUEPRINT_LABEL },
  { layer: importedObstacleLayer, label: '스캔 장애물 (scan-to-map-studio)' },
  { layer: editLayerApi.layer, label: '노드/링크/블록' },
  { layer: liveRobotPoseLayer, label: '실시간 로봇 위치 (vps-system)' },
]);

// 탭 전환 (2D 지도 / 3D 뷰 / 길찾기 두 모드). 3D 뷰와 길찾기 탭은 처음 열릴 때 지연 초기화한다.
const tabButtons = document.querySelectorAll('.tab-button');
const viewEls = document.querySelectorAll('.view');
const view3dEl = document.getElementById('view3d');
const subTabBar = document.getElementById('maps-subtabs');
const subTabButtons = subTabBar.querySelectorAll('.subtab');

let view3d = null;
let currentPoints = [];
let sliceLayers = [];
let operateTab = null;
let simulationTab = null;
let robotsTab = null;
let settingsTab = null;
let mapsSub = '2d';

// 탭 = 정보 구조(플릿 스튜디오 기획서 §5): 지도(2D/3D) · 로봇 · 운영 · 시뮬레이션 · 설정.
// "운영"과 "시뮬레이션"은 같은 길찾기 모듈의 두 변형이고, 각 화면은 처음 열 때 한 번 만든다.
function showView(key) {
  viewEls.forEach((el) => el.classList.toggle('active', el.dataset.view === key));
}

function activateMapsSub(sub) {
  mapsSub = sub;
  subTabButtons.forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
  showView(sub);
  if (sub === '2d') {
    map.updateSize();
    return;
  }
  if (sub === 'studio') {
    const frame = document.getElementById('studio-frame');
    const link = document.getElementById('link-studio-external');
    let studioUrl = 'http://localhost:8000/groups';
    try {
      const saved = localStorage.getItem('pathfinder_services_endpoints');
      if (saved) {
        const { studio } = JSON.parse(saved);
        if (studio) studioUrl = studio;
      }
    } catch {}
    if (frame && (!frame.src || !frame.src.includes('8000'))) frame.src = studioUrl;
    if (link) link.href = studioUrl;
    return;
  }
  if (!view3d) {
    view3d = createView3D(view3dEl);
    if (currentPoints.length) {
      view3d.setPoints(currentPoints);
    }
  }
  view3d.resize();
}

// 스튜디오 프로젝트 새로고침 버튼
const studioRefreshBtn = document.getElementById('btn-studio-refresh');
if (studioRefreshBtn) {
  studioRefreshBtn.addEventListener('click', () => {
    window.location.reload();
  });
}

// 시뮬레이션 3D 뷰어 제어 (접기/펼치기, 로봇 전환)
const simViewerWrap = document.getElementById('simulation-viewer-wrap');
const viewerToggleBtn = document.getElementById('btn-viewer-toggle');
if (viewerToggleBtn && simViewerWrap) {
  viewerToggleBtn.addEventListener('click', () => {
    const isCollapsed = simViewerWrap.classList.toggle('collapsed');
    viewerToggleBtn.textContent = isCollapsed ? '3D 펼치기' : '3D 접기';
  });
}
const simBotBtns = document.querySelectorAll('.sim-bot-btn');
const simFrame = document.getElementById('sim-frame');
const simExtLink = document.getElementById('link-sim-external');
simBotBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    simBotBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const url = btn.dataset.url;
    if (simFrame && url) simFrame.src = url;
    if (simExtLink && url) simExtLink.href = url;
  });
});

function activateTab(tabKey) {
  tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabKey));
  subTabBar.hidden = tabKey !== 'maps';

  if (tabKey === 'maps') {
    activateMapsSub(mapsSub);
    return;
  }
  showView(tabKey);

  if (tabKey === 'operate') {
    if (!operateTab) {
      operateTab = createPathfindingTab(document.getElementById('operate'), document.getElementById('operate-panel'), 'obstacle', { variant: 'operate' });
      operateTab.fitToData();
    }
    operateTab.resize();
    return;
  }

  if (tabKey === 'simulation') {
    if (!simulationTab) {
      simulationTab = createPathfindingTab(document.getElementById('simulation'), document.getElementById('simulation-panel'), 'obstacle', { variant: 'demo' });
      simulationTab.fitToData();
    }
    simulationTab.resize();
    return;
  }

  if (tabKey === 'robots' && !robotsTab) {
    robotsTab = createRobotRegistryTab(document.getElementById('robots'));
  }

  if (tabKey === 'settings' && !settingsTab) {
    settingsTab = createBrokerSettings(document.getElementById('settings'));
  }
}

tabButtons.forEach((btn) => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));
subTabButtons.forEach((btn) => btn.addEventListener('click', () => activateMapsSub(btn.dataset.sub)));

/**
 * 새로 로드된 PCD 포인트를 2D 지도(높이 슬라이스 포함)와 3D 뷰 양쪽에 동시에 반영한다.
 * 업로드로 파일이 바뀔 때마다 이 함수 하나로 두 뷰의 좌표/레이어가 함께 갱신된다.
 */
function applyPoints(points, label) {
  currentPoints = points;

  // 2D: 원본 포인트 레이어 갱신
  pcdSource.clear();
  pcdSource.addFeatures(
    points.map(
      (p) =>
        new Feature({
          geometry: new Point([p.x, p.y]),
          r: p.r,
          g: p.g,
          b: p.b,
          z: p.z,
        })
    )
  );
  pcdLayer.setVisible(false);

  // 2D: 기존 높이 슬라이스 레이어 제거 후 새 데이터 기준으로 재생성
  sliceLayers.forEach((layer) => map.removeLayer(layer));
  const bands = buildHeightBands(points, SLICE_HEIGHT_M);
  sliceLayers = createSliceLayers(pcdSource, bands);
  sliceLayers.forEach((layer) => map.addLayer(layer));
  renderSlicePanel(document.getElementById('slice-panel'), bands, sliceLayers, [
    { layer: blueprintLayer, label: BLUEPRINT_LABEL },
    { layer: editLayerApi.layer, label: '노드/링크/블록' },
    { layer: importedObstacleLayer, label: '스캔 장애물 (scan-to-map-studio)' },
    { layer: liveRobotPoseLayer, label: '실시간 로봇 위치 (vps-system)' },
    { layer: pcdLayer, label: `전체 (비분류) — ${label}`, checked: false },
  ]);

  // 2D: 새 데이터의 실제 좌표 범위에 맞춰 뷰 자동 이동/줌
  const extent = pcdSource.getExtent();
  map.getView().fit(extent, { padding: [40, 40, 40, 40], maxZoom: 7 });

  // 3D: 뷰가 이미 열려 있으면 즉시 반영 (열려있지 않으면 다음에 열 때 currentPoints로 초기화됨)
  if (view3d) {
    view3d.setPoints(points);
  }

  setPcdStatus(`${label}: ${points.length}개 포인트`);
  console.log(`PCD 적용 완료 (${label}): ${points.length}개 포인트`);
}

// 상단 공용 PCD 업로드: 파일이 바뀌면 2D/3D 뷰가 함께 갱신된다.
// 기본값으로 자동 로드되는 PCD는 없음 — 업로드 전까지는 빈 지도 상태를 유지한다.
const pcdFileInput = document.getElementById('pcd-file-input');
const pcdStatusEl = document.getElementById('pcd-status');

function setPcdStatus(text) {
  pcdStatusEl.textContent = text;
}
setPcdStatus('PCD를 업로드하세요.');

pcdFileInput.addEventListener('change', async () => {
  const file = pcdFileInput.files[0];
  if (!file) return;
  setPcdStatus(`${file.name} 로딩 중...`);
  try {
    const buffer = await file.arrayBuffer();
    const { points } = parsePcd(buffer);
    applyPoints(points, file.name);
  } catch (err) {
    console.error(err);
    setPcdStatus(`로드 실패: ${err.message}`);
  }
});

// 3D 뷰 패널: 포인트 / 메쉬 표시 전환
const btnViewPoints = document.getElementById('btn-view-points');
const btnViewMesh = document.getElementById('btn-view-mesh');
const meshStatusEl = document.getElementById('mesh-status');

function setMeshStatus(text) {
  meshStatusEl.textContent = text;
}

function setViewModeButtons(mode) {
  btnViewPoints.classList.toggle('active', mode === 'points');
  btnViewMesh.classList.toggle('active', mode === 'mesh');
}

btnViewPoints.addEventListener('click', () => {
  if (!view3d) return;
  view3d.setDisplayMode('points');
  setViewModeButtons('points');
});

btnViewMesh.addEventListener('click', () => {
  if (!view3d) return;
  setMeshStatus('메쉬 생성 중...');
  // 버튼 클릭 피드백이 먼저 그려지도록 다음 프레임에 무거운 변환을 실행
  requestAnimationFrame(() => {
    try {
      const { triangleCount, grid } = view3d.convertToMesh({ voxelSize: 0.08 });
      setViewModeButtons('mesh');
      setMeshStatus(`삼각형 ${triangleCount}개 (격자 ${grid.nx}x${grid.ny}x${grid.nz})`);
    } catch (err) {
      console.error(err);
      setMeshStatus(`변환 실패: ${err.message}`);
    }
  });
});

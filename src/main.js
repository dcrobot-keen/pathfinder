import './style.css';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { defaults as defaultControls } from 'ol/control.js';
import ScaleLine from 'ol/control/ScaleLine.js';
import MousePosition from 'ol/control/MousePosition.js';
import { createStringXY } from 'ol/coordinate.js';
import { loadPcd, parsePcdAscii } from './pcd.js';
import { createView3D } from './view3d.js';
import { buildHeightBands, createSliceLayers, renderSlicePanel } from './heightSlices.js';
import { createEditLayer } from './editLayer.js';
import { buildGridLayer } from './grid2d.js';
import { indoorProjection, MAP_SIZE_M, pcdSource } from './appShared.js';
import { createPathfindingTab } from './pathfinding/tab.js';

const SAMPLE_PCD_URL = '/samples/sample-room.pcd';
const SLICE_HEIGHT_M = 0.5;

const gridLayer = buildGridLayer(MAP_SIZE_M, 10);

const map = new Map({
  target: 'map',
  layers: [gridLayer],
  view: new View({
    projection: indoorProjection,
    center: [MAP_SIZE_M / 2, MAP_SIZE_M / 2],
    zoom: 2,
    minZoom: 0,
    maxZoom: 8,
    extent: [
      -MAP_SIZE_M * 0.2,
      -MAP_SIZE_M * 0.2,
      MAP_SIZE_M * 1.2,
      MAP_SIZE_M * 1.2,
    ],
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
createEditLayer(map, indoorProjection, document.getElementById('edit-panel'));

// 탭 전환 (2D 지도 / 3D 뷰 / 길찾기 두 모드). 3D 뷰와 길찾기 탭은 처음 열릴 때 지연 초기화한다.
const tabButtons = document.querySelectorAll('.tab-button');
const viewEls = document.querySelectorAll('.view');
const view3dEl = document.getElementById('view3d');

let view3d = null;
let currentPoints = [];
let sliceLayers = [];
let pfNodeLinkTab = null;
let pfObstacleTab = null;

function activateTab(tabKey) {
  tabButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabKey));
  viewEls.forEach((el) => el.classList.toggle('active', el.dataset.view === tabKey));

  if (tabKey === '2d') {
    map.updateSize();
    return;
  }

  if (tabKey === '3d') {
    if (!view3d) {
      view3d = createView3D(view3dEl);
      if (currentPoints.length) {
        view3d.setPoints(currentPoints);
      }
    }
    view3d.resize();
    return;
  }

  if (tabKey === 'pf-nodelink') {
    if (!pfNodeLinkTab) {
      pfNodeLinkTab = createPathfindingTab(
        document.getElementById('pf-nodelink'),
        document.getElementById('pf-nodelink-panel'),
        'nodelink'
      );
      pfNodeLinkTab.fitToData();
    }
    pfNodeLinkTab.resize();
    return;
  }

  if (tabKey === 'pf-obstacle') {
    if (!pfObstacleTab) {
      pfObstacleTab = createPathfindingTab(
        document.getElementById('pf-obstacle'),
        document.getElementById('pf-obstacle-panel'),
        'obstacle'
      );
      pfObstacleTab.fitToData();
    }
    pfObstacleTab.resize();
  }
}

tabButtons.forEach((btn) => btn.addEventListener('click', () => activateTab(btn.dataset.tab)));

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
  renderSlicePanel(document.getElementById('slice-panel'), bands, sliceLayers, {
    layer: pcdLayer,
    label: '전체 (비분류)',
  });

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

// 초기 샘플 PCD 로드
loadPcd(SAMPLE_PCD_URL)
  .then(({ points }) => applyPoints(points, 'sample-room.pcd'))
  .catch((err) => {
    console.error(err);
    setPcdStatus(`샘플 PCD 로드 실패: ${err.message}`);
  });

// 상단 공용 PCD 업로드: 파일이 바뀌면 2D/3D 뷰가 함께 갱신된다
const pcdFileInput = document.getElementById('pcd-file-input');
const pcdStatusEl = document.getElementById('pcd-status');

function setPcdStatus(text) {
  pcdStatusEl.textContent = text;
}

pcdFileInput.addEventListener('change', async () => {
  const file = pcdFileInput.files[0];
  if (!file) return;
  setPcdStatus(`${file.name} 로딩 중...`);
  try {
    const text = await file.text();
    const { points } = parsePcdAscii(text);
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

import './style.css';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import Projection from 'ol/proj/Projection.js';
import { addProjection } from 'ol/proj.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import Style from 'ol/style/Style.js';
import Stroke from 'ol/style/Stroke.js';
import Text from 'ol/style/Text.js';
import Fill from 'ol/style/Fill.js';
import { defaults as defaultControls } from 'ol/control.js';
import ScaleLine from 'ol/control/ScaleLine.js';
import MousePosition from 'ol/control/MousePosition.js';
import { createStringXY } from 'ol/coordinate.js';
import { loadPcd, parsePcdAscii } from './pcd.js';
import { createView3D } from './view3d.js';
import { buildHeightBands, createSliceLayers, renderSlicePanel } from './heightSlices.js';

const SAMPLE_PCD_URL = '/samples/sample-room.pcd';
const SLICE_HEIGHT_M = 0.5;

// 실내 지도용 평면 좌표계 정의: 0,0을 기점으로 m 단위, 200m x 200m 범위
const MAP_SIZE_M = 200;
const indoorProjection = new Projection({
  code: 'indoor-plane',
  units: 'm',
  extent: [0, 0, MAP_SIZE_M, MAP_SIZE_M],
});
addProjection(indoorProjection);

// 10m 간격 기준선 레이어
function buildGridSource(size, step) {
  const source = new VectorSource();
  for (let x = 0; x <= size; x += step) {
    source.addFeature(
      new Feature({
        geometry: new LineString([
          [x, 0],
          [x, size],
        ]),
        label: x % (step * 5) === 0 ? `${x}m` : null,
      })
    );
  }
  for (let y = 0; y <= size; y += step) {
    source.addFeature(
      new Feature({
        geometry: new LineString([
          [0, y],
          [size, y],
        ]),
        label: y % (step * 5) === 0 ? `${y}m` : null,
      })
    );
  }
  return source;
}

const gridLayer = new VectorLayer({
  source: buildGridSource(MAP_SIZE_M, 10),
  style: (feature) => {
    const label = feature.get('label');
    return new Style({
      stroke: new Stroke({
        color: label ? 'rgba(80,80,80,0.6)' : 'rgba(150,150,150,0.35)',
        width: label ? 1.2 : 0.6,
      }),
      text: label
        ? new Text({
            text: label,
            font: '11px sans-serif',
            fill: new Fill({ color: '#333' }),
            placement: 'point',
          })
        : undefined,
    });
  },
});

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
const pcdSource = new VectorSource();
const pcdLayer = new WebGLVectorLayer({
  source: pcdSource,
  style: {
    'circle-radius': 2,
    'circle-fill-color': ['color', ['get', 'r'], ['get', 'g'], ['get', 'b']],
    'circle-opacity': 0.9,
  },
});
map.addLayer(pcdLayer);

// 2D / 3D 탭 전환 및 3D 뷰 지연 초기화
const mapEl = document.getElementById('map');
const view3dEl = document.getElementById('view3d');
const tab2dBtn = document.getElementById('tab-2d');
const tab3dBtn = document.getElementById('tab-3d');

let view3d = null;
let currentPoints = [];
let sliceLayers = [];

function activateTab(tab) {
  const is2d = tab === '2d';
  mapEl.classList.toggle('active', is2d);
  view3dEl.classList.toggle('active', !is2d);
  tab2dBtn.classList.toggle('active', is2d);
  tab3dBtn.classList.toggle('active', !is2d);

  if (is2d) {
    map.updateSize();
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

tab2dBtn.addEventListener('click', () => activateTab('2d'));
tab3dBtn.addEventListener('click', () => activateTab('3d'));

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

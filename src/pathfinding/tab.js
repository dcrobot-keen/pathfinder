import Map from 'ol/Map.js';
import View from 'ol/View.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import Feature from 'ol/Feature.js';
import PointGeom from 'ol/geom/Point.js';
import Draw from 'ol/interaction/Draw.js';
import Snap from 'ol/interaction/Snap.js';
import Style from 'ol/style/Style.js';
import CircleStyle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import Text from 'ol/style/Text.js';
import { defaults as defaultControls } from 'ol/control.js';
import ScaleLine from 'ol/control/ScaleLine.js';
import { indoorProjection, MAP_SIZE_M, pcdSource, nodeLinkSource } from '../appShared.js';
import { buildGridLayer } from '../grid2d.js';
import { nodeLinkStyle } from '../nodeLinkStyle.js';
import { findNodeLinkPath, findObstaclePath } from './pathfindingApi.js';
import { animatePathAndRobot, randomPathColor, REFERENCE_SIZE_M as DEFAULT_SIZE_M } from './robotAnimation.js';
import { listRobots } from '../robots/robotApi.js';
import { typeLabel } from '../robots/robotCodes.js';

const MODE_CONFIG = {
  nodelink: {
    title: '길찾기 (노드/링크)',
    algorithms: [
      ['astar', 'A*'],
      ['dijkstra', 'Dijkstra'],
    ],
    snapping: true,
    hint: '링크 위를 클릭해 시작점을 찍고, 다시 클릭해 도착점을 찍으세요.',
  },
  obstacle: {
    title: '길찾기 (장애물 회피)',
    algorithms: [
      ['hybridastar', 'Hybrid A*'],
      ['gridastar', 'Grid A*'],
    ],
    snapping: false,
    hint: '지도 빈 공간을 클릭해 시작점을 찍고, 다시 클릭해 도착점을 찍으세요.',
  },
};

function markerStyle(role) {
  return new Style({
    image: new CircleStyle({
      radius: 8,
      fill: new Fill({ color: role === 'start' ? '#2ecc71' : '#e74c3c' }),
      stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
    text: new Text({
      text: role === 'start' ? 'S' : 'E',
      fill: new Fill({ color: '#fff' }),
      font: 'bold 11px sans-serif',
    }),
  });
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y;
    if (intersects) {
      const xCross = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
}

/**
 * 길찾기 탭 하나(노드/링크 모드 또는 장애물 회피 모드)를 컨테이너에 구성한다.
 * @param {HTMLElement} mapEl
 * @param {HTMLElement} panelEl
 * @param {'nodelink' | 'obstacle'} mode
 */
export function createPathfindingTab(mapEl, panelEl, mode) {
  const config = MODE_CONFIG[mode];

  const floorLayer = new WebGLVectorLayer({
    source: pcdSource,
    filter: ['between', ['get', 'z'], 0, 0.5],
    style: {
      'circle-radius': 1.5,
      'circle-fill-color': ['color', ['get', 'r'], ['get', 'g'], ['get', 'b']],
      'circle-opacity': 0.6,
    },
  });
  const graphLayer = new VectorLayer({ source: nodeLinkSource, style: nodeLinkStyle });
  const interactionSource = new VectorSource();
  const interactionLayer = new VectorLayer({ source: interactionSource, zIndex: 10 });

  const map = new Map({
    target: mapEl,
    layers: [buildGridLayer(MAP_SIZE_M, 10), floorLayer, graphLayer, interactionLayer],
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
    controls: defaultControls().extend([new ScaleLine({ units: 'metric' })]),
  });

  const geojsonFormat = new GeoJSON({
    dataProjection: indoorProjection,
    featureProjection: indoorProjection,
  });

  const draw = new Draw({ source: interactionSource, type: 'Point' });
  map.addInteraction(draw);
  if (config.snapping) {
    map.addInteraction(new Snap({ source: nodeLinkSource }));
  }

  let pendingRole = 'start';
  let pendingStartCoord = null;
  const activeAnimations = [];
  const robotsById = new Map();
  const validAlgorithms = new Set(config.algorithms.map(([value]) => value));

  // --- Deconfliction 1단계: 근접 감지 + pause/resume ---
  // 동시에 여러 start/end 쌍을 만들 수 있으므로, 로봇 마커끼리 너무 가까워지면
  // 나중에 출발한(우선순위 낮은) 쪽을 잠깐 멈춰 충돌을 피한다.
  // 재탐색(re-routing)은 다음 단계 — 지금은 감지+정지까지만.
  //
  // 반경은 로봇 크기(sizeMeters) 기반으로 계산한다: 두 로봇 몸체가 맞닿기 시작하는
  // 거리(두 크기의 평균)를 pause 기준으로, 지나가는(우선순위 높은) 로봇의 크기만큼
  // 더 벌어져야 resume하도록 여유를 둔다.
  //
  // 매 틱마다 "현재 활성 상태인" 모든 상위 우선순위 로봇을 기준으로 다시 판정한다 —
  // 그래야 막고 있던 로봇이 먼저 도착해서 activeAnimations에서 빠졌을 때도(경로 종료)
  // 그 즉시 대기 중이던 로봇이 자동으로 풀린다. 특정 쌍만 한 번 판정하고 끝내면,
  // 상대가 사라진 뒤에도 그 판정이 갱신되지 않아 영원히 멈춰있는(사실상 데드락처럼
  // 보이는) 상태가 됐었다.
  let nextAnimId = 1;
  const pairDistanceHistory = new Map(); // "id1:id2" -> 직전 측정 거리
  let lastPausedCount = 0;

  function checkConflicts() {
    let debugMsg = '';
    for (let j = 0; j < activeAnimations.length; j++) {
      const lower = activeAnimations[j];
      const lowerSize = lower.sizeMeters ?? DEFAULT_SIZE_M;
      let blocked = false;

      for (let i = 0; i < j; i++) {
        // i < j: 먼저 출발한(=배열에 먼저 들어온) 쪽이 우선순위가 높다.
        const higher = activeAnimations[i];
        const higherSize = higher.sizeMeters ?? DEFAULT_SIZE_M;

        const [ax, ay] = higher.getPosition();
        const [bx, by] = lower.getPosition();
        const d = Math.hypot(ax - bx, ay - by);

        const pauseRadius = (higherSize + lowerSize) / 2;
        const clearRadius = pauseRadius + higherSize; // 지나가는 로봇 크기만큼 여유

        const key = `${higher.id}:${lower.id}`;
        const prevD = pairDistanceHistory.get(key);
        pairDistanceHistory.set(key, d);

        if (d < pauseRadius) {
          blocked = true;
        } else if (d < clearRadius) {
          // hysteresis 구간: 아직 확실히 멀어지는 중이 아니면 계속 대기시킨다
          // (같은 속도로 나란히 움직이는 로봇들이 멈췄다 풀렸다 반복하는 것 방지).
          const movingApart = prevD === undefined || d >= prevD;
          if (!movingApart) blocked = true;
        }

        // 진단용: 실제로 이 틱에서 계산된 값을 콘솔에 남긴다. 예상과 다른 거리에서
        // pause가 걸리면 여기 로그로 실측치(d/pauseRadius/clearRadius)를 바로 확인할 수 있다.
        if (blocked && !lower.isPaused()) {
          console.log(
            `[deconflict] pause 로봇#${lower.id} <- #${higher.id}: d=${d.toFixed(2)}m, pauseRadius=${pauseRadius.toFixed(2)}m, clearRadius=${clearRadius.toFixed(2)}m`
          );
          debugMsg = ` (실측 ${d.toFixed(2)}m / 기준 ${pauseRadius.toFixed(2)}m)`;
        }
      }

      if (blocked && !lower.isPaused()) lower.pause();
      if (!blocked && lower.isPaused()) lower.resume();
    }

    const pausedCount = activeAnimations.filter((a) => a.isPaused()).length;
    if (pausedCount !== lastPausedCount) {
      lastPausedCount = pausedCount;
      setStatus(
        pausedCount > 0
          ? `충돌 회피: 로봇 ${pausedCount}대 대기 중${debugMsg}`
          : '충돌 회피 해제, 계속 진행'
      );
    }
  }
  setInterval(checkConflicts, 200);

  let pendingStartFeature = null;

  draw.on('drawend', (evt) => {
    const coord = evt.feature.getGeometry().getCoordinates();
    evt.feature.set('role', pendingRole);
    evt.feature.setStyle(markerStyle(pendingRole));

    if (pendingRole === 'start') {
      pendingStartCoord = coord;
      pendingStartFeature = evt.feature;
      pendingRole = 'end';
      setStatus('도착점을 클릭하세요.');
    } else {
      const startCoord = pendingStartCoord;
      const startFeature = pendingStartFeature;
      pendingRole = 'start';
      pendingStartCoord = null;
      pendingStartFeature = null;
      requestPath(startCoord, coord, [startFeature, evt.feature]);
    }
  });

  async function requestPath(startCoord, endCoord, markerFeatures = []) {
    setStatus('경로 계산 중...');
    const featureCollection = geojsonFormat.writeFeaturesObject(nodeLinkSource.getFeatures());
    const start = { x: startCoord[0], y: startCoord[1] };
    const end = { x: endCoord[0], y: endCoord[1] };
    const algorithm = algorithmSelect.value;
    const selectedRobot = robotsById.get(robotSelect.value) || null;

    try {
      const result =
        mode === 'nodelink'
          ? await findNodeLinkPath({ featureCollection, start, end, algorithm })
          : await findObstaclePath({ featureCollection, start, end, algorithm, cellSize: 0.2 });

      const anim = animatePathAndRobot(map, interactionSource, result.path, {
        color: randomPathColor(),
        iconSrc: selectedRobot?.icon,
        metersPerSecond: selectedRobot?.speedMps,
        sizeMeters: selectedRobot?.sizeMeters,
        onDone: () => {
          const idx = activeAnimations.indexOf(anim);
          if (idx !== -1) activeAnimations.splice(idx, 1);
          // 목적지에 도착하면 이번 경로의 start/end 핀도 함께 지운다.
          markerFeatures.forEach((f) => f && interactionSource.removeFeature(f));
        },
      });
      anim.id = nextAnimId++;
      anim.sizeMeters = selectedRobot?.sizeMeters ?? DEFAULT_SIZE_M;
      activeAnimations.push(anim);
      const robotNote = selectedRobot ? ` — ${selectedRobot.name}` : '';
      setStatus(`경로 거리: ${result.distance.toFixed(2)}m (${result.algorithm})${robotNote}`);
    } catch (err) {
      console.error(err);
      setStatus(`경로 탐색 실패: ${err.message}`);
    }
  }

  function reset() {
    activeAnimations.forEach((a) => a.stop());
    activeAnimations.length = 0;
    lastPausedCount = 0;
    pairDistanceHistory.clear();
    interactionSource.clear();
    pendingRole = 'start';
    pendingStartCoord = null;
    setStatus(config.hint);
  }

  function randomPointOnGraph() {
    const links = nodeLinkSource
      .getFeatures()
      .filter((f) => f.getGeometry().getType() === 'LineString');
    if (links.length === 0) return null;
    const line = links[Math.floor(Math.random() * links.length)].getGeometry();
    const coords = line.getCoordinates();
    let total = 0;
    const lens = [0];
    for (let i = 1; i < coords.length; i++) {
      total += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
      lens.push(total);
    }
    const target = Math.random() * total;
    let i = 1;
    while (i < lens.length && lens[i] < target) i++;
    const segStart = lens[i - 1];
    const segLen = lens[i] - segStart || 1;
    const t = (target - segStart) / segLen;
    const [x1, y1] = coords[i - 1];
    const [x2, y2] = coords[i];
    return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
  }

  function randomFreePoint() {
    const extent = pcdSource.getExtent();
    const hasExtent = extent.every(Number.isFinite);
    const [minX, minY, maxX, maxY] = hasExtent
      ? extent
      : [0, 0, MAP_SIZE_M * 0.2, MAP_SIZE_M * 0.2];
    const blocks = nodeLinkSource
      .getFeatures()
      .filter((f) => f.getGeometry().getType() === 'Polygon')
      .map((f) => f.getGeometry().getCoordinates()[0]);

    for (let attempt = 0; attempt < 30; attempt++) {
      const x = minX + Math.random() * (maxX - minX);
      const y = minY + Math.random() * (maxY - minY);
      if (!blocks.some((ring) => pointInRing(x, y, ring))) {
        return [x, y];
      }
    }
    return [minX + (maxX - minX) / 2, minY + (maxY - minY) / 2];
  }

  function generateRandomPair() {
    const pick = mode === 'nodelink' ? randomPointOnGraph : randomFreePoint;
    const start = pick();
    const end = pick();
    if (!start || !end) {
      setStatus('랜덤 지점을 생성할 데이터(링크)가 없습니다.');
      return;
    }

    const startFeature = new Feature(new PointGeom(start));
    startFeature.set('role', 'start');
    startFeature.setStyle(markerStyle('start'));
    const endFeature = new Feature(new PointGeom(end));
    endFeature.set('role', 'end');
    endFeature.setStyle(markerStyle('end'));
    interactionSource.addFeatures([startFeature, endFeature]);

    requestPath(start, end, [startFeature, endFeature]);
  }

  // --- 툴바 UI ---
  panelEl.innerHTML = '';
  panelEl.classList.add('pathfinding-panel');

  const title = document.createElement('div');
  title.className = 'pathfinding-panel-title';
  title.textContent = config.title;
  panelEl.appendChild(title);

  const robotSelect = document.createElement('select');
  robotSelect.className = 'pathfinding-select';
  const customOption = document.createElement('option');
  customOption.value = '';
  customOption.textContent = '로봇: 사용자 지정 (알고리즘 직접 선택)';
  robotSelect.appendChild(customOption);
  panelEl.appendChild(robotSelect);

  const algorithmSelect = document.createElement('select');
  algorithmSelect.className = 'pathfinding-select';
  config.algorithms.forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    algorithmSelect.appendChild(opt);
  });
  panelEl.appendChild(algorithmSelect);

  robotSelect.addEventListener('change', () => {
    const robot = robotsById.get(robotSelect.value);
    if (robot) {
      algorithmSelect.value = robot.algorithm;
      algorithmSelect.disabled = true;
    } else {
      algorithmSelect.disabled = false;
    }
  });

  async function loadRobots() {
    try {
      const robots = await listRobots();
      robots
        .filter((r) => validAlgorithms.has(r.algorithm))
        .forEach((robot) => {
          robotsById.set(robot.id, robot);
          const opt = document.createElement('option');
          opt.value = robot.id;
          opt.textContent = `${robot.name} (${typeLabel(robot.type)})`;
          robotSelect.appendChild(opt);
        });
    } catch (err) {
      console.error('로봇 목록을 불러오지 못했습니다.', err);
    }
  }
  loadRobots();

  const buttonRow = document.createElement('div');
  buttonRow.className = 'pathfinding-button-row';
  const randomBtn = document.createElement('button');
  randomBtn.className = 'pathfinding-button';
  randomBtn.textContent = '랜덤 생성';
  randomBtn.addEventListener('click', generateRandomPair);
  const resetBtn = document.createElement('button');
  resetBtn.className = 'pathfinding-button';
  resetBtn.textContent = '초기화';
  resetBtn.addEventListener('click', reset);
  buttonRow.append(randomBtn, resetBtn);
  panelEl.appendChild(buttonRow);

  const statusEl = document.createElement('div');
  statusEl.className = 'pathfinding-status';
  panelEl.appendChild(statusEl);

  function setStatus(text) {
    statusEl.textContent = text;
  }
  setStatus(config.hint);

  function resize() {
    map.updateSize();
  }

  function fitToData() {
    const extent = pcdSource.getExtent();
    if (extent.every(Number.isFinite)) {
      map.getView().fit(extent, { padding: [40, 40, 40, 40], maxZoom: 7 });
    }
  }

  return { map, resize, fitToData, reset };
}

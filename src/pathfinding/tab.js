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
import { animatePathAndRobot, randomPathColor } from './robotAnimation.js';

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

  draw.on('drawend', (evt) => {
    const coord = evt.feature.getGeometry().getCoordinates();
    evt.feature.set('role', pendingRole);
    evt.feature.setStyle(markerStyle(pendingRole));

    if (pendingRole === 'start') {
      pendingStartCoord = coord;
      pendingRole = 'end';
      setStatus('도착점을 클릭하세요.');
    } else {
      const startCoord = pendingStartCoord;
      pendingRole = 'start';
      pendingStartCoord = null;
      requestPath(startCoord, coord);
    }
  });

  async function requestPath(startCoord, endCoord) {
    setStatus('경로 계산 중...');
    const featureCollection = geojsonFormat.writeFeaturesObject(nodeLinkSource.getFeatures());
    const start = { x: startCoord[0], y: startCoord[1] };
    const end = { x: endCoord[0], y: endCoord[1] };
    const algorithm = algorithmSelect.value;

    try {
      const result =
        mode === 'nodelink'
          ? await findNodeLinkPath({ featureCollection, start, end, algorithm })
          : await findObstaclePath({ featureCollection, start, end, algorithm, cellSize: 0.2 });

      const anim = animatePathAndRobot(map, interactionSource, result.path, {
        color: randomPathColor(),
        onDone: () => {
          const idx = activeAnimations.indexOf(anim);
          if (idx !== -1) activeAnimations.splice(idx, 1);
        },
      });
      activeAnimations.push(anim);
      setStatus(`경로 거리: ${result.distance.toFixed(2)}m (${result.algorithm})`);
    } catch (err) {
      console.error(err);
      setStatus(`경로 탐색 실패: ${err.message}`);
    }
  }

  function reset() {
    activeAnimations.forEach((a) => a.stop());
    activeAnimations.length = 0;
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

    requestPath(start, end);
  }

  // --- 툴바 UI ---
  panelEl.innerHTML = '';
  panelEl.classList.add('pathfinding-panel');

  const title = document.createElement('div');
  title.className = 'pathfinding-panel-title';
  title.textContent = config.title;
  panelEl.appendChild(title);

  const algorithmSelect = document.createElement('select');
  algorithmSelect.className = 'pathfinding-select';
  config.algorithms.forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    algorithmSelect.appendChild(opt);
  });
  panelEl.appendChild(algorithmSelect);

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

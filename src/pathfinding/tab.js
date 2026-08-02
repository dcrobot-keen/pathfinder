import OlMap from 'ol/Map.js';
import View from 'ol/View.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import Feature from 'ol/Feature.js';
import PointGeom from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
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
  const conflictSource = new VectorSource();
  const conflictLayer = new VectorLayer({ source: conflictSource, zIndex: 15 });

  const map = new OlMap({
    target: mapEl,
    layers: [buildGridLayer(MAP_SIZE_M, 10), floorLayer, graphLayer, interactionLayer, conflictLayer],
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
  // 판정은 "현재 위치끼리의 거리"가 아니라 "남은 경로(remaining path)끼리의 최근접
  // 거리"로 한다. animatePathAndRobot이 매 프레임 이미 지나온 구간을 잘라낸
  // getRemainingPath()를 제공하므로, 두 로봇의 남은 경로 polyline 사이 최단 거리를
  // 구해 그 값을 기준으로 삼는다. 이렇게 하면:
  //   - 한 로봇이 교차 지점을 이미 지나쳤다면 그 지점은 더 이상 그 로봇의 남은
  //     경로에 포함되지 않으므로, 상대 로봇이 그 지점에 다가가도 더 이상 막지 않는다
  //     (현재 좌표만 비교하면 "이미 지나간" 로봇도 계속 막고 있는 경우가 생겼다).
  //   - 정지 반경(pauseRadius) 안으로 들어오는 순간 막고, 벗어나는 순간 지연 없이
  //     바로 풀린다(별도의 hysteresis 대기 없음) — 위험 판단 기준이 사라지면 즉시
  //     resume.
  //
  // 매 틱마다 "현재 활성 상태인" 모든 상위 우선순위 로봇을 기준으로 다시 판정한다 —
  // 그래야 막고 있던 로봇이 먼저 도착해서 activeAnimations에서 빠졌을 때도(경로 종료)
  // 그 즉시 대기 중이던 로봇이 자동으로 풀린다. 특정 쌍만 한 번 판정하고 끝내면,
  // 상대가 사라진 뒤에도 그 판정이 갱신되지 않아 영원히 멈춰있는(사실상 데드락처럼
  // 보이는) 상태가 됐었다.
  //
  // conflict(pauseRadius 이내로 좁혀진 쌍)가 발생하는 동안에는 남은 경로끼리 가장
  // 가까워지는 두 지점 사이에 실선을 긋고 그 위에 실측 거리를 표시해, pause 판정의
  // 근거를 화면에서 바로 확인할 수 있게 한다.
  let nextAnimId = 1;
  const conflictLineFeatures = new Map(); // "id1:id2" -> LineString Feature
  let lastPausedCount = 0;

  const CHECK_INTERVAL_MS = 200;
  const PAUSE_SIZE_MULTIPLIER = 2; // pauseRadius = 이 값 * (higherSize + lowerSize)
  const MAX_PROXIMITY_SAMPLES = 150; // 긴 경로에서 최근접 거리 계산 비용을 제한
  // 남은 경로 "전체"를 그대로 비교하면, 로봇이 아직 한참 멀리 있어도 그 경로가
  // 나중에 지나갈 어느 먼 지점이 우연히 다른 로봇 경로와 가깝다는 이유만으로
  // 미리 멈춰버린다(로봇 3대 이상 있는 환경에서 실제로 확인된 문제: A가 아직
  // 경로 초반인데 A의 경로 후반부와 우연히 가까운 C가 A가 그 지점에 도달하기도
  // 전부터 멈춰서, 실질적으로 A의 앞선 conflict—B와의 건—가 끝날 때까지 함께
  // 묶여 대기하는 것처럼 보였다). 그래서 비교 범위를 "가까운 미래"로 제한한다:
  // 각 로봇의 남은 경로를, "현재 속도로 LOOKAHEAD_SECONDS 안에 실제로 갈 수 있는
  // 거리"만큼만 잘라서 그 구간끼리만 최근접 거리를 잰다. 거리를 속도에 비례시키는
  // 이유: 느린 로봇(Atlas 0.2m/s)은 몇 초 안에 얼마 못 가므로 먼 미래 지점을 미리
  // 볼 필요가 없고, 빠른 로봇(SPOT 1.2m/s)은 같은 시간에 더 멀리 가므로 그만큼
  // 더 미리 봐야 한다. 이렇게 하면 각 conflict 쌍이 실제로 서로 가까워질 때가
  // 되어서야(정확히는 각자 그 지점에 다가갈 때) 독립적으로 판정되고, 다른 쌍의
  // 사정과 뒤섞이지 않는다.
  const LOOKAHEAD_SECONDS = 4;
  const MIN_LOOKAHEAD_M = 1; // 거의 정지한 로봇도 최소한의 여유는 두고 판정
  const MAX_LOOKAHEAD_M = 15; // 매우 빠른 로봇이 경로 전체를 다 들여다보지 않도록 상한

  function lookaheadDistance(metersPerSecond) {
    const speed = metersPerSecond ?? 1.0;
    return Math.min(MAX_LOOKAHEAD_M, Math.max(MIN_LOOKAHEAD_M, speed * LOOKAHEAD_SECONDS));
  }

  // 경로 점이 너무 많으면(장애물 회피 모드는 cellSize 단위로 촘촘함) 균등 간격으로
  // 솎아내 O(n*m) 최근접 거리 계산 비용을 억제한다.
  function downsample(coords) {
    if (coords.length <= MAX_PROXIMITY_SAMPLES) return coords;
    const stride = Math.ceil(coords.length / MAX_PROXIMITY_SAMPLES);
    const out = [];
    for (let i = 0; i < coords.length; i += stride) out.push(coords[i]);
    const last = coords[coords.length - 1];
    if (out[out.length - 1] !== last) out.push(last);
    return out;
  }

  // 경로를 현재 위치(coords[0])부터 maxDist(m)까지만 잘라낸다 — 그보다 먼
  // 구간은 "아직 갈 일 없는 미래"로 보고 충돌 판정에서 제외한다.
  function truncatePath(coords, maxDist) {
    if (coords.length === 0) return coords;
    const out = [coords[0]];
    let acc = 0;
    for (let i = 1; i < coords.length; i++) {
      const [x1, y1] = coords[i - 1];
      const [x2, y2] = coords[i];
      const segLen = Math.hypot(x2 - x1, y2 - y1);
      if (acc + segLen >= maxDist) {
        const remain = maxDist - acc;
        const t = segLen === 0 ? 0 : remain / segLen;
        out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
        return out;
      }
      out.push([x2, y2]);
      acc += segLen;
    }
    return out; // 전체 길이가 이미 maxDist보다 짧음
  }

  function pointToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const x = x1 + t * dx;
    const y = y1 + t * dy;
    return { distance: Math.hypot(px - x, py - y), x, y };
  }

  // 세 점 o,a,b의 방향(부호 있는 넓이의 2배): >0 반시계, <0 시계, 0 일직선.
  function orientation(o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  }
  function onSegment(a, b, p) {
    return (
      Math.min(a[0], b[0]) - 1e-9 <= p[0] &&
      p[0] <= Math.max(a[0], b[0]) + 1e-9 &&
      Math.min(a[1], b[1]) - 1e-9 <= p[1] &&
      p[1] <= Math.max(a[1], b[1]) + 1e-9
    );
  }

  // 두 선분이 실제로 만나면 그 교차점을, 아니면 null을 반환한다.
  function segmentIntersectionPoint(p1, p2, p3, p4) {
    const d1 = orientation(p3, p4, p1);
    const d2 = orientation(p3, p4, p2);
    const d3 = orientation(p1, p2, p3);
    const d4 = orientation(p1, p2, p4);
    const proper = ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
    const touching =
      (d1 === 0 && onSegment(p3, p4, p1)) ||
      (d2 === 0 && onSegment(p3, p4, p2)) ||
      (d3 === 0 && onSegment(p1, p2, p3)) ||
      (d4 === 0 && onSegment(p1, p2, p4));
    if (!proper && !touching) return null;

    const denom = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (Math.abs(denom) < 1e-9) {
      // 평행하게 맞닿은(collinear touching) 경우 — 닿아있는 끝점 하나를 그대로 쓴다.
      if (d1 === 0) return p1;
      if (d2 === 0) return p2;
      if (d3 === 0) return p3;
      return p4;
    }
    const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / denom;
    return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
  }

  // 두 선분 사이의 최단 거리와, 그 최단 거리를 만든 두 지점을 구한다. 선분이
  // 서로 교차하면 거리는 0. vertex(끝점)만 표본으로 삼는 point-to-segment와
  // 달리, 두 선분이 서로의 "중간"에서 만나는 경우(교점이 어느 쪽 끝점도 아닌
  // 경우)도 놓치지 않는다 — 노드/링크 모드처럼 정점이 듬성듬성한 직선 경로도
  // 정확히 판정하기 위함이다.
  function segmentDistance(p1, p2, p3, p4) {
    const ip = segmentIntersectionPoint(p1, p2, p3, p4);
    if (ip) return { distance: 0, pointA: ip, pointB: ip };

    let best = null;
    const consider = (from, seg1, seg2) => {
      const r = pointToSegment(from[0], from[1], seg1[0], seg1[1], seg2[0], seg2[1]);
      if (!best || r.distance < best.distance) {
        best = { distance: r.distance, pointA: null, pointB: null, _from: from, _onto: [r.x, r.y] };
      }
    };
    consider(p1, p3, p4);
    consider(p2, p3, p4);
    consider(p3, p1, p2);
    consider(p4, p1, p2);

    // best._from이 A쪽 점이면(p1/p2) pointA=from,pointB=onto, B쪽 점이면(p3/p4) 반대.
    const fromIsA = best._from === p1 || best._from === p2;
    return {
      distance: best.distance,
      pointA: fromIsA ? best._from : best._onto,
      pointB: fromIsA ? best._onto : best._from,
    };
  }

  // 두 남은-경로 polyline 사이의 최단 거리와, 그 최단 거리를 만든 두 지점을 구한다.
  function closestApproach(coordsA, coordsB) {
    const a = downsample(coordsA);
    const b = downsample(coordsB);
    if (a.length < 2 || b.length < 2) {
      const p = a[0];
      const q = b[0];
      if (a.length < 2 && b.length < 2) {
        return { distance: Math.hypot(p[0] - q[0], p[1] - q[1]), pointA: p, pointB: q };
      }
      const single = a.length < 2 ? p : q;
      const line = a.length < 2 ? b : a;
      let best = { distance: Infinity, pointA: single, pointB: single };
      for (let i = 1; i < line.length; i++) {
        const r = pointToSegment(single[0], single[1], line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
        if (r.distance < best.distance) {
          best =
            a.length < 2
              ? { distance: r.distance, pointA: single, pointB: [r.x, r.y] }
              : { distance: r.distance, pointA: [r.x, r.y], pointB: single };
        }
      }
      return best;
    }

    let best = { distance: Infinity, pointA: a[0], pointB: b[0] };
    for (let i = 1; i < a.length; i++) {
      for (let j = 1; j < b.length; j++) {
        const r = segmentDistance(a[i - 1], a[i], b[j - 1], b[j]);
        if (r.distance < best.distance) best = r;
      }
    }
    return best;
  }

  // 두 경로가 "실제로 겹치는 쌍"인지 판단한다. 이론적으로는 정확한 선분 교차
  // 판정을 쓰고 싶지만, 실제 경로는 그리드 A*(cellSize 단위 계단식) / Hybrid A*
  // 조향 곡선으로 나오기 때문에 두 로봇의 경로가 눈으로는 분명히 교차해도
  // 두 polyline이 수학적으로 정확히 한 점에서 만나는 경우는 거의 없다(살짝
  // 스쳐 지나가듯 근접만 함). 그래서 "정확한 교차" 대신 "아주 가깝게(그리드
  // 오차 수준 이내로) 스쳐가는 지점이 있는가"로 판단한다 — 나란히 일정 간격을
  // 유지하며 가는 평행 경로는 이 좁은 허용치 안으로 절대 들어오지 않으므로
  // 여전히 걸러진다.
  const PATH_OVERLAP_TOLERANCE_M = 0.5;

  function pathsOverlap(coordsA, coordsB) {
    return closestApproach(coordsA, coordsB).distance < PATH_OVERLAP_TOLERANCE_M;
  }

  function conflictLineStyle(distance) {
    return new Style({
      stroke: new Stroke({ color: '#e74c3c', width: 2, lineDash: [6, 4] }),
      text: new Text({
        text: `${distance.toFixed(2)}m`,
        font: 'bold 12px sans-serif',
        fill: new Fill({ color: '#fff' }),
        stroke: new Stroke({ color: '#c0392b', width: 3 }),
        overflow: true,
      }),
    });
  }

  function showConflictLine(key, posA, posB, distance) {
    let feature = conflictLineFeatures.get(key);
    if (!feature) {
      feature = new Feature(new LineString([posA, posB]));
      conflictLineFeatures.set(key, feature);
      conflictSource.addFeature(feature);
    } else {
      feature.getGeometry().setCoordinates([posA, posB]);
    }
    feature.setStyle(conflictLineStyle(distance));
  }

  function hideConflictLine(key) {
    const feature = conflictLineFeatures.get(key);
    if (feature) {
      conflictSource.removeFeature(feature);
      conflictLineFeatures.delete(key);
    }
  }

  function checkConflicts() {
    let debugMsg = '';
    const conflictingKeys = new Set();

    for (let j = 0; j < activeAnimations.length; j++) {
      const lower = activeAnimations[j];
      const lowerSize = lower.sizeMeters ?? DEFAULT_SIZE_M;
      let blocked = false;

      for (let i = 0; i < j; i++) {
        // i < j: 먼저 출발한(=배열에 먼저 들어온) 쪽이 우선순위가 높다.
        const higher = activeAnimations[i];
        const higherSize = higher.sizeMeters ?? DEFAULT_SIZE_M;

        const higherLookahead = truncatePath(
          higher.getRemainingPath(),
          lookaheadDistance(higher.metersPerSecond)
        );
        const lowerLookahead = truncatePath(
          lower.getRemainingPath(),
          lookaheadDistance(lower.metersPerSecond)
        );

        const pauseRadius = PAUSE_SIZE_MULTIPLIER * (higherSize + lowerSize);
        const key = `${higher.id}:${lower.id}`;

        // 경로가 실제로 겹치지 않으면(평행하게 나란히 가는 경우 등) 아무리
        // 가까워도 막지 않는다 — 반경 거리 비교는 경로가 겹치는 쌍에만 적용.
        // "겹치는지"는 남은 경로 전체(잘라내기 전)를 기준으로 판단해 언젠가
        // 스쳐가는 지점이 있는지만 확인하고, 실제 pause 판정용 거리(d)는
        // 근시일 내 구간(lookahead)만으로 계산해 타이밍을 맞춘다.
        let d = Infinity;
        let pointA;
        let pointB;
        let pairBlocked = false;
        if (pathsOverlap(higher.getRemainingPath(), lower.getRemainingPath())) {
          ({ distance: d, pointA, pointB } = closestApproach(higherLookahead, lowerLookahead));
          pairBlocked = d < pauseRadius;
        }
        if (pairBlocked) blocked = true;

        if (pairBlocked) {
          conflictingKeys.add(key);
          showConflictLine(key, pointA, pointB, d);
        } else {
          hideConflictLine(key);
        }

        // 진단용: 실제로 이 틱에서 계산된 값을 콘솔에 남긴다. 예상과 다른 거리에서
        // pause가 걸리면 여기 로그로 실측치(d/pauseRadius)를 바로 확인할 수 있다.
        if (pairBlocked && !lower.isPaused()) {
          console.log(
            `[deconflict] pause 로봇#${lower.id} <- #${higher.id}: 남은경로 최근접거리=${d.toFixed(2)}m, pauseRadius=${pauseRadius.toFixed(2)}m`
          );
          debugMsg = ` (실측 ${d.toFixed(2)}m / 기준 ${pauseRadius.toFixed(2)}m)`;
        }
      }

      // 위험 기준(pauseRadius 이내)이 사라지는 즉시 pause/resume을 갱신한다 —
      // 별도의 대기(hysteresis) 없이 이번 틱 판정을 그대로 반영.
      if (blocked && !lower.isPaused()) lower.pause();
      if (!blocked && lower.isPaused()) {
        console.log(`[deconflict] resume 로봇#${lower.id}`);
        lower.resume();
      }
    }

    // 이번 틱에 더 이상 활성 쌍이 아니거나(둘 중 하나 종료) 더 이상 conflict가 아닌
    // 이전 충돌선은 정리한다.
    for (const key of conflictLineFeatures.keys()) {
      if (!conflictingKeys.has(key)) hideConflictLine(key);
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
  setInterval(checkConflicts, CHECK_INTERVAL_MS);

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
    conflictLineFeatures.clear();
    conflictSource.clear();
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

import Feature from 'ol/Feature.js';
import PointGeom from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import Style from 'ol/style/Style.js';
import CircleStyle from 'ol/style/Circle.js';
import Icon from 'ol/style/Icon.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';

// sizeMeters(등록된 로봇의 실제 폭/지름)가 REFERENCE_SIZE_M일 때 기본 아이콘 크기가 되도록
// 비례시킨다. 화면 줌에 따라 실시간으로 정확한 미터 축척을 유지하진 않지만(그러려면 매
// 프레임 재계산이 필요), 로봇 간 크기 차이를 마커에 반영하기엔 충분하다.
// tab.js의 deconfliction 반경 계산도 이 기본값을 그대로 재사용한다.
export const REFERENCE_SIZE_M = 0.5;
const BASE_ICON_SCALE = 0.4;
const BASE_CIRCLE_RADIUS = 7;

function robotMarkerStyle(color, iconSrc, { paused = false, sizeMeters = REFERENCE_SIZE_M } = {}) {
  const sizeRatio = sizeMeters / REFERENCE_SIZE_M;

  if (iconSrc) {
    // ol/style/Icon의 size 옵션은 "스프라이트 시트에서 잘라올 영역" 지정용이라
    // 단일 아이콘에는 쓰면 안 된다 — shared/robotIcons.mjs가 SVG에 width/height=64를
    // 명시해두므로 자연 크기를 그대로 읽어 scale만으로 최종 크기를 정한다.
    const scale = Math.min(1.2, Math.max(0.15, BASE_ICON_SCALE * sizeRatio));
    return new Style({
      image: new Icon({ src: iconSrc, scale, opacity: paused ? 0.35 : 1 }),
    });
  }
  const radius = Math.min(18, Math.max(4, BASE_CIRCLE_RADIUS * sizeRatio));
  return new Style({
    image: new CircleStyle({
      radius,
      fill: new Fill({ color: paused ? 'rgba(150,150,150,0.6)' : color }),
      stroke: new Stroke({ color: '#fff', width: 2 }),
    }),
  });
}

export function randomPathColor() {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 75%, 45%)`;
}

function cumulativeLengths(coords) {
  const lens = [0];
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = coords[i - 1];
    const [x2, y2] = coords[i];
    lens.push(lens[i - 1] + Math.hypot(x2 - x1, y2 - y1));
  }
  return lens;
}

function pointAtDistance(coords, lens, d) {
  const total = lens[lens.length - 1];
  if (d <= 0) return { point: coords[0], segmentIndex: 0 };
  if (d >= total) return { point: coords[coords.length - 1], segmentIndex: coords.length - 1 };
  let i = 1;
  while (lens[i] < d) i++;
  const segStart = lens[i - 1];
  const segLen = lens[i] - segStart;
  const t = segLen === 0 ? 0 : (d - segStart) / segLen;
  const [x1, y1] = coords[i - 1];
  const [x2, y2] = coords[i];
  return {
    point: [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t],
    segmentIndex: i - 1,
  };
}

/**
 * 경로를 랜덤 색상 선으로 그리고, 로봇 마커를 실제 metersPerSecond 속도로
 * start->end까지 이동시킨다(지도 좌표계가 m 단위이므로 화면 배율과 무관하게 실속도).
 * 지나간 구간은 선에서 지워진다(trail 삭제).
 * @param {import('ol/Map.js').default} map
 * @param {import('ol/source/Vector.js').default} source
 * @param {Array<[number, number]>} coords
 * @param {{ metersPerSecond?: number, sizeMeters?: number, color?: string, iconSrc?: string, onDone?: () => void }} [options]
 *   iconSrc가 주어지면 로봇 마커를 원형 점 대신 해당 아이콘(등록된 로봇의 아이콘)으로 그린다.
 *   sizeMeters는 마커 크기에 반영된다(로봇 등록 값 기준, 기본 0.5m).
 * @returns {{
 *   stop: () => void,
 *   pause: () => void,
 *   resume: () => void,
 *   isPaused: () => boolean,
 *   getPosition: () => [number, number],
 * }}
 */
export function animatePathAndRobot(map, source, coords, options = {}) {
  const {
    metersPerSecond = 1.0,
    sizeMeters = REFERENCE_SIZE_M,
    color = randomPathColor(),
    iconSrc,
    onDone,
  } = options;

  if (coords.length < 2) {
    return {
      stop() {},
      pause() {},
      resume() {},
      isPaused: () => false,
      getPosition: () => coords[0],
    };
  }

  const pathFeature = new Feature(new LineString(coords));
  pathFeature.setStyle(new Style({ stroke: new Stroke({ color, width: 3 }) }));

  const robotFeature = new Feature(new PointGeom(coords[0]));
  robotFeature.setStyle(robotMarkerStyle(color, iconSrc, { sizeMeters }));

  source.addFeatures([pathFeature, robotFeature]);

  const lens = cumulativeLengths(coords);
  const total = lens[lens.length - 1];
  let traveled = 0;
  let lastTime = null;
  let rafId = null;
  let stopped = false;
  let paused = false;

  function finish() {
    stopped = true;
    source.removeFeature(pathFeature);
    source.removeFeature(robotFeature);
    if (onDone) onDone();
  }

  function frame(time) {
    if (stopped || paused) return;
    if (lastTime === null) lastTime = time;
    const dt = (time - lastTime) / 1000;
    lastTime = time;

    traveled += metersPerSecond * dt;

    if (total === 0 || traveled >= total) {
      finish();
      return;
    }

    const { point, segmentIndex } = pointAtDistance(coords, lens, traveled);
    robotFeature.getGeometry().setCoordinates(point);
    pathFeature.getGeometry().setCoordinates([point, ...coords.slice(segmentIndex + 1)]);

    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    stop() {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      source.removeFeature(pathFeature);
      source.removeFeature(robotFeature);
    },
    pause() {
      if (stopped || paused) return;
      paused = true;
      robotFeature.setStyle(robotMarkerStyle(color, iconSrc, { paused: true, sizeMeters }));
    },
    resume() {
      if (stopped || !paused) return;
      paused = false;
      robotFeature.setStyle(robotMarkerStyle(color, iconSrc, { paused: false, sizeMeters }));
      lastTime = null; // 정지해 있던 시간이 dt로 잡혀 순간이동하지 않도록 리셋
      rafId = requestAnimationFrame(frame);
    },
    isPaused: () => paused,
    getPosition: () => robotFeature.getGeometry().getCoordinates(),
  };
}

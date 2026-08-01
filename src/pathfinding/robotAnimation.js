import Feature from 'ol/Feature.js';
import PointGeom from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import Style from 'ol/style/Style.js';
import CircleStyle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';

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
 * 경로를 랜덤 색상 선으로 그리고, 로봇 마커를 화면 기준 pxPerSecond 속도로
 * start->end까지 이동시킨다. 지나간 구간은 선에서 지워진다(trail 삭제).
 * @param {import('ol/Map.js').default} map
 * @param {import('ol/source/Vector.js').default} source
 * @param {Array<[number, number]>} coords
 * @param {{ pxPerSecond?: number, color?: string, onDone?: () => void }} [options]
 * @returns {{ stop: () => void }}
 */
export function animatePathAndRobot(map, source, coords, options = {}) {
  const { pxPerSecond = 2, color = randomPathColor(), onDone } = options;

  if (coords.length < 2) {
    return { stop() {} };
  }

  const pathFeature = new Feature(new LineString(coords));
  pathFeature.setStyle(new Style({ stroke: new Stroke({ color, width: 3 }) }));

  const robotFeature = new Feature(new PointGeom(coords[0]));
  robotFeature.setStyle(
    new Style({
      image: new CircleStyle({
        radius: 7,
        fill: new Fill({ color }),
        stroke: new Stroke({ color: '#fff', width: 2 }),
      }),
    })
  );

  source.addFeatures([pathFeature, robotFeature]);

  const lens = cumulativeLengths(coords);
  const total = lens[lens.length - 1];
  let traveled = 0;
  let lastTime = null;
  let rafId = null;
  let stopped = false;

  function finish() {
    robotFeature.getGeometry().setCoordinates(coords[coords.length - 1]);
    pathFeature.getGeometry().setCoordinates([coords[coords.length - 1]]);
    if (onDone) onDone();
  }

  function frame(time) {
    if (stopped) return;
    if (lastTime === null) lastTime = time;
    const dt = (time - lastTime) / 1000;
    lastTime = time;

    const resolution = map.getView().getResolution() || 1;
    traveled += pxPerSecond * resolution * dt;

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
  };
}

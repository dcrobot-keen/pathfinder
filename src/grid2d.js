import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Style from 'ol/style/Style.js';
import Stroke from 'ol/style/Stroke.js';
import Text from 'ol/style/Text.js';
import Fill from 'ol/style/Fill.js';

/** size x size (m) 영역에 step(m) 간격의 기준선 레이어를 만든다. */
export function buildGridLayer(size, step) {
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

  return new VectorLayer({
    source,
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
}

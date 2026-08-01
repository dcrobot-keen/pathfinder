import Style from 'ol/style/Style.js';
import Circle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';

const STYLE_BY_TYPE = {
  Point: new Style({
    image: new Circle({
      radius: 6,
      fill: new Fill({ color: '#ff9800' }),
      stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
    }),
  }),
  LineString: new Style({
    stroke: new Stroke({ color: '#2979ff', width: 3 }),
  }),
  Polygon: new Style({
    fill: new Fill({ color: 'rgba(76,175,80,0.25)' }),
    stroke: new Stroke({ color: '#4caf50', width: 2 }),
  }),
};

/** 노드(point)/링크(line)/블록(polygon) 공통 표시 스타일. */
export function nodeLinkStyle(feature) {
  return STYLE_BY_TYPE[feature.getGeometry().getType()];
}

export const KIND_BY_TYPE = { Point: 'node', LineString: 'link', Polygon: 'block' };

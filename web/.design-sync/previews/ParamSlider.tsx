import { ParamSlider } from 's2m-ui';

export function Resolution() {
  return <ParamSlider label="격자 해상도" valueLabel="5.0 cm" percent={45} />;
}

export function ObstacleHeight() {
  return <ParamSlider label="장애물 최소 높이" valueLabel="0.08 m" percent={20} />;
}

export function Full() {
  return <ParamSlider label="천장 마진" valueLabel="0.30 m" percent={100} />;
}

import { LogConsole } from 's2m-ui';

export function Running() {
  return (
    <LogConsole
      lines={[
        { text: '[1/7] importing scan...', level: 'dim' },
        { text: '  1,270,384 vertices, texture=yes' },
        { text: '[2/7] removing ceiling/floor/outliers...' },
        { text: '  955,412 points, ceiling_z=2.68' },
        { text: '[3/7] rasterizing 2D map...' },
        { text: '  free=118,204 occupied=41,882 unknown=79,514', level: 'ok' },
        { text: '[4/7] registering robot map...' },
        { text: 'obstacle_min_height=0.08 vs 0.20 비교 결과 거의 동일 — 기본값 사용', level: 'warn' },
        { text: '  rotation=42.31deg rmse=0.0312' },
      ]}
    />
  );
}

export function WithError() {
  return (
    <LogConsole
      lines={[
        { text: '[1/7] importing scan...', level: 'dim' },
        { text: '  1,270,384 vertices, texture=yes' },
        { text: '[2/7] removing ceiling/floor/outliers...' },
        { text: '오류: robot_map.yaml을 읽을 수 없습니다 (resolution 필드 없음)', level: 'error' },
      ]}
    />
  );
}

export function Empty() {
  return <LogConsole lines={[]} />;
}

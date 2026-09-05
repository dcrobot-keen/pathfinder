import { StatGrid } from 's2m-ui';

export function ReportStats() {
  return (
    <StatGrid
      stats={[
        { value: '955,412', label: '포인트 (전처리 후)' },
        { value: '194.7㎡', label: '실내 면적' },
        { value: '4', label: '벽 평면' },
        { value: '44', label: '가구 폴리곤' },
      ]}
    />
  );
}

export function Pending() {
  return (
    <StatGrid
      stats={[
        { value: '-', label: '포인트 (전처리 후)' },
        { value: '-', label: '실내 면적' },
        { value: '-', label: '벽 평면' },
        { value: '-', label: '가구 폴리곤' },
      ]}
    />
  );
}

import { ToggleLegend } from 's2m-ui';

export function Default() {
  return (
    <ToggleLegend
      items={[
        { color: 'var(--wall)', label: '벽 (7)' },
        { color: 'var(--furniture)', label: '가구 (44)' },
        { color: 'var(--traj)', label: '로봇 궤적' },
        { color: 'var(--danger)', label: '정합 오버레이', round: true, on: true },
      ]}
    />
  );
}

export function SomeOff() {
  return (
    <ToggleLegend
      items={[
        { color: 'var(--wall)', label: '벽 (4)' },
        { color: 'var(--furniture)', label: '가구 (12)', on: false },
        { color: 'var(--danger)', label: '정합 오버레이', round: true, on: false },
      ]}
    />
  );
}

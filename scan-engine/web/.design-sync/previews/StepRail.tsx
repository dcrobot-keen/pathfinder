import { StepRail } from 's2m-ui';

export function InProgress() {
  return (
    <StepRail
      steps={[
        { title: '1. 가져오기', subtitle: 'usdz_to_ply · 1.27M pts', status: 'done' },
        { title: '2. 전처리', subtitle: '천장/바닥 제거 · 955K pts', status: 'done' },
        { title: '3. 래스터화', subtitle: '2D occupancy grid 생성 중', status: 'active' },
        { title: '4. 정합', subtitle: 'robot_map.pgm 대상', status: 'pending' },
        { title: '5. 분류', subtitle: '바닥·벽·가구', status: 'pending' },
        { title: '6. 벡터화', subtitle: 'GeoJSON 내보내기', status: 'pending' },
      ]}
    />
  );
}

export function WithSkipAndError() {
  return (
    <StepRail
      steps={[
        { title: '1. 가져오기', subtitle: 'usdz_to_ply · 546K pts', status: 'done' },
        { title: '2. 전처리', subtitle: '천장/바닥 제거 · 440K pts', status: 'done' },
        { title: '3. 래스터화', subtitle: '2D occupancy grid', status: 'done' },
        { title: '4. 정합', subtitle: '로봇 지도 없음 · 건너뜀', status: 'skip' },
        { title: '5. 분류', subtitle: 'RANSAC 벽 평면 검출 실패', status: 'error' },
        { title: '6. 벡터화', subtitle: 'GeoJSON 내보내기', status: 'pending' },
      ]}
    />
  );
}

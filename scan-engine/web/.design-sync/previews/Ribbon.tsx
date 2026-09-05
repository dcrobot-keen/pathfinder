import { Ribbon } from 's2m-ui';

export function ProcessActive() {
  return (
    <Ribbon
      tabs={[
        { label: '처리 (Process)', active: true },
        { label: '편집 (분류·벡터화)' },
        { label: '디스플레이' },
      ]}
    />
  );
}

export function DisplayActive() {
  return (
    <Ribbon
      tabs={[
        { label: '처리 (Process)' },
        { label: '편집 (분류·벡터화)' },
        { label: '디스플레이', active: true },
      ]}
    />
  );
}

import { SidePanelSection, StatGrid } from 's2m-ui';

export function Summary() {
  return (
    <SidePanelSection title="요약">
      <StatGrid
        stats={[
          { value: '955,412', label: '포인트' },
          { value: '194.7㎡', label: '실내 면적' },
        ]}
      />
    </SidePanelSection>
  );
}

export function PlainText() {
  return (
    <SidePanelSection title="상태">
      <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>phase: running</div>
    </SidePanelSection>
  );
}

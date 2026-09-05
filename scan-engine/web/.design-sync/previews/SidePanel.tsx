import { LinksList, RegistrationSummary, SidePanel, SidePanelSection, StatGrid } from 's2m-ui';

export function ReportSidebar() {
  return (
    <SidePanel>
      <SidePanelSection title="요약">
        <StatGrid
          stats={[
            { value: '955,412', label: '포인트 (전처리 후)' },
            { value: '194.7㎡', label: '실내 면적' },
            { value: '4', label: '벽 평면' },
            { value: '44', label: '가구 폴리곤' },
          ]}
        />
      </SidePanelSection>
      <RegistrationSummary
        rows={[
          ['회전', '42.3°'],
          ['이동', '1.84, 3.02 m'],
          ['RMSE', '3.1 cm'],
        ]}
      />
      <SidePanelSection title="산출물">
        <LinksList
          links={[
            { label: 'base_map.ply', href: '#' },
            { label: 'output.geojson', href: '#' },
            { label: 'overlay.glb (3D)', href: '#' },
          ]}
        />
      </SidePanelSection>
    </SidePanel>
  );
}

export function PipelineSidebar() {
  return (
    <SidePanel>
      <SidePanelSection title="상태">
        <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>phase: running</div>
      </SidePanelSection>
    </SidePanel>
  );
}

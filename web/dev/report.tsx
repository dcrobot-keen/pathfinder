import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ScreenHeader,
  LayerThumbList,
  ToggleLegend,
  Timeline,
  SidePanel,
  SidePanelSection,
  StatGrid,
  RegistrationSummary,
  LinksList,
  Button,
} from '../src/index';

function Demo() {
  return (
    <div style={{ background: 'var(--bg)', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <ScreenHeader
        crumb={['프로젝트', 'officescan']}
        pillText="✓ 처리 완료"
        pillTone="success"
        actions={
          <>
            <Button>GeoJSON 내보내기</Button>
            <Button variant="primary">3D로 보기 (gltf-inspector)</Button>
          </>
        }
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <LayerThumbList
          layers={[
            { label: 'Occupancy', sublabel: '흑백 그리드' },
            { label: '컬러 top-down', sublabel: '실제 색상' },
            { label: '벡터 (GeoJSON)', sublabel: '벽·가구 폴리곤', active: true },
            { label: '3D 오버레이', sublabel: 'usdz + ply' },
          ]}
        />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <ToggleLegend
            items={[
              { color: 'var(--wall)', label: '벽 (7)' },
              { color: 'var(--furniture)', label: '가구 (44)' },
              { color: 'var(--traj)', label: '로봇 궤적' },
              { color: 'var(--danger)', label: '정합 오버레이', round: true },
            ]}
          />
          <div
            style={{
              flex: 1,
              background: '#0f1621',
              backgroundImage:
                'repeating-linear-gradient(0deg, #151c26 0 1px, transparent 1px 24px), repeating-linear-gradient(90deg, #151c26 0 1px, transparent 1px 24px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              (지도 캔버스 — 벡터 폴리곤 렌더링 위치)
            </div>
          </div>
          <Timeline percent={38} poseText="t=14.2s · x=1.84 y=3.02 θ=42°" />
        </div>
        <SidePanel>
          <SidePanelSection title="요약">
            <StatGrid
              stats={[
                { value: '955K', label: '포인트 (전처리 후)' },
                { value: '194.7㎡', label: '실내 면적' },
                { value: '7', label: '벽 세그먼트' },
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
                { label: 'base_map.ply' },
                { label: 'map.pgm + map.yaml' },
                { label: 'classified.ply' },
                { label: 'output.geojson' },
                { label: 'overlay.glb (3D)' },
              ]}
            />
          </SidePanelSection>
        </SidePanel>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);

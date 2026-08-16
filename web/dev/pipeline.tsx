import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ScreenHeader,
  Ribbon,
  RibbonTools,
  StepRail,
  LogConsole,
  ProgressPill,
  ParamSlider,
  SidePanel,
  SidePanelSection,
  Button,
} from '../src/index';

function Demo() {
  return (
    <div style={{ background: 'var(--bg)', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <ScreenHeader
        crumb={['프로젝트', 'officescan']}
        pillText="처리중 3 / 6"
        pillTone="accent"
        actions={
          <>
            <Button variant="ghost">⏸ 일시정지</Button>
            <Button variant="danger">취소</Button>
          </>
        }
      />
      <Ribbon
        tabs={[{ label: '처리 (Process)', active: true }, { label: '편집 (분류·벡터화)' }, { label: '디스플레이' }]}
      />
      <RibbonTools
        tools={[
          { icon: '▦', label: '래스터화' },
          { icon: '⌗', label: '정합' },
          { icon: '◧', label: '분류', disabled: true },
          { icon: '▱', label: '벡터화', disabled: true },
          { icon: '▤', label: '단면(예정)' },
          { icon: '✕', label: '이동물체 제거', disabled: true },
        ]}
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid var(--border)' }}>
            <h1 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
              3. 래스터화 — 2D occupancy grid
            </h1>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
              rasterize_base_map.py · resolution 5cm · obstacle_min_height 0.08m
            </p>
          </div>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              background: 'radial-gradient(circle at 50% 40%, #0f1621, #0a0d13)',
            }}
          >
            <div style={{ position: 'absolute', bottom: 24 }}>
              <ProgressPill percent={62} eta="약 8초 남음" />
            </div>
          </div>
          <LogConsole
            lines={[
              { text: '[12:04:31] rasterize_base_map.py base_map.ply projects/officescan/map --png', level: 'dim' },
              { text: '[12:04:31] grid 400×360 cells @ 0.05m' },
              { text: '[12:04:33] free 118,204 · occupied 41,882 · unknown 79,514', level: 'ok' },
              { text: '[12:04:33] obstacle_min_height=0.08 vs 0.20 비교 결과 거의 동일 — 기본값 사용', level: 'warn' },
              { text: '[12:04:34] color top-down 렌더링 중…' },
            ]}
          />
        </div>
        <SidePanel>
          <SidePanelSection title="파라미터">
            <ParamSlider label="격자 해상도" valueLabel="5.0 cm" percent={45} />
            <ParamSlider label="장애물 최소 높이" valueLabel="0.08 m" percent={20} />
          </SidePanelSection>
          <div style={{ height: 22 }} />
          <SidePanelSection title="단계 통계">
            <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 2, fontFamily: 'var(--font-mono)' }}>
              free 118,204
              <br />
              occupied 41,882
              <br />
              unknown 79,514
            </div>
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

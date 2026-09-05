import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell, Button, ProjectCard, NewProjectCard } from '../src/index';

function Demo() {
  return (
    <AppShell
      headerAction={<Button variant="primary">+ 새 프로젝트</Button>}
      navItems={[
        { icon: '▦', label: '프로젝트', active: true },
        { icon: '◧', label: '리포트 & 뷰어' },
        { icon: '⚙', label: '설정' },
        { icon: '◎', label: '팀/멤버' },
        { icon: '?', label: '도움말/문서' },
      ]}
    >
      <div style={{ padding: 28, maxWidth: 1180, margin: '0 auto' }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 18, color: 'var(--text)' }}>
          프로젝트
        </h1>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
          }}
        >
          <ProjectCard
            title="officescan"
            meta="office.usdz · 20×20m · 2026-08-12"
            status="done"
            stepsDone={6}
            statusNote="6/6 단계 · 정합 RMSE 3.1cm"
            footerStat="벽 7 · 가구 44"
            actionLabel="리포트 열기 →"
            thumbnail={
              <svg viewBox="0 0 200 120" width="100%" height="100%">
                <polygon
                  points="20,15 150,15 150,60 100,60 100,100 20,100"
                  fill="none"
                  stroke="#e7ecf3"
                  strokeWidth="2"
                />
                <rect x="40" y="30" width="18" height="12" fill="#f5a623" opacity=".8" />
                <rect x="70" y="30" width="18" height="12" fill="#f5a623" opacity=".8" />
              </svg>
            }
          />
          <ProjectCard
            title="warehouse_b1"
            meta="scan_0814.usdz · 2026-08-15"
            status="progress"
            stepsDone={3}
            statusNote="정합 진행 중…"
            footerStat="예상 40초 남음"
            actionLabel="진행 화면 →"
          />
          <ProjectCard
            title="lobby_arkitscenes"
            meta="arkitscenes_40753679 · 2026-07-30"
            status="needs-attention"
            stepsDone={5}
            statusNote="로봇 지도 없음 · 정합 건너뜀"
            footerStat="벽 4 · 가구 12"
            actionLabel="리포트 열기 →"
          />
          <NewProjectCard />
        </div>
      </div>
    </AppShell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);

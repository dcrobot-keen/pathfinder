import { AppShell, Button } from 's2m-ui';

export function WithSideNav() {
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
      <div style={{ padding: 24, color: 'var(--text-dim)', fontFamily: 'var(--font-ui)', fontSize: 13 }}>
        페이지 콘텐츠 영역
      </div>
    </AppShell>
  );
}

export function TopBarOnly() {
  return (
    <AppShell brandTagline="모달/전체화면 흐름 (사이드 내비 없음)">
      <div style={{ padding: 24, color: 'var(--text-dim)', fontFamily: 'var(--font-ui)', fontSize: 13 }}>
        새 프로젝트 마법사, 파이프라인 처리 화면 등에서 사용
      </div>
    </AppShell>
  );
}

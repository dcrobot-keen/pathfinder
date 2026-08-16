import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell, Button, ProjectCard, NewProjectCard, type ProjectCardStatus } from '../../src/index';
import { listProjects, type ProjectSummary } from '../api';

function toCardStatus(phase: ProjectSummary['phase']): ProjectCardStatus {
  if (phase === 'done') return 'done';
  if (phase === 'running') return 'progress';
  return 'needs-attention';
}

function statusNote(project: ProjectSummary): string {
  if (project.phase === 'error') return `오류: ${(project.error ?? '').split('\n').pop()?.slice(0, 60) ?? ''}`;
  if (project.phase === 'running') return '처리 진행 중…';
  if (project.phase === 'needs-attention') return '상태 정보 없음 (CLI로 생성된 프로젝트)';
  return '처리 완료';
}

function stepCounts(steps: Record<string, string>): { done: number; total: number } {
  const total = Object.keys(steps).length || 6;
  const done = Object.values(steps).filter((s) => s === 'done' || s === 'skip').length;
  return { done, total };
}

export function DashboardPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const list = await listProjects();
      if (!cancelled) setProjects(list);
    }
    load();
    const interval = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <AppShell
      headerAction={
        <Button variant="primary" onClick={() => navigate('/new')}>
          + 새 프로젝트
        </Button>
      }
      navItems={[
        { icon: '▦', label: '프로젝트', active: true },
        { icon: '◧', label: '리포트 & 뷰어' },
        { icon: '⚙', label: '설정' },
        { icon: '◎', label: '팀/멤버' },
        { icon: '?', label: '도움말/문서' },
      ]}
    >
      <div style={{ padding: 28, maxWidth: 1180, margin: '0 auto' }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 18, color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
          프로젝트
        </h1>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {projects?.map((project) => {
            const { done, total } = stepCounts(project.steps);
            const targetPage = project.phase === 'running' ? 'pipeline' : 'report';
            return (
              <ProjectCard
                key={project.name}
                title={project.name}
                meta={new Date(project.mtime * 1000).toLocaleString('ko-KR')}
                status={toCardStatus(project.phase)}
                stepsDone={done}
                stepsTotal={total}
                statusNote={statusNote(project)}
                footerStat={project.phase === 'running' ? '처리 중' : ''}
                actionLabel={project.phase === 'running' ? '진행 화면 →' : '리포트 열기 →'}
                onAction={() => navigate(`/projects/${project.name}/${targetPage}`)}
              />
            );
          })}
          <NewProjectCard onCreate={() => navigate('/new')} />
        </div>
        {projects && projects.length === 0 ? (
          <p style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-ui)', marginTop: 20 }}>
            아직 프로젝트가 없습니다. 위의 "새 스캔으로 시작"으로 첫 프로젝트를 만들어보세요.
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}

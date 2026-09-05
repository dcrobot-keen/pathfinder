import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ScreenHeader,
  Ribbon,
  RibbonTools,
  StepRail,
  LogConsole,
  ProgressPill,
  SidePanel,
  SidePanelSection,
  Button,
  type RailStep,
  type RailStepStatus,
  type LogLine,
} from '../../src/index';
import { getStatus, type StatusResponse } from '../api';

const STEP_LABELS: [key: string, title: string][] = [
  ['import', '1. 가져오기'],
  ['preprocess', '2. 전처리'],
  ['rasterize', '3. 래스터화'],
  ['registration', '4. 정합'],
  ['classify', '5. 분류'],
  ['vectorize', '6. 벡터화'],
  ['viewer', '7. 뷰어/리포트'],
];

const SUBTITLE: Record<string, string> = {
  pending: '대기 중',
  active: '진행 중…',
  done: '완료',
  skip: '건너뜀',
  error: '오류',
};

function toRailStatus(raw: string | undefined): RailStepStatus {
  if (raw === 'active' || raw === 'done' || raw === 'skip' || raw === 'error') return raw;
  return 'pending';
}

export function PipelinePage() {
  const { name = '' } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const s = await getStatus(name);
      if (cancelled) return;
      setStatus(s);
      if (s.phase === 'done') {
        navigate(`/projects/${name}/report`);
      }
    }
    poll();
    intervalRef.current = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [name, navigate]);

  const steps: RailStep[] = STEP_LABELS.map(([key, title]) => {
    const raw = status?.steps[key];
    const railStatus = toRailStatus(raw);
    return { title, subtitle: SUBTITLE[railStatus], status: railStatus };
  });

  const doneCount = steps.filter((s) => s.status === 'done' || s.status === 'skip').length;
  const percent = (doneCount / steps.length) * 100;

  const logLines: LogLine[] = (status?.log ?? []).map((text) => ({
    text,
    level: text.startsWith('오류') ? 'error' : text.includes('완료') ? 'ok' : 'default',
  }));

  return (
    <div style={{ background: 'var(--bg)', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <ScreenHeader
        crumb={['프로젝트', name]}
        pillText={status?.phase === 'error' ? '오류' : `처리중 ${doneCount} / ${steps.length}`}
        pillTone={status?.phase === 'error' ? 'warn' : 'accent'}
        actions={<Button onClick={() => navigate('/')}>대시보드로</Button>}
      />
      <Ribbon tabs={[{ label: '처리 (Process)', active: true }, { label: '편집 (분류·벡터화)' }, { label: '디스플레이' }]} />
      <RibbonTools
        tools={[
          { icon: '▦', label: '래스터화' },
          { icon: '⌗', label: '정합' },
          { icon: '◧', label: '분류' },
          { icon: '▱', label: '벡터화' },
        ]}
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <StepRail steps={steps} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ padding: '16px 22px 12px', borderBottom: '1px solid var(--border)' }}>
            <h1 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>{name}</h1>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
              scripts/studio.py process 파이프라인 실시간 진행 상황
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
            {status?.phase === 'running' ? (
              <div style={{ position: 'absolute', bottom: 24 }}>
                <ProgressPill percent={percent} eta="진행 중…" />
              </div>
            ) : null}
          </div>
          <LogConsole lines={logLines} />
        </div>
        <SidePanel>
          <SidePanelSection title="상태">
            <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              phase: {status?.phase ?? '...'}
            </div>
          </SidePanelSection>
        </SidePanel>
      </div>
    </div>
  );
}

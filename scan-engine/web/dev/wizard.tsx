import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Modal, StepIndicator, Dropzone, FilePill, Button } from '../src/index';

function Demo() {
  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Modal
        title="새 프로젝트"
        footer={
          <>
            <Button>← 이전</Button>
            <Button variant="primary">다음: 처리 옵션 →</Button>
          </>
        }
      >
        <StepIndicator
          steps={[
            { label: '이름', state: 'done' },
            { label: '로봇 지도(선택)', state: 'active' },
            { label: '처리 옵션', state: 'pending' },
          ]}
        />
        <div style={{ height: 20 }} />
        <label style={{ fontSize: 12.5, color: 'var(--text-dim)', display: 'block', marginBottom: 6, fontWeight: 600 }}>
          로봇 SLAM 지도 (occupancy grid)
        </label>
        <Dropzone
          label={
            <>
              <b>robot_map.pgm</b> + <b>robot_map.yaml</b> 드래그, 또는 클릭해서 선택
            </>
          }
          hint="nav2 map_server 표준 포맷 — 없으면 정합(registration) 단계는 건너뜁니다"
        />
        <FilePill icon="▦" name="robot_map.pgm" meta="512×480 · 5cm/px" />
        <FilePill icon="⚙" name="robot_map.yaml" meta="resolution 0.05 · origin [-12.4, -9.1, 0]" />
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-faint)',
            marginTop: 10,
            textAlign: 'center',
            textDecoration: 'underline',
            cursor: 'pointer',
          }}
        >
          로봇 지도 없이 베이스맵만 생성 →
        </div>
      </Modal>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);

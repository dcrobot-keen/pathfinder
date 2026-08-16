import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell, Modal, StepIndicator, Dropzone, FilePill, Button, type Step } from '../../src/index';
import { createProject, processProject } from '../api';

/** Dropzone/FilePill are presentational-only in the s2m-ui library (no
 * onDrop/hidden input of their own) -- this wraps them with the real file
 * I/O the wizard needs. */
function FileDrop(props: { label: ReactNode; hint: ReactNode; accept?: string; multiple?: boolean; onFiles: (files: FileList) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (e.dataTransfer.files.length) props.onFiles(e.dataTransfer.files);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) props.onFiles(e.target.files);
  }

  return (
    <div onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={props.accept}
        multiple={props.multiple}
        onChange={handleChange}
      />
      <Dropzone label={props.label} hint={props.hint} onClick={() => inputRef.current?.click()} />
    </div>
  );
}

type WizardStep = 1 | 2 | 3;

function stepStates(current: WizardStep): Step[] {
  const state = (n: WizardStep) => (n < current ? 'done' : n === current ? 'active' : 'pending');
  return [
    { label: '이름 & 스캔', state: state(1) },
    { label: '로봇 지도(선택)', state: state(2) },
    { label: '처리 옵션', state: state(3) },
  ];
}

export function WizardPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>(1);
  const [name, setName] = useState('');
  const [usdz, setUsdz] = useState<File | null>(null);
  const [robotMapPgm, setRobotMapPgm] = useState<File | null>(null);
  const [robotMapYaml, setRobotMapYaml] = useState<File | null>(null);
  const [removeIsolatedClusters, setRemoveIsolatedClusters] = useState(false);
  const [classify, setClassify] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleRobotMapFiles(files: FileList) {
    for (const file of Array.from(files)) {
      if (file.name.endsWith('.pgm')) setRobotMapPgm(file);
      else if (file.name.endsWith('.yaml') || file.name.endsWith('.yml')) setRobotMapYaml(file);
    }
  }

  async function handleSubmit() {
    if (!usdz || !name.trim()) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await createProject(name.trim());
      await processProject(name.trim(), {
        usdz,
        robotMapPgm: robotMapPgm ?? undefined,
        robotMapYaml: robotMapYaml ?? undefined,
        removeIsolatedClusters,
        classify,
      });
      navigate(`/projects/${name.trim()}/pipeline`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <AppShell brandTagline="새 프로젝트">
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(6,8,12,.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Modal
          title="새 프로젝트"
          onClose={() => navigate('/')}
          footer={
            <>
              <Button onClick={() => (step > 1 ? setStep((s) => (s - 1) as WizardStep) : navigate('/'))}>
                ← 이전
              </Button>
              {step < 3 ? (
                <Button variant="primary" onClick={() => setStep((s) => (s + 1) as WizardStep)} disabled={step === 1 && (!name.trim() || !usdz)}>
                  다음 →
                </Button>
              ) : (
                <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? '처리 시작 중…' : '처리 시작 →'}
                </Button>
              )}
            </>
          }
        >
          <StepIndicator steps={stepStates(step)} />
          <div style={{ height: 20 }} />

          {step === 1 && (
            <>
              <label style={{ fontSize: 12.5, color: 'var(--text-dim)', display: 'block', marginBottom: 6, fontWeight: 600 }}>
                프로젝트 이름
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: officescan"
                style={{
                  width: '100%',
                  background: 'var(--panel-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: 'var(--text)',
                  fontSize: 13,
                  marginBottom: 18,
                  fontFamily: 'var(--font-ui)',
                }}
              />
              <label style={{ fontSize: 12.5, color: 'var(--text-dim)', display: 'block', marginBottom: 6, fontWeight: 600 }}>
                스캔 파일 (.usdz)
              </label>
              <FileDrop
                accept=".usdz"
                label={<><b>scan.usdz</b> 드래그, 또는 클릭해서 선택</>}
                hint="iPhone 스캐닝 앱이 내보낸 .usdz 파일"
                onFiles={(files) => setUsdz(files[0])}
              />
              {usdz ? <FilePill icon="◧" name={usdz.name} meta={`${(usdz.size / 1024 / 1024).toFixed(1)} MB`} /> : null}
            </>
          )}

          {step === 2 && (
            <>
              <label style={{ fontSize: 12.5, color: 'var(--text-dim)', display: 'block', marginBottom: 6, fontWeight: 600 }}>
                로봇 SLAM 지도 (occupancy grid)
              </label>
              <FileDrop
                accept=".pgm,.yaml,.yml"
                multiple
                label={<><b>robot_map.pgm</b> + <b>robot_map.yaml</b> 드래그, 또는 클릭해서 선택</>}
                hint="nav2 map_server 표준 포맷 — 없으면 정합(registration) 단계는 건너뜁니다"
                onFiles={handleRobotMapFiles}
              />
              {robotMapPgm ? <FilePill icon="▦" name={robotMapPgm.name} meta={`${(robotMapPgm.size / 1024).toFixed(0)} KB`} /> : null}
              {robotMapYaml ? <FilePill icon="⚙" name={robotMapYaml.name} meta={`${(robotMapYaml.size / 1024).toFixed(1)} KB`} /> : null}
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-faint)',
                  marginTop: 10,
                  textAlign: 'center',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-ui)',
                }}
                onClick={() => setStep(3)}
              >
                로봇 지도 없이 베이스맵만 생성 →
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
                    이동 물체(고립 클러스터) 제거
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                    작은 고립 클러스터 제거 — 오탐 가능성 있어 기본 꺼짐
                  </div>
                </div>
                <input type="checkbox" checked={removeIsolatedClusters} onChange={(e) => setRemoveIsolatedClusters(e.target.checked)} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
                    바닥/벽/가구 분류
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                    classified.ply + 가구 벡터 폴리곤 추가
                  </div>
                </div>
                <input type="checkbox" checked={classify} onChange={(e) => setClassify(e.target.checked)} />
              </div>
              {errorMsg ? (
                <div style={{ marginTop: 14, color: 'var(--danger)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{errorMsg}</div>
              ) : null}
            </>
          )}
        </Modal>
      </div>
    </AppShell>
  );
}

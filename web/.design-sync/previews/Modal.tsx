import { Button, Dropzone, FilePill, Modal, StepIndicator } from 's2m-ui';

export function NewProjectStep1() {
  return (
    <Modal
      title="새 프로젝트"
      onClose={() => {}}
      footer={
        <>
          <Button onClick={() => {}}>← 이전</Button>
          <Button variant="primary" onClick={() => {}}>다음 →</Button>
        </>
      }
    >
      <StepIndicator
        steps={[
          { label: '이름 & 스캔', state: 'active' },
          { label: '로봇 지도(선택)', state: 'pending' },
          { label: '처리 옵션', state: 'pending' },
        ]}
      />
      <div style={{ height: 20 }} />
      <label style={{ fontSize: 12.5, color: 'var(--text-dim)', display: 'block', marginBottom: 6, fontWeight: 600 }}>
        프로젝트 이름
      </label>
      <input
        type="text"
        defaultValue="officescan"
        readOnly
        style={{
          width: '100%',
          background: 'var(--panel-2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '10px 12px',
          color: 'var(--text)',
          fontSize: 13,
          marginBottom: 18,
        }}
      />
      <label style={{ fontSize: 12.5, color: 'var(--text-dim)', display: 'block', marginBottom: 6, fontWeight: 600 }}>
        스캔 파일 (.usdz)
      </label>
      <Dropzone label={<><b>scan.usdz</b> 드래그, 또는 클릭해서 선택</>} hint="iPhone 스캐닝 앱이 내보낸 .usdz 파일" />
      <FilePill icon="◧" name="scan.usdz" meta="184.3 MB" />
    </Modal>
  );
}

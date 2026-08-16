import { Button, ScreenHeader } from 's2m-ui';

export function Processing() {
  return (
    <ScreenHeader
      crumb={['프로젝트', 'officescan']}
      pillText="처리중 3 / 6"
      pillTone="accent"
      actions={<Button onClick={() => {}}>대시보드로</Button>}
    />
  );
}

export function Done() {
  return (
    <ScreenHeader
      crumb={['프로젝트', 'officescan']}
      pillText="✓ 처리 완료"
      pillTone="success"
      actions={
        <>
          <Button onClick={() => {}}>대시보드로</Button>
          <Button variant="primary" onClick={() => {}}>3D로 보기 (gltf-inspector)</Button>
        </>
      }
    />
  );
}

export function Warn() {
  return <ScreenHeader crumb={['프로젝트', 'warehouse_b1']} pillText="오류" pillTone="warn" />;
}

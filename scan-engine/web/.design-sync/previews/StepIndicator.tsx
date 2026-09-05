import { StepIndicator } from 's2m-ui';

export function Step2Active() {
  return (
    <StepIndicator
      steps={[
        { label: '이름 & 스캔', state: 'done' },
        { label: '로봇 지도(선택)', state: 'active' },
        { label: '처리 옵션', state: 'pending' },
      ]}
    />
  );
}

export function AllDone() {
  return (
    <StepIndicator
      steps={[
        { label: '이름 & 스캔', state: 'done' },
        { label: '로봇 지도(선택)', state: 'done' },
        { label: '처리 옵션', state: 'done' },
      ]}
    />
  );
}

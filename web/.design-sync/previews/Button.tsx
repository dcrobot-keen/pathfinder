import { Button } from 's2m-ui';

export function Default() {
  return <Button>이전</Button>;
}

export function Primary() {
  return <Button variant="primary">+ 새 프로젝트</Button>;
}

export function Ghost() {
  return <Button variant="ghost">⏸ 일시정지</Button>;
}

export function Danger() {
  return <Button variant="danger">취소</Button>;
}

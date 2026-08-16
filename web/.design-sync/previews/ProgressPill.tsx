import { ProgressPill } from 's2m-ui';

export function InProgress() {
  return <ProgressPill percent={62} eta="약 8초 남음" />;
}

export function NearDone() {
  return <ProgressPill percent={94} eta="약 1초 남음" />;
}

export function NoEta() {
  return <ProgressPill percent={20} />;
}

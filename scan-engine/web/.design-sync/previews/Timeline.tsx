import { Timeline } from 's2m-ui';

export function Playing() {
  return <Timeline playing percent={38} poseText="t=14.2s · x=1.84 y=3.02 θ=42°" />;
}

export function Paused() {
  return <Timeline playing={false} percent={0} poseText="t=0.0s · x=0.00 y=0.00 θ=0°" />;
}

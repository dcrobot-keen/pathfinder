import './Timeline.css';

export interface TimelineProps {
  playing?: boolean;
  onTogglePlay?: () => void;
  /** 0–100 */
  percent: number;
  /** e.g. "t=14.2s · x=1.84 y=3.02 θ=42°" */
  poseText: string;
}

/** Playback scrubber for the robot trajectory overlay (play button + scrub bar + current pose). */
export function Timeline({ playing = false, onTogglePlay, percent, poseText }: TimelineProps) {
  const pct = Math.min(100, Math.max(0, percent));
  return (
    <div className="s2m-timeline">
      <button type="button" className="s2m-timeline__play" onClick={onTogglePlay} aria-label={playing ? '일시정지' : '재생'}>
        {playing ? '⏸' : '▶'}
      </button>
      <div className="s2m-timeline__scrub">
        <div className="s2m-timeline__fill" style={{ width: `${pct}%` }} />
        <div className="s2m-timeline__knob" style={{ left: `${pct}%` }} />
      </div>
      <div className="s2m-timeline__pose">{poseText}</div>
    </div>
  );
}

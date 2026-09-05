import './ProgressPill.css';

export interface ProgressPillProps {
  /** 0–100 */
  percent: number;
  /** e.g. "약 8초 남음" */
  eta?: string;
}

/** Floating progress indicator (percent + bar + ETA) shown over a pipeline stage preview. */
export function ProgressPill({ percent, eta }: ProgressPillProps) {
  return (
    <div className="s2m-progress-pill">
      <span className="s2m-progress-pill__pct">{Math.round(percent)}%</span>
      <div className="s2m-progress-pill__bar">
        <i style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      {eta ? <span className="s2m-progress-pill__eta">{eta}</span> : null}
    </div>
  );
}
